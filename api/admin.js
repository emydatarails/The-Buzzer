import { adminAction, adminState } from '../lib/game.js';
import { handle, isAdmin, json, readBody } from '../lib/http.js';

function denied() {
  return json({ error: process.env.ADMIN_PASSWORD ? 'Wrong password' : 'ADMIN_PASSWORD is not set on the server' }, 401);
}

export const GET = handle(async request => (isAdmin(request) ? json(await adminState()) : denied()));

export const POST = handle(async request => {
  if (!isAdmin(request)) return denied();
  const result = await adminAction(await readBody(request));
  return json({ ...(await adminState()), result });
});
