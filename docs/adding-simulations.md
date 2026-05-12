# Adding Simulations

Interactive simulations should be easy to test, easy to embed in lessons, and isolated from unrelated page content.

## Recommended Shape

- Put deterministic model code in `src/lib/<domain>` for Astro-hosted simulations.
- Put shared multiplayer protocol, validation, and deterministic helpers in `packages/shared/src`.
- Put React islands in `src/components/<domain>` or `src/components/simulations`.
- Put focused tests in `tests/<domain>`.

For new work, prefer TypeScript and TSX. Existing JSX files do not need to be converted just because they were touched, but new shared logic should have types.

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
