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

Use an inline demo when the interaction teaches one local concept inside the reading flow. Inline demos should feel like touchable illustrations: minimal controls, direct manipulation where possible, small overlays instead of full panels, direct MDX placement instead of `SimulationBlock`, and usually `client:visible`.

Use a standalone lab when the interaction is a larger tool: multiple tasks, many adjustable parameters, audio, games, fullscreen needs, broad comparison workflows, or enough controls that the prose should step aside. Standalone labs should use `SimulationBlock` on lesson pages or `ImmersiveLayout` for full-screen tools.

When adding either kind, place an `InteractiveAnchor` immediately before the mounted component and point the catalog entry at that anchor.

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
