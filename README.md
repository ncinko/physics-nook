# Physics Nook

Physics Nook is an Astro learning site with interactive physics modules, plus a standalone Vite browser-game client and Node WebSocket server for shared physics experiments.

## Project Map

```text
apps/
  client/          Standalone Vite client for Manatee Royale, Orbitals, and Ripples
  server/          Node WebSocket server for game and shared simulation rooms
docs/              Project architecture, content, deployment, and maintenance notes
functions/         Cloudflare Pages Functions for leaderboard APIs
migrations/        Cloudflare D1 schema migrations
packages/shared/   Shared protocol, validation, constants, and simulation helpers
seeds/             Optional D1 seed data
server/            Coaster Park realtime room server
src/               Astro pages, layouts, React islands, styles, and site data
tests/             Node strip-types test runners by domain
```

## Common Commands

Run the Astro site:

```sh
npm run dev
npm run build
npm run preview
```

Run all domain tests:

```sh
npm run test:all
```

Run the standalone game client and server:

```sh
npm run game:dev
npm run game:server
```

The game client serves:

```text
http://localhost:5173/
http://localhost:5173/orbitals/
http://localhost:5173/ripples/
```

Run the legacy Coaster Park realtime room server:

```sh
npm run realtime
```

## Deployables

- `physics-nook`: Astro static site built with `npm run build`.
- `physics-nook-game`: Vite game client built with `npm run game:build`.
- `ws.physicsnook.com`: Node WebSocket server from `apps/server/src/server.ts`.
- Coaster Park realtime server: `server/realtime.mjs`, used by `/coaster-park`.

Both Cloudflare Pages projects publish `dist`; the build command decides what gets written there. See [Deployment](docs/deployment.md) for the full setup.

## Adding Work

- New learning pages should start with [Adding Content](docs/adding-content.md).
- New or changed simulations should follow [Adding Simulations](docs/adding-simulations.md).
- Repo boundaries and ownership live in [Architecture](docs/architecture.md).
- Cleanup, dependency, and artifact policy live in [Maintenance](docs/maintenance.md).

## 1D/2D Kinematics Leaderboards

The kinematics challenges use Cloudflare Pages Functions and D1:

```sh
wrangler d1 create physics-nook-kinematics
wrangler d1 migrations apply physics-nook-kinematics --remote
wrangler pages secret put LEADERBOARD_SALT
```

After creating the database, make sure `wrangler.toml` uses the correct `database_id`. The Pages binding name must remain `KINEMATICS_DB`, and `LEADERBOARD_SALT` should be private and at least 16 characters.
