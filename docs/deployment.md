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

## Coaster Realtime Server

Coaster Park uses the separate server at `server/realtime.mjs`:

```sh
npm run realtime
```

It listens on `COASTER_WS_PORT` or `8787`.

## D1 Leaderboards

The kinematics challenges use Cloudflare D1 through Pages Functions:

```sh
wrangler d1 create physics-nook-kinematics
wrangler d1 migrations apply physics-nook-kinematics --remote
wrangler pages secret put LEADERBOARD_SALT
```

Required binding:

```text
KINEMATICS_DB
```

After creating the database, update `database_id` in `wrangler.toml`. `LEADERBOARD_SALT` must be private and at least 16 characters.

Optional legacy seeds:

```sh
npx wrangler d1 execute physics-nook-kinematics --remote --file seeds/kinematics_legacy_top10.sql
npx wrangler d1 execute physics-nook-kinematics --remote --file seeds/kinematics_goal_rush_legacy_top10.sql
```
