import { randomUUID } from 'node:crypto';
import { redis, pipeline, toObject } from './redis.js';

// Same teams as the Spooky Sheet game. The admin page can rename / add / remove them.
export const DEFAULT_TEAMS = ['The Walking Debt 🧟', 'Phantom Forecasts 👻', 'Count Accrual 🧛'];

const K = {
  teams: 'bz:teams',   // JSON array of team names
  team: 'bz:pteam',    // hash  playerId -> team index
  name: 'bz:pname',    // hash  playerId -> display name
  joined: 'bz:pjoin',  // hash  playerId -> join time (ms)
  scores: 'bz:scores', // hash  team index -> points
  points: 'bz:ppts',   // hash  playerId -> personal points
  buzz: 'bz:buzz',     // "token|team|playerId|time|name" while someone holds the buzzer, "paused" when locked
  last: 'bz:last',     // latest verdict: "a|judgedAt|<buzz>" or "d|judgedAt|<buzz>"
  log: 'bz:log',       // list of verdicts, newest first
};
const ALL_KEYS = Object.values(K);
const PAUSED = 'paused';

// Picks the least populated team atomically, so a burst of joins stays balanced.
// ARGV[4] is a shuffled team order, used to break ties randomly.
const JOIN_LUA = `
local nt = tonumber(ARGV[3])
local counts = {}
for i = 0, nt - 1 do counts[i] = 0 end
local all = redis.call('HGETALL', KEYS[1])
local mine = nil
for i = 1, #all, 2 do
  local t = tonumber(all[i + 1])
  if all[i] == ARGV[1] then mine = t end
  if t ~= nil and counts[t] ~= nil then counts[t] = counts[t] + 1 end
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HSETNX', KEYS[3], ARGV[1], ARGV[5])
if mine ~= nil and counts[mine] ~= nil then return mine end
local best, low = 0, nil
for tok in string.gmatch(ARGV[4], '%d+') do
  local t = tonumber(tok)
  if low == nil or counts[t] < low then best, low = t, counts[t] end
end
redis.call('HSET', KEYS[1], ARGV[1], best)
return best`;

// First SET NX wins the buzzer; everyone after that gets the current holder back.
const BUZZ_LUA = `
local t = redis.call('HGET', KEYS[1], ARGV[1])
if not t then return {-1, ''} end
local name = redis.call('HGET', KEYS[2], ARGV[1]) or '?'
local v = ARGV[2] .. '|' .. t .. '|' .. ARGV[1] .. '|' .. ARGV[3] .. '|' .. name
if redis.call('SET', KEYS[3], v, 'NX') then return {1, v} end
return {0, redis.call('GET', KEYS[3]) or ''}`;

// Approve / decline only the buzz the admin is looking at (token match), then release the buzzer.
// An approval is +1 for the team and +1 for the player who buzzed.
const JUDGE_LUA = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local tok, team, pid = string.match(cur, '^([^|]*)|([^|]*)|([^|]*)|')
if tok ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
if ARGV[2] == 'a' then
  redis.call('HINCRBY', KEYS[2], team, 1)
  redis.call('HINCRBY', KEYS[5], pid, 1)
end
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
  const [k, team, id, at, ...rest] = raw.split('|');
  return { k, team: +team, id, at: +at, name: rest.join('|') };
}

function parseVerdict(raw) {
  if (!raw) return null;
  const [v, judgedAt, ...rest] = raw.split('|');
  return { v, judgedAt: +judgedAt, ...parseBuzz(rest.join('|')) };
}

function parseTeams(raw) {
  try {
    const t = JSON.parse(raw);
    if (Array.isArray(t) && t.length) return t.map(String);
  } catch {}
  return DEFAULT_TEAMS;
}

async function getTeams() {
  return parseTeams(await redis('GET', K.teams));
}

