import { buzz, validId } from '../lib/game.js';
import { handle, json, readBody } from '../lib/http.js';

export const POST = handle(async request => {
  const { id } = await readBody(request);
  if (!validId(id)) return json({ error: 'Bad player id' }, 400);
  return json(await buzz(id));
});
