import { createHash, timingSafeEqual } from 'node:crypto';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Wraps a handler so any thrown error becomes a JSON error response.
export function handle(fn) {
  return async request => {
    try {
      return await fn(request);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || 'Something spooky happened' }, 500);
    }
  };
}

const digest = s => createHash('sha256').update(String(s)).digest();

export function isAdmin(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(digest(request.headers.get('x-admin-key') || ''), digest(expected));
}
