/**
 * Wave difficulty curve for the Caerbannog defense game. Each successive wave
 * sends more killer rabbits, a little faster, with steadily growing toughness.
 * Pure and deterministic so the progression can be unit tested.
 *
 * The curve is tuned against the player's growing offense: grenade blessings
 * (every third wave) plus gold-bought static defenses (Tim, caltrops, the
 * keep). Rabbit hit points grow *continuously* rather than in integer steps so
 * the difficulty tracks that offense smoothly instead of plateauing — the old
 * `1 + floor((wave-1)/2)` curve fell behind a player who stacked damage and
 * blast radius.
 */

export interface WaveConfig {
  /** How many rabbits this wave sends. */
  count: number;
  /** Hit points per rabbit (fractional — proximity damage is continuous). */
  hp: number;
  /** Base advance speed in world units per second. */
  speed: number;
  /** Seconds between spawns within the wave. */
  spawnInterval: number;
}

const BASE_SPEED = 7; // world units/sec at wave 1 (field is ~90 units wide)

/** Round to one decimal so HP and the health bar read cleanly. */
const round1 = (n: number) => Math.round(n * 10) / 10;

export const waveConfig = (wave: number): WaveConfig => ({
  count: 3 + Math.floor(wave * 1.2),
  // Smooth, ever-climbing toughness. ~1.5 hp at wave 1, ~6.5 by wave 10,
  // ~12 by wave 20 — always a little ahead of a single un-upgraded blast so
  // the player has to lean on accuracy, blessings, and hired defenses.
  hp: round1(1.5 + (wave - 1) * 0.55),
  speed: BASE_SPEED * (1 + (wave - 1) * 0.06),
  spawnInterval: Math.max(0.4, 1.4 - wave * 0.05),
});

/** Blessings (grenade upgrades) are granted after waves 1, 4, 7, 10, … */
export const isBlessingWave = (wave: number): boolean => wave % 3 === 1;
