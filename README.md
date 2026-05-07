# Physics Nook

Physics Nook is currently an Astro learning site plus an early browser-based multiplayer arcade platformer prototype.

## Project Layout

```text
apps/
  client/          Vite + TypeScript canvas game client
  server/          Node + TypeScript authoritative WebSocket game server
packages/
  shared/          Shared game protocol, constants, and map data
server/            Existing coaster realtime room server
src/               Astro site pages, layouts, and simulations
tests/             Node strip-types test runners for physics modules
```

## Game Prototype Milestone

The first game milestone is a minimal 10-player lobby and movement prototype inspired by Killer Queen:

- Room/lobby support with a maximum of 10 connected players.
- Server-owned player slots, movement, gravity, platform collisions, and snapshots.
- Browser client that sends input only and renders authoritative snapshots.
- Shared TypeScript message types, constants, player config, and map data.
- Static client build intended for Cloudflare Pages at `game.physicsnook.com`.
- Separate game server intended for `ws.physicsnook.com`.

The prototype does not yet include objectives, combat, deaths, bots, matchmaking, persistence, or win conditions.

## Commands

Run the existing Astro site:

```sh
npm run dev
npm run build
npm run preview
```

Run the game server:

```sh
npm run game:server
```

Run the game client in development:

```sh
npm run game:dev
```

The dedicated multiplayer pages are served from the same Vite client:

```text
http://localhost:5173/orbitals/
http://localhost:5173/ripples/
```

Build the game client for static hosting:

```sh
npm run game:build
```

Run Ripple Tank Studio tests:

```sh
npm run test:ripple
```

The local game client defaults to `ws://localhost:8788`. In production over HTTPS it defaults to `wss://ws.physicsnook.com`. Override with `VITE_GAME_WS_URL` or `PUBLIC_GAME_WS_URL` when needed.

## Deployment Notes

Cloudflare Pages can build the game client with:

```sh
npm run game:build
```

Use `apps/client/dist` as the Pages output directory for `game.physicsnook.com`.

Host the authoritative server separately and expose it as `wss://ws.physicsnook.com`. The server process listens on `GAME_WS_PORT`, then `PORT`, then `8788`.
