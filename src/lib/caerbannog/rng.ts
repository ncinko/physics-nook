/**
 * Seeded PRNG for the hidden Caerbannog defense game. Keeping randomness
 * seedable makes wave spawns and upgrade offers deterministic, so the game
 * model can be unit tested in `tests/caerbannog`.
 *
 * The implementation moved to `src/lib/shared/rng.ts` when the Motion Match
 * game needed the same generator to rebuild seeded target graphs on the server.
 * This re-export keeps the caerbannog call sites and their tests unchanged.
 */

export { createRng, type Rng } from '../shared/rng.ts';
