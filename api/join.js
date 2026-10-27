import { cleanName, join, validId } from '../lib/game.js';
import { handle, json, readBody } from '../lib/http.js';

export const POST = handle(async request => {
  const { id, name } = await readBody(request);
  const clean = cleanName(name);
  if (!validId(id)) return json({ error: 'Bad player id' }, 400);
  if (!clean) return json({ error: 'Tell Bob your name first.' }, 400);
  return json({ ...(await join(id, clean)), name: clean });
});
