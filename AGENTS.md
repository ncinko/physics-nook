# AGENTS.md

Physics Nook is an Astro interactive physics textbook, plus a standalone Vite game client and Node WebSocket server. One repo has several deployables; see [README.md](README.md) for the project map.

## Commands

- `npm run dev` / `npm run build` / `npm run preview` - Astro site
- `npm run check` - Astro type checking
- `npm run audit:repo` - repo metadata, catalog, and cleanup guardrails
- `npm run test:<domain>` - domain tests; run `npm run test:all` for the full suite
- `npm run game:dev` / `npm run game:build` - standalone Vite game client
- `npm run game:server` - Node WebSocket server

Tests are plain Node scripts run with `--experimental-strip-types` and no test framework. Requires Node >= 22.12.

Use npm only. `package-lock.json` is the canonical lockfile; do not add pnpm, yarn, or bun lockfiles.

## Architecture

Read [docs/architecture.md](docs/architecture.md) before structural changes. The short version:

- `src/pages/` - Astro/MDX learning pages
- `src/lib/<domain>/` - pure, DOM-free physics/model logic
- `src/components/<domain>/` - React islands and Astro components for interactivity
- `src/data/` - centralized metadata: `site.ts`, `modules/`, `interactives.ts`, and `navigation.ts`
- `apps/client/`, `apps/server/`, `packages/shared/` - standalone multiplayer/game surfaces
- `functions/`, `migrations/` - Cloudflare Pages Functions and D1 leaderboards

## Visual Baseline

Before changing layout or design language, read [docs/design-baseline.md](docs/design-baseline.md). The published site is the visual source of truth: sparse immersive homepage, compact nav, quiet lesson pages, dense interactives index, and black-outlined module cards.

## Conventions

- New lesson pages: follow [docs/adding-content.md](docs/adding-content.md). Register every public page in `src/data/modules/`.
- New or changed simulations: follow [docs/adding-simulations.md](docs/adding-simulations.md). Keep model logic in `src/lib/<domain>` and rendering/controls in domain components.
- Register every reachable interactive widget in `src/data/interactives.ts`.
- Layouts: `TextbookLayout.astro` for lessons, `BaseLayout.astro` for custom pages, `ImmersiveLayout.astro` only for full-screen tools.
- Hydrate React islands only where interactivity is needed; keep heavy dependencies isolated to pages that use them.
- Do not commit generated output (`dist/`, `.astro/`, screenshots, logs); see [docs/maintenance.md](docs/maintenance.md).

## Environment

- Windows 11, PowerShell.
- Repo has mixed LF/CRLF line endings; git warnings about LF-to-CRLF conversion are expected. Do not normalize unrelated files.
