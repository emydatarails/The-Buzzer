// Minimal Upstash Redis REST client (no dependencies).
// Works with the env vars added by Vercel's Upstash / KV integration.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redisConfigured = Boolean(URL_ && TOKEN);

async function call(path, body) {
  if (!redisConfigured) {
    throw new Error('Redis is not configured. Connect an Upstash Redis database to this Vercel project (see README).');
  }
  const res = await fetch(URL_.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data == null) throw new Error(`Redis error ${res.status}: ${data && data.error}`);
  return data;
}

// redis('HGET', 'key', 'field') -> result
export async function redis(...cmd) {
  const data = await call('/', cmd.map(String));
  if (data.error) throw new Error(data.error);
  return data.result;
}

// pipeline([['GET','a'],['HGETALL','b']]) -> [resultA, resultB]
export async function pipeline(cmds) {
  const data = await call('/pipeline', cmds.map(c => c.map(String)));
  return data.map(d => {
    if (d.error) throw new Error(d.error);
    return d.result;
  });
}

// HGETALL over REST comes back as a flat [k1, v1, k2, v2] array.
export function toObject(flat) {
  if (!flat) return {};
  if (!Array.isArray(flat)) return flat;
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}
