# AGENTS.md

Physics Nook: an Astro interactive physics textbook, plus a standalone Vite game client and Node WebSocket server. One repo, several deployables — see [README.md](README.md) for the project map.

## Commands

- `npm run dev` / `npm run build` / `npm run preview` — Astro site
- `npm run check` — astro check (type checking)
- `npm run test:<domain>` — domain tests (math, kinematics, forces, quantum, coaster, oscillations, ripple, solar); `npm run test:all` for everything
- `npm run game:dev` / `npm run game:build` — standalone Vite game client

Tests are plain Node scripts run with `--experimental-strip-types` (no test framework). Each `tests/<domain>/run-tests.ts` imports from `src/lib/<domain>` and throws on failure. Requires Node >= 22.12.

Verification expectations per change type are in [docs/adding-content.md](docs/adding-content.md) (content) and [docs/maintenance.md](docs/maintenance.md) (broad/maintenance work). Minimum for content-only changes: `npm run build`.

## Architecture

Read [docs/architecture.md](docs/architecture.md) before structural changes. The short version:

- `src/pages/` — Astro/MDX learning pages (math is written with remark-math + rehype-katex)
- `src/lib/<domain>/` — pure, DOM-free physics/model logic (deterministic, testable)
- `src/components/<domain>/` — React islands and Astro components for interactivity
- `src/data/` — centralized metadata: `site.ts` (SEO defaults), `modules/` (page registry + nav, one file per domain re-exported by `modules/index.ts`), `interactives.ts` (interactive-widget registry), `navigation.ts`
- `apps/client/`, `apps/server/`, `packages/shared/` — standalone multiplayer game surfaces
- `functions/`, `migrations/` — Cloudflare Pages Functions + D1 for leaderboards

## Conventions

- New lesson pages: follow the checklist in [docs/adding-content.md](docs/adding-content.md). Register every public page in `src/data/modules/`; register every interactive widget in `src/data/interactives.ts`.
- New/changed simulations: follow [docs/adding-simulations.md](docs/adding-simulations.md). Keep model logic in `src/lib/<domain>` with a test in `tests/<domain>`; keep rendering/controls in components.
- Layouts: `TextbookLayout.astro` for lessons, `BaseLayout.astro` for custom pages, `ImmersiveLayout.astro` only for full-screen tools.
- Hydrate React islands only where interactivity is needed; keep heavy deps (Three, KaTeX) isolated to pages that use them.
- Don't commit generated output (`dist/`, `.astro/`, screenshots, logs) — see [docs/maintenance.md](docs/maintenance.md).

## Environment

- Windows 11, PowerShell. Repo has mixed LF/CRLF line endings — git warns about LF→CRLF conversion; this is expected, don't "fix" line endings in unrelated files.
