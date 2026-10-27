import { cachedPublicState } from '../lib/game.js';
import { handle, json } from '../lib/http.js';

// Every player polls this. Vercel's CDN caches it for one second and the function
// shares one read per second, so the database load doesn't grow with the player count.
export const GET = handle(async () =>
  json(await cachedPublicState(), 200, {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'max-age=1',
  }));
