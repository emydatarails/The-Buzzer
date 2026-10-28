import { randomUUID } from 'node:crypto';
import { redis, pipeline, toObject } from './redis.js';

// Everyone plays for themselves: each approved find is +1 for the player who buzzed.
const K = {
  name: 'bz:pname',    // hash  playerId -> display name (every player who has joined)
  joined: 'bz:pjoin',  // hash  playerId -> join time (ms)
  points: 'bz:ppts',   // hash  playerId -> points
  buzz: 'bz:buzz',     // "token|playerId|time|name" while someone holds the buzzer, "paused" when locked
  last: 'bz:last',     // latest verdict: "a|judgedAt|<buzz>" or "d|judgedAt|<buzz>"
  log: 'bz:log',       // list of verdicts, newest first
};
// Keys from the earlier team version, cleared by "New game".
const LEGACY_KEYS = ['bz:teams', 'bz:pteam', 'bz:scores'];
const PAUSED = 'paused';

// First SET NX wins the buzzer; everyone after that gets the current holder back.
const BUZZ_LUA = `
local name = redis.call('HGET', KEYS[1], ARGV[1])
if not name then return {-1, ''} end
local v = ARGV[2] .. '|' .. ARGV[1] .. '|' .. ARGV[3] .. '|' .. name
if redis.call('SET', KEYS[2], v, 'NX') then return {1, v} end
return {0, redis.call('GET', KEYS[2]) or ''}`;

// Approve / decline only the buzz the admin is looking at (token match), then release the buzzer.
// An approval is +1 for the player who buzzed.
const JUDGE_LUA = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local tok, pid = string.match(cur, '^([^|]*)|([^|]*)|')
if tok ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
if ARGV[2] == 'a' and redis.call('HEXISTS', KEYS[5], pid) == 1 then redis.call('HINCRBY', KEYS[2], pid, 1) end
local entry = ARGV[2] .. '|' .. ARGV[3] .. '|' .. cur
redis.call('SET', KEYS[3], entry)
redis.call('LPUSH', KEYS[4], entry)
redis.call('LTRIM', KEYS[4], 0, 49)
return 1`;

const UNPAUSE_LUA = `
if redis.call('GET', KEYS[1]) == '${PAUSED}' then return redis.call('DEL', KEYS[1]) end
return 0`;

export function cleanName(name) {
  return String(name || '')
    .replace(/[|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function parseBuzz(raw) {
  if (!raw) return null;
  if (raw === PAUSED) return { paused: true };
  const [k, id, at, ...rest] = raw.split('|');
  return { k, id, at: +at, name: rest.join('|') };
}

function parseVerdict(raw) {
  if (!raw) return null;
  const [v, judgedAt, ...rest] = raw.split('|');
  return { v, judgedAt: +judgedAt, ...parseBuzz(rest.join('|')) };
}

// ---------- player actions ----------

export async function join(id, name) {
  stateCache = null;
  const now = Date.now();
  await pipeline([['HSET', K.name, id, name], ['HSETNX', K.joined, id, now]]);
  return { t: now };
}

export async function buzz(id) {
  stateCache = null;
  const now = Date.now();
  const [code, raw] = await redis('EVAL', BUZZ_LUA, 2, K.name, K.buzz, id, randomUUID().slice(0, 8), now);
  return { result: Number(code) === 1 ? 'first' : Number(code) === -1 ? 'unknown' : 'taken', buzz: parseBuzz(raw), t: now };
}

// ---------- state ----------

export async function publicState() {
  const [namesRaw, pointsRaw, buzzRaw, lastRaw] = await pipeline([
    ['HKEYS', K.name], ['HGETALL', K.points], ['GET', K.buzz], ['GET', K.last],
  ]);
  const pts = toObject(pointsRaw);
  const p = {}; // playerId -> points, for every player (players use it to find their score and rank)
  for (const id of namesRaw || []) p[id] = Number(pts[id] || 0);
  return { t: Date.now(), buzz: parseBuzz(buzzRaw), last: parseVerdict(lastRaw), p };
}

// Players everywhere get the same state, so one function instance re-reads it at most
// about once a second. That keeps the game inside Upstash's free command allowance.
let stateCache = null;
export function cachedPublicState(maxAge = 900) {
  if (!stateCache || Date.now() - stateCache.at > maxAge) {
    const promise = publicState();
    stateCache = { at: Date.now(), promise };
    promise.catch(() => { if (stateCache?.promise === promise) stateCache = null; });
  }
  return stateCache.promise;
}

export async function adminState(fresh = false) {
  const [{ p, ...pub }, [names, joined, log]] = await Promise.all([
    fresh ? publicState() : cachedPublicState(),
    pipeline([['HGETALL', K.name], ['HGETALL', K.joined], ['LRANGE', K.log, 0, 19]]),
  ]);
  const n = toObject(names);
  const j = toObject(joined);
  const players = Object.keys(p)
    .map(id => ({ id, name: n[id] || '?', pts: p[id], joined: Number(j[id] || 0) }))
    .sort((x, y) => y.pts - x.pts || x.joined - y.joined);
  return { ...pub, players, log: (log || []).map(parseVerdict) };
}

// ---------- admin actions ----------

export async function judge(token, verdict) {
  const ok = await redis('EVAL', JUDGE_LUA, 5, K.buzz, K.points, K.last, K.log, K.name,
    token, verdict === 'approve' ? 'a' : 'd', Date.now());
  return { ok: Number(ok) === 1 };
}

export async function adminAction(body) {
  stateCache = null;
  switch (body.action) {
    case 'approve':
    case 'decline':
      return judge(String(body.token || ''), body.action);
    case 'pause':
      await redis('SET', K.buzz, PAUSED, 'NX');
      return { ok: true };
    case 'resume':
      await redis('EVAL', UNPAUSE_LUA, 1, K.buzz);
      return { ok: true };
    case 'playerScore': {
      // Fix a mistake for one player. Points never go below 0.
      if (!validId(body.id)) throw new Error('Bad player');
      const delta = Math.sign(Number(body.delta)) || 0;
      const [name, pts] = await pipeline([['HGET', K.name, body.id], ['HGET', K.points, body.id]]);
      if (name == null) throw new Error('That player has left');
      if (!delta || (delta < 0 && !(Number(pts) > 0))) return { ok: false };
      await redis('HINCRBY', K.points, body.id, delta);
      return { ok: true };
    }
    case 'kick': {
      if (!validId(body.id)) throw new Error('Bad player');
      await pipeline([['HDEL', K.name, body.id], ['HDEL', K.joined, body.id], ['HDEL', K.points, body.id]]);
      return { ok: true };
    }
    case 'resetScores':
      await pipeline([['DEL', K.points, K.last, K.log], ['DEL', K.buzz]]);
      return { ok: true };
    case 'newGame':
      // Everyone is signed out and has to join again.
      await redis('DEL', ...Object.values(K), ...LEGACY_KEYS);
      return { ok: true };
    default:
      throw new Error('Unknown action');
  }
}
