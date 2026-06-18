/**
 * Wave difficulty curve for the Caerbannog defense game. Each successive wave
 * sends more killer rabbits, a little faster, with slowly growing toughness.
 * Pure and deterministic so the progression can be unit tested.
 */

export interface WaveConfig {
  /** How many rabbits this wave sends. */
  count: number;
  /** Hit points per rabbit. */
  hp: number;
  /** Base advance speed in world units per second. */
  speed: number;
  /** Seconds between spawns within the wave. */
  spawnInterval: number;
}

const BASE_SPEED = 7; // world units/sec at wave 1 (field is ~90 units wide)

export const waveConfig = (wave: number): WaveConfig => ({
  count: 2 + wave * 2,
  hp: 1 + Math.floor((wave - 1) / 2),
  speed: BASE_SPEED * (1 + (wave - 1) * 0.08),
  spawnInterval: Math.max(0.45, 1.4 - wave * 0.05),
});
