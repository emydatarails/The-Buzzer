import { publicState } from '../lib/game.js';
import { handle, json } from '../lib/http.js';

// Every player polls this. Vercel's CDN caches it for one second, so the database is
// hit about once a second no matter how many people are playing.
export const GET = handle(async () =>
  json(await publicState(), 200, {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'max-age=1',
  }));
