# Adding Simulations

Interactive simulations should be easy to test, easy to embed in lessons, and isolated from unrelated page content.

## Recommended Shape

- Put deterministic model code in `src/lib/<domain>` for Astro-hosted simulations.
- Put shared multiplayer protocol, validation, and deterministic helpers in `packages/shared/src`.
- Put React islands in `src/components/<domain>` or `src/components/simulations`.
- Put focused tests in `tests/<domain>`.
- Register reachable demos and labs in `src/data/interactives.ts` so `/interactives` stays complete.

For new work, prefer TypeScript and TSX. Existing JSX files do not need to be converted just because they were touched, but new shared logic should have types.

## Inline vs Standalone

Use an inline demo when the interaction teaches one local concept inside the reading flow. Inline demos should feel like touchable illustrations: minimal controls, direct manipulation where possible, small overlays instead of full panels, and direct MDX placement instead of `SimulationBlock`.

Use a standalone lab when the interaction is a larger tool: multiple tasks, many adjustable parameters, audio, games, fullscreen needs, broad comparison workflows, or enough controls that the prose should step aside. Standalone labs should use `SimulationBlock` on lesson pages or `ImmersiveLayout` for full-screen tools.

When adding either kind, place an `InteractiveAnchor` immediately before the mounted component, point the catalog entry in `src/data/interactives.ts` at that anchor, and set its `kind` to match how the component is actually mounted.

### Shared UI building blocks

Build controls and readouts from the shared primitives so every interactive themes consistently (light/dark/pastel) and reads the same way. Do not hand-roll control rows or info panels with ad-hoc inline styles.

- `src/components/shared/themeColors.ts` — the `themeColors()` palette plus `getCssColor` / `onThemeChange` for canvas drawing that follows the active theme.
- `src/components/shared/InlineControls.tsx` — `ControlBar` (a wrapping control row) with `Slider`, `Toggle`, `Select`, and `Button`. Native range/checkbox inputs inherit the theme accent via `global.css`.
- `src/components/shared/Readout.tsx` — `Readout` with `Readout.Group` / `Readout.Value`; presentation- and count-agnostic (see below).
- `SimulationBlock` (standalone only) — the breakout shell, header, and fullscreen toggle.

Colors come from CSS custom properties in `global.css` (`--text-primary`, `--grid-line`, `--surface-elevated`, `--accent-*`), mirrored by Tailwind `theme-*` aliases. Use these tokens, not hardcoded hex.

### Scene surfaces

Treat a transparent, unboxed scene as the default for inline illustrations. Add a filled background, border, or shadow only when the surface carries useful meaning: for example, it defines a plot or data region, provides necessary contrast, or marks a direct-manipulation boundary. Do not put every animation on a `--sim-bg` panel merely to contain it visually; let simple diagrams and motion illustrations sit naturally in the reading flow.

### Readouts

Show the fewest values that make the point. Prefer the lightest form: values woven into the caption/prose, or a single grouped `Readout` (`variant="panel"`, the default). Reserve per-value cards (`variant="cards"`) for dashboard-style standalone tools; do not make them the default cadence.

### Inline checklist

- Mount directly in MDX (no `SimulationBlock`); the component owns its own centering and max width.
- Default to a transparent scene; add a panel surface only when it improves meaning, contrast, or interaction clarity.
- Keep controls in one `ControlBar`; keep any readout light (grouped `Readout` or inline values).
- Read theme colors through `themeColors` / CSS tokens; no hardcoded palettes.
- Hydrate with `client:visible`, or `client:only="react"` for canvas islands that gain nothing from SSR.
- `kind: 'inline'` in `interactives.ts`.

### Standalone checklist

- Wrap in `SimulationBlock` (`width`, `title`/`description`, fullscreen) on lesson pages, or use `ImmersiveLayout` for full-screen tools.
- Use the same `ControlBar` / `Button` / `Readout` primitives so it matches the inline demos.
- `kind: 'standalone'` in `interactives.ts`.

## Component Boundaries

Simulation components should own rendering, inputs, and local UI state. Physics, scoring, geometry generation, and validation should live in a pure helper where practical.

If a simulation needs server state, keep the message contract in `packages/shared` and validate every untrusted payload on the server.

## Testing

At minimum, test deterministic helpers:

- validation and sanitization boundaries;
- conservation or monotonicity properties where relevant;
- scoring rules;
- geometry continuity and collision cases;
- protocol behavior for multiplayer rooms.

Each domain test runner should be callable from `package.json`. Add new runners to `test:all`.

## Large Files

Do not split a large simulation only for line count. Extract when the change creates a stable boundary, such as a reusable solver, a protocol validator, a drawing primitive, or a pure scoring function.

Current high-value extraction targets when touched:

- `apps/client/src/main.ts`
- `apps/client/src/ripple-main.ts`
- `apps/server/src/server.ts`
- large files under `src/components/simulations`
