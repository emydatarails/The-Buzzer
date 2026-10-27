# 🎃 Spooky Buzzer

The buzzer for the **Spooky Sheet** Datarails Halloween scavenger hunt.

- **Players** (`/`) enter their name, get sorted into the smallest team automatically, and see one big buzzer plus a HUD with their name, team and team score.
- **Host** (`/admin`) sees who buzzed first, then **Approve** (+1 to that player's team) or **Decline**. Either way the buzzer is released for everyone.

The first buzz is decided atomically in Redis, so if two people hit it at the same moment exactly one of them wins.

## Deploy on Vercel (about 5 minutes)

1. **Import the repo**: Vercel → *Add New… → Project* → pick this repo. Framework preset: **Other**. No build command needed.
2. **Add a database**: in the project, open **Storage → Create Database → Upstash (Redis)** (free plan is fine) and connect it to the project. This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) env vars for you.
3. **Set the host password**: *Settings → Environment Variables* → add `ADMIN_PASSWORD` with a password only you know.
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the new env vars are picked up.

Then:
- Share `https://<your-app>.vercel.app` with everyone (the admin page has a *Copy link* button for the Zoom chat).
- Open `https://<your-app>.vercel.app/admin` yourself and log in with `ADMIN_PASSWORD`.

## Running the hunt

| Host action | How |
|---|---|
| Approve the first buzz (+1 to their team) | **✓ Approve** or <kbd>A</kbd> |
| Decline it | **✗ Decline** or <kbd>D</kbd> |
| Lock buzzers between items so nobody buzzes early | **🔒 Lock buzzers** or <kbd>L</kbd> (press again to open) |
| Fix a score | − / + on the Scareboard |
| Rename / add / remove teams | Edit the name in place, **＋ Team** / **− Team** |
| Remove a player who left | × next to their name |
| Wipe scores, keep players | **↺ Reset scores** |
| Start over (everyone re-enters their name) | **🧹 New game** |

**Team balancing.** Each new player joins the team with the fewest players (ties are random). Whenever teams get uneven (you remove a player, or add or remove a team), the most recently joined players of the biggest team are moved to the smallest. Moved players see a message saying which team they're on now.

## How it works

- `public/`: static pages (`index.html` = player, `admin.html` = host), the shared theme and the fonts and Bob artwork from the main game.
- `api/`: Vercel functions: `state` (public state), `join`, `buzz`, `admin` (password protected).
- `lib/game.js`: game logic. Joining, buzzing and judging are Lua scripts, so each one runs atomically in Redis.

Players poll `/api/state` about once a second. Vercel's CDN caches that response for one second, so the database only gets about one read per second however many people are playing. When you buzz, the result comes straight back from the server. The admin page polls without the cache.

## Local development

```bash
# .env.local
KV_REST_API_URL=...        # from your Upstash database
KV_REST_API_TOKEN=...
ADMIN_PASSWORD=boo

npm run dev   # http://localhost:3000 and http://localhost:3000/admin
```

There are no dependencies. You need Node 22 or newer (`vercel dev` works too).
