# Deployment

Physics Nook has multiple deployables from one repository.

## Astro Site

Cloudflare Pages project: `physics-nook`

```sh
npm run build
```

Publish directory:

```text
dist
```

The site URL is configured from `PUBLIC_SITE_URL`, `SITE_URL`, or the default `https://physicsnook.com`.

## Standalone Game Client

Cloudflare Pages project: `physics-nook-game`

```sh
npm run game:build
```

The game client also publishes `dist`. In Cloudflare Pages, `CF_PAGES=1` makes the Vite build write to the repository root `dist` folder.

Manual Pages-style build:

```sh
npm run game:build:pages
```

Game client routes:

```text
/
/orbitals/
/ripples/
/coaster/
```

## WebSocket Server

The standalone game server runs from `apps/server/src/server.ts`:

```sh
npm run game:server
```

Port priority:

```text
GAME_WS_PORT
PORT
8788
```

Production clients default to `wss://ws.physicsnook.com`. Override with `VITE_GAME_WS_URL` or `PUBLIC_GAME_WS_URL` when needed.

The server runs on the GCP VM `physics-nook-game-server`. Deploy updates with:

```sh
npm run game:server:deploy
```

This runs `gcloud compute ssh` to `git pull` and restart the process, then checks
`/health` and `/coaster/health`. It needs `GAME_SERVER_RESTART_CMD` in a repo-root
`.env` (e.g. `sudo systemctl restart physics-nook-game`); see
`scripts/deploy-game-server.mjs` for all options.

## coaster slop (`/coaster/`)

coaster slop is an online multiplayer board game whose source of truth is a separate
local repo (`C:\Users\Nick\Desktop\coaster`, hotseat prototype). Its game logic and
UI are machine-copied into `packages/coaster/` (plus PNGs into
`apps/client/public/assets/`) — never edit those mirrors by hand.

Naming note: `tests/coaster/` and the `coaster-builder` interactive are the
unrelated physics coaster energy sim; the board game lives in `packages/coaster`,
`apps/client/coaster`, and `apps/server/src/coaster.ts`.

Update flow after changing the game locally:

```sh
npm run coaster:ship   # sync -> build -> commit/push (Pages) -> VM deploy, with prompts
```

Or step by step:

```sh
npm run coaster:sync         # copy source over; review git diff
git add packages/coaster apps/client/public/assets && git commit && git push
npm run game:server:deploy   # required whenever game rules (packages/coaster/game) changed
```

Deploy the server before (or with) the client when the protocol changes. The
server keeps authoritative game state and snapshots rooms to a temp file, so a
VM restart mid-game only causes a brief client reconnect.

## D1 Leaderboards

The kinematics challenges and the hidden Rabbit of Caerbannog game use Cloudflare
D1 through Pages Functions. They share one database and binding; each leaderboard
just adds its own tables via a migration (`migrations/0003_caerbannog_leaderboard.sql`
for Caerbannog).

```sh
wrangler d1 create physics-nook-kinematics
wrangler d1 migrations apply physics-nook-kinematics --remote
wrangler pages secret put LEADERBOARD_SALT
```

Required binding (shared by all leaderboards):

```text
KINEMATICS_DB
```

After creating the database, update `database_id` in `wrangler.toml`. `LEADERBOARD_SALT` must be private and at least 16 characters.

Optional legacy seeds:

```sh
npx wrangler d1 execute physics-nook-kinematics --remote --file seeds/kinematics_legacy_top10.sql
npx wrangler d1 execute physics-nook-kinematics --remote --file seeds/kinematics_goal_rush_legacy_top10.sql
```