function shuffled(n) {
  const a = [...Array(n).keys()];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- player actions ----------

export async function join(id, name) {
  stateCache = null;
  const teams = await getTeams();
  const now = Date.now();
  const team = await redis('EVAL', JOIN_LUA, 3, K.team, K.name, K.joined,
    id, name, teams.length, shuffled(teams.length).join(','), now);
  return { team: Number(team), teamName: teams[team], t: now };
}

export async function buzz(id) {
  stateCache = null;
  const now = Date.now();
  const [code, raw] = await redis('EVAL', BUZZ_LUA, 3, K.team, K.name, K.buzz, id, randomUUID().slice(0, 8), now);
  return { result: Number(code) === 1 ? 'first' : Number(code) === -1 ? 'unknown' : 'taken', buzz: parseBuzz(raw), t: now };
}

// ---------- state ----------

export async function publicState() {
  const [teamsRaw, scoresRaw, teamRaw, buzzRaw, lastRaw, pointsRaw] = await pipeline([
    ['GET', K.teams], ['HGETALL', K.scores], ['HGETALL', K.team], ['GET', K.buzz], ['GET', K.last], ['HGETALL', K.points],
  ]);
  const teams = parseTeams(teamsRaw);
  const scores = toObject(scoresRaw);
  const a = toObject(teamRaw);
  const p = toObject(pointsRaw);
  for (const id in p) p[id] = Number(p[id]);
  const counts = teams.map(() => 0);
  for (const id in a) {
    a[id] = Number(a[id]);
    if (counts[a[id]] !== undefined) counts[a[id]]++;
  }
  return {
    t: Date.now(),
    teams: teams.map((n, i) => ({ n, s: Number(scores[i] || 0), c: counts[i] })),
    buzz: parseBuzz(buzzRaw),
    last: parseVerdict(lastRaw),
    a, // playerId -> team
    p, // playerId -> personal points (players with points only)
  };
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
  const [{ a, p, ...pub }, [names, joined, log]] = await Promise.all([
    fresh ? publicState() : cachedPublicState(),
    pipeline([['HGETALL', K.name], ['HGETALL', K.joined], ['LRANGE', K.log, 0, 19]]),
  ]);
  const n = toObject(names);
  const j = toObject(joined);
  const players = Object.keys(a)
    .map(id => ({ id, name: n[id] || '?', team: a[id], pts: p[id] || 0, joined: Number(j[id] || 0) }))
    .sort((x, y) => x.joined - y.joined);
  return { ...pub, players, log: (log || []).map(parseVerdict) };
}

// ---------- admin actions ----------

// Keep teams within one player of each other: anyone on a removed team goes to the
// smallest team, then the latest joiners of the biggest team move to the smallest.
async function rebalance(teamCount) {
  const n = teamCount ?? (await getTeams()).length;
  const [teamRaw, joinedRaw] = await pipeline([['HGETALL', K.team], ['HGETALL', K.joined]]);
  const a = toObject(teamRaw);
  const j = toObject(joinedRaw);
  const buckets = Array.from({ length: n }, () => []);
  const homeless = [];
  for (const id in a) (buckets[Number(a[id])] || homeless).push(id);
  const byJoin = (x, y) => Number(j[x] || 0) - Number(j[y] || 0);
  buckets.forEach(b => b.sort(byJoin));
  homeless.sort(byJoin);
  const moves = {};
  const smallest = () => buckets.reduce((m, b, i) => (b.length < buckets[m].length ? i : m), 0);
  const largest = () => buckets.reduce((m, b, i) => (b.length > buckets[m].length ? i : m), 0);
  for (const id of homeless) {
    const t = smallest();
    buckets[t].push(id);
    moves[id] = t;
  }
  for (;;) {
    const lo = smallest(), hi = largest();
    if (buckets[hi].length - buckets[lo].length <= 1) break;
    const id = buckets[hi].pop();
    buckets[lo].push(id);
    moves[id] = lo;
  }
  const flat = Object.entries(moves).flat();
  if (flat.length) await redis('HSET', K.team, ...flat);
  return Object.keys(moves).length;
}

export async function judge(token, verdict) {
  const ok = await redis('EVAL', JUDGE_LUA, 5, K.buzz, K.scores, K.last, K.log, K.points, token, verdict === 'approve' ? 'a' : 'd', Date.now());
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
    case 'score': {
      const team = Number(body.team), delta = Math.sign(Number(body.delta)) || 0;
      if (!Number.isInteger(team) || team < 0) throw new Error('Bad team');
      const v = await redis('HINCRBY', K.scores, team, delta);
      if (Number(v) < 0) await redis('HSET', K.scores, team, 0);
      return { ok: true };
    }
    case 'playerScore': {
      // Fix a mistake for one player: their points and their team's score move together.
      if (!validId(body.id)) throw new Error('Bad player');
      const delta = Math.sign(Number(body.delta)) || 0;
      const [team, pts] = await pipeline([['HGET', K.team, body.id], ['HGET', K.points, body.id]]);
      if (team == null) throw new Error('That player has left');
      if (!delta || (delta < 0 && !(Number(pts) > 0))) return { ok: false };
      const [, teamScore] = await pipeline([['HINCRBY', K.points, body.id, delta], ['HINCRBY', K.scores, team, delta]]);
      if (Number(teamScore) < 0) await redis('HSET', K.scores, team, 0);
      return { ok: true };
    }
    case 'teams': {
      const names = (Array.isArray(body.teams) ? body.teams : []).map(cleanName).filter(Boolean).slice(0, 8);
      if (!names.length) throw new Error('Keep at least one team.');
      const before = (await getTeams()).length;
      await redis('SET', K.teams, JSON.stringify(names));
      if (names.length < before) {
        await redis('HDEL', K.scores, ...Array.from({ length: before - names.length }, (_, i) => names.length + i));
      }
      const moved = names.length !== before ? await rebalance(names.length) : 0;
      return { ok: true, moved };
    }
    case 'kick': {
      if (!validId(body.id)) throw new Error('Bad player');
      await pipeline([['HDEL', K.team, body.id], ['HDEL', K.name, body.id], ['HDEL', K.joined, body.id], ['HDEL', K.points, body.id]]);
      return { ok: true, moved: await rebalance() };
    }
    case 'rebalance':
      return { ok: true, moved: await rebalance() };
    case 'resetScores':
      await pipeline([['DEL', K.scores, K.points, K.last, K.log], ['DEL', K.buzz]]);
      return { ok: true };
    case 'newGame':
      // Everyone is signed out and has to join again; team names are kept.
      await redis('DEL', ...ALL_KEYS.filter(k => k !== K.teams));
      return { ok: true };
    default:
      throw new Error('Unknown action');
  }
}
