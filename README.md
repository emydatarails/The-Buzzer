# 🎃 Spooky Buzzer

The buzzer for the **Spooky Sheet** Datarails Halloween scavenger hunt.

- **Players** (`/`) enter their name, get sorted into the smallest team automatically, and see one big buzzer plus a HUD with their name, team, their own points and their team's score.
- **Host** (`/admin`) sees who buzzed first, then **Approve** (+1 to that player and +1 to their team) or **Decline**. Either way the buzzer is released for everyone. A **Top hunters** leaderboard ranks players by their own points.

The first buzz is decided atomically in Redis, so if two people hit it at the same moment exactly one of them wins.

## Deploy on Vercel (about 5 minutes)

1. **Import the repo**: Vercel → *Add New… → Project* → pick this repo. Framework preset: **Other**. No build command needed.
2. **Add a free Redis database**. The simplest way is to create it on Upstash directly:
   1. Sign up at [console.upstash.com](https://console.upstash.com) (free, no card).
   2. **Create Database** → type **Redis**, pick the region closest to your Vercel functions (default `us-east-1`), plan **Free**.
   3. On the database page, under **REST API**, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   4. In Vercel: *Settings → Environment Variables* → add both with exactly those names.

   (If you'd rather go through Vercel, *Storage → Create Database → Upstash for Redis* creates the same database and adds the env vars for you. Each Upstash account gets **one** free database. If you see only paid plans there, that account already has one: use the direct route above with a different login.)
3. **Set the host password**: *Settings → Environment Variables* → add `ADMIN_PASSWORD` with a password only you know.
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the new env vars are picked up.

Then:
- Share `https://<your-app>.vercel.app` with everyone (the admin page has a *Copy link* button for the Zoom chat).
- Open `https://<your-app>.vercel.app/admin` yourself and log in with `ADMIN_PASSWORD`.

## Running the hunt

| Host action | How |
|---|---|
| Approve the first buzz (+1 to the player and their team) | **✓ Approve** or <kbd>A</kbd> |
| Decline it | **✗ Decline** or <kbd>D</kbd> |
| Lock buzzers between items so nobody buzzes early | **🔒 Lock buzzers** or <kbd>L</kbd> (press again to open) |
| Fix a team score | − / + on the Scareboard (team only) |
| Fix a player's points | Tap the player in the list → −1 / +1 (changes their team's score too) |
| Rename / add / remove teams | Edit the name in place, **＋ Team** / **− Team** |
| Remove a player who left | Tap the player → **Remove player** |
| Wipe team and player points, keep players | **↺ Reset scores** |
| Start over (everyone re-enters their name) | **🧹 New game** |

**Team balancing.** Each new player joins the team with the fewest players (ties are random). Whenever teams get uneven (you remove a player, or add or remove a team), the most recently joined players of the biggest team are moved to the smallest. Moved players see a message saying which team they're on now.

## How it works

- `public/`: static pages (`index.html` = player, `admin.html` = host), the shared theme and the fonts and Bob artwork from the main game.
- `api/`: Vercel functions: `state` (public state), `join`, `buzz`, `admin` (password protected).
- `lib/game.js`: game logic. Joining, buzzing and judging are Lua scripts, so each one runs atomically in Redis.

Players poll `/api/state` about once a second. Vercel's CDN and the function itself share one database read per second, so the load doesn't grow with the number of players. When you buzz, the result comes straight back from the server. With the admin page open, a live game uses about 40k Redis commands an hour. That's well inside Upstash's free 500K commands a month, so close the admin tab when you're not playing.

## Local development

```bash
# .env.local
UPSTASH_REDIS_REST_URL=...    # from your Upstash database
UPSTASH_REDIS_REST_TOKEN=...
ADMIN_PASSWORD=boo

npm run dev   # http://localhost:3000 and http://localhost:3000/admin
```

There are no dependencies. You need Node 22 or newer (`vercel dev` works too).
