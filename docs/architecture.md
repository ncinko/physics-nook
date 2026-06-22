# Architecture

Physics Nook is intentionally kept as one repository because the learning site, shared simulations, multiplayer experiments, and deployment configuration move together.

## Boundaries

`src/` is the Astro site. Pages live under `src/pages`, shared page metadata and navigation live under `src/data`, reusable layouts live under `src/layouts`, and UI components live under `src/components`.

UI components are organized one folder per physics domain (`src/components/<domain>/`, e.g. `kinematics/`, `quantum/`, `thermodynamics/`, `coaster/`), alongside cross-cutting folders for shared primitives (`shared/`), page chrome (`layout/`, `textbook/`, `modules/`), and interactive scaffolding (`interactive/`). A new interactive belongs in its domain folder — there is no generic catch-all (`src/components/simulations/` was retired in favor of this convention).

`src/lib/` holds browser-safe domain logic for Astro-hosted simulations. Put deterministic physics, scoring, validation, and geometry here when it can be tested without a DOM.

`apps/client/` is a standalone Vite application. It builds the multiplayer game surfaces at `/`, `/orbitals/`, and `/ripples/`. It imports shared protocol and simulation helpers from `packages/shared`.

`apps/server/` is the authoritative Node WebSocket server for the standalone game surfaces. It owns Manatee Royale rooms, Orbitals rooms, and Ripple Tank rooms.

`packages/shared/` holds cross-process contracts: message types, constants, sanitizers, and deterministic shared helpers used by both `apps/client` and `apps/server`.

`functions/` contains Cloudflare Pages Functions for leaderboard APIs. Keep request parsing and D1 calls here; shared validation belongs in `src/lib`.

`migrations/` and `seeds/` are D1 database assets. Migrations are schema history. Seeds are optional data imports and should be safe to run with `INSERT OR IGNORE`.

## Data Flow

Astro pages render static learning content and hydrate React islands only where interactivity is needed. Site metadata is centralized in `src/data/site.ts` and `src/data/modules/` (one file per domain, assembled by `src/data/modules/index.ts`); layouts should read from those sources instead of duplicating SEO defaults.

Multiplayer browser clients send input or state patches to the WebSocket server. The server validates messages with shared sanitizers, owns authoritative room state, and broadcasts snapshots back to clients.

Leaderboard pages call Cloudflare Pages Functions. Functions validate submissions with shared helpers, hash client addresses with `LEADERBOARD_SALT`, and store runs/scores in D1.

## Ownership Rules

- Put new Astro learning content in `src/pages` and register public metadata in the domain's file under `src/data/modules/`.
- Put reusable page chrome in `src/layouts` or `src/components/textbook`.
- Put pure model code in `src/lib/<domain>` or `packages/shared/src`.
- Put a React island in its domain folder `src/components/<domain>/`; reserve `src/components/shared` for cross-domain primitives.
- Put standalone game runtime code in `apps/client/src` or `apps/server/src`.
- Put focused tests in `tests/<domain>`.

## Known Pressure Points

Large files are allowed when they are active prototypes, but future edits should opportunistically extract stable model logic and repeated rendering helpers. The highest-value future extraction targets are `apps/client/src/main.ts`, `apps/client/src/ripple-main.ts`, `apps/server/src/server.ts`, and the largest simulation islands (for example `src/components/waves/AdditiveSynthLab.tsx`, `src/components/coaster/CoasterBuilder3D.jsx`, and `src/components/forces/ForcesNewtInteractives.tsx`).
