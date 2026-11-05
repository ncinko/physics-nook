import assert from 'node:assert/strict';
import {
  DT,
  WaveSolver,
  faceDepth,
  sigmaAt,
  sourceDistance,
  wavelength,
  waveSpeed,
  type Source,
} from '../../src/lib/wavepool/solver.ts';
import { PRESETS, buildPreset, stampDisc, stampSegment } from '../../src/lib/wavepool/presets.ts';
import { clampTarget, orbitEye, pickGround } from '../../src/lib/wavepool/camera.ts';

const pointSource = (x: number, y: number, freq: number, amp = 1): Source => ({
  x,
  y,
  freq,
  amp,
  phase: 0,
  half: 0,
  angle: 0,
});

/** Right-going Gaussian pulse of unit height, uniform in y. */
function launchPulse(solver: WaveSolver, x0: number, width: number): void {
  const { n } = solver;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const c = j * n + i;
      const depth = solver.d[c]!;
      if (depth <= 0) continue;
      const speed = Math.sqrt(depth);
      solver.h[c] = Math.exp(-(((i + 0.5 - x0) / width) ** 2));
      // u = h / c for a right-going linear wave, evaluated on the face.
      solver.ux[c] = Math.exp(-(((i + 1 + 0.25 * speed - x0) / width) ** 2)) / speed;
    }
  }
}

function runFor(solver: WaveSolver, duration: number, sources: Source[] = []): void {
  const steps = Math.round(duration / DT);
  for (let s = 0; s < steps; s += 1) solver.step(sources);
}

// --- Static helpers ---
{
  assert.equal(faceDepth(1, 1), 1);
  assert.equal(faceDepth(1, 0), 0);
  assert.equal(faceDepth(0, 0), 0);
  assert.equal(faceDepth(1, 0.5), 0.75);

  // The sponge is zero in the interior, rises smoothly, and peaks at the outer edge.
  const n = 640;
  const a = 96;
  assert.equal(sigmaAt(n / 2, n / 2, n, a), 0);
  assert.equal(sigmaAt(a, n / 2, n, a), 0);
  assert.ok(sigmaAt(a / 2, n / 2, n, a) > 0);
  assert.ok(sigmaAt(a / 2, n / 2, n, a) < sigmaAt(a / 4, n / 2, n, a));
  assert.ok(Math.abs(sigmaAt(0, n / 2, n, a) - 13.8 / a) < 1e-12);

  assert.equal(waveSpeed(1), 1);
  assert.equal(waveSpeed(0.25), 0.5);
  assert.equal(wavelength(0.05), 20);
  // Surface tension shortens the wavelength at fixed frequency... no: raises phase speed,
  // so the wavelength at fixed frequency gets longer.
  assert.ok(wavelength(0.05, 1, 0.08) > wavelength(0.05, 1, 0));

  const line: Source = { ...pointSource(10, 10, 0.05), half: 5, angle: 0 };
  assert.equal(sourceDistance(line, 13, 10), 0);
  assert.equal(sourceDistance(line, 20, 10), 5);
  assert.equal(sourceDistance(line, 10, 14), 4);
}

// --- Camera ---
{
  const view = { yaw: 0.4, pitch: 0.9, distance: 300, targetX: 320, targetY: 320 };
  const eye = orbitEye(view);
  assert.ok(eye.z > 0);
  // Picking the screen centre returns the orbit target.
  const hit = pickGround(view, 0, 0, 1);
  assert.ok(hit && Math.abs(hit.x - 320) < 1e-6 && Math.abs(hit.y - 320) < 1e-6);
  // Sky does not hit the ground.
  assert.equal(pickGround({ ...view, pitch: 0.2 }, 0, 0.99, 1.6), null);
  // The target can never leave the interior, so the absorber is never reachable.
  const clamped = clampTarget(10_000, -10_000, 640, 96);
  assert.equal(clamped.x, 640 - 96);
  assert.equal(clamped.y, 96);
}

// --- Wavelength from frequency: a point source radiates lambda = c / f ---
{
  const solver = new WaveSolver({ n: 256, absorber: 64 });
  const freq = 0.05;
  const cx = 128;
  const source = pointSource(cx, cx, freq);
  runFor(solver, 200, [source]);
  // Zero up-crossings of h along +x give one wavelength apart.
  const row = Math.floor(cx);
  const crossings: number[] = [];
  for (let i = cx + 8; i < cx + 56; i += 1) {
    const a = solver.h[row * 256 + i]!;
    const b = solver.h[row * 256 + i + 1]!;
    if (a < 0 && b >= 0) crossings.push(i + -a / (b - a));
  }
  assert.ok(crossings.length >= 2, `found ${crossings.length} crossings`);
  const measured = crossings[1]! - crossings[0]!;
  assert.ok(Math.abs(measured - 20) < 0.6, `lambda was ${measured}, expected 20`);
}

// --- Speed scales as sqrt(depth) (refraction comes from this) ---
{
  const solver = new WaveSolver({ n: 200, absorber: 0 });
  solver.d.fill(0.25);
  launchPulse(solver, 50, 4);
  runFor(solver, 100);
  const row = 100;
  let peakAt = 0;
  let peak = -1;
  for (let i = 0; i < 200; i += 1) {
    const v = solver.h[row * 200 + i]!;
    if (v > peak) {
      peak = v;
      peakAt = i + 0.5;
    }
  }
  assert.ok(Math.abs(peakAt - (50 + 0.5 * 100)) < 2, `pulse at ${peakAt}, expected ~100`);
  assert.ok(peak > 0.9, `pulse amplitude ${peak}`);
}

// --- Closed box: bounded, and energy does not blow up (with and without dispersion) ---
for (const beta of [0, 0.08]) {
  const solver = new WaveSolver({ n: 128, absorber: 0, beta });
  solver.addBump(64, 64, 1, 4);
  const e0 = solver.energy();
  let maxH = 0;
  runFor(solver, 1000);
  for (const v of solver.h) maxH = Math.max(maxH, Math.abs(v));
  const e1 = solver.energy();
  assert.ok(Number.isFinite(e1) && maxH < 1, `beta ${beta}: maxH ${maxH}`);
  assert.ok(e1 < e0 * 1.05, `beta ${beta}: energy ${e0} -> ${e1}`);
  assert.ok(e1 > e0 * 0.3, `beta ${beta}: energy collapsed ${e0} -> ${e1}`);
}

// --- A solid wall reflects with the same sign and passes nothing ---
{
  const n = 200;
  const solver = new WaveSolver({ n, absorber: 0 });
  for (let j = 0; j < n; j += 1) for (let i = 140; i < 144; i += 1) solver.d[j * n + i] = 0;
  launchPulse(solver, 80, 5);
  runFor(solver, 40); // pulse reaches the wall around t = 60
  runFor(solver, 80);
  const row = 100;
  let reflected = 0;
  let transmitted = 0;
  for (let i = 0; i < 130; i += 1) reflected = Math.max(reflected, solver.h[row * n + i]!);
  for (let i = 146; i < n; i += 1) transmitted = Math.max(transmitted, Math.abs(solver.h[row * n + i]!));
  assert.ok(reflected > 0.93, `reflected amplitude ${reflected}`);
  assert.ok(transmitted < 1e-3, `transmitted ${transmitted}`);
}

// --- The outer absorber: a splash leaves without bouncing back ---
// The energy still in the pool after every wave has had time to reach the margin is
// the reflected energy. (Long waves are the hard case for a sponge, so test a broad bump.)
for (const radius of [3, 12]) {
  const n = 384;
  const solver = new WaveSolver({ n, absorber: 96 });
  solver.addBump(n / 2, n / 2, 1, radius);
  const e0 = solver.energy();
  runFor(solver, 480);
  const remaining = solver.energy() / e0;
  assert.ok(remaining < 0.002, `bump radius ${radius}: ${(remaining * 100).toFixed(3)}% of the energy is still in the pool`);
}

// --- Double slit: fringes land where the path difference is a whole number of wavelengths ---
{
  const n = 384;
  const solver = new WaveSolver({ n, absorber: 96 });
  const wallX = 150;
  const slitGap = 48; // centre-to-centre
  const slitWidth = 8;
  const cy = n / 2;
  for (let j = 0; j < n; j += 1) {
    const dist = Math.abs(j + 0.5 - cy);
    const inSlit = Math.abs(dist - slitGap / 2) < slitWidth / 2;
    if (inSlit) continue;
    for (let i = wallX; i < wallX + 4; i += 1) solver.d[j * n + i] = 0;
  }
  const freq = 0.1;
  const lambda = wavelength(freq);
  const source: Source = { ...pointSource(100, cy, freq), half: 80, angle: Math.PI / 2 };
  runFor(solver, 190, [source]);
  const screenX = 200;
  const intensity = new Float64Array(n);
  const period = 1 / freq;
  const samples = Math.round((3 * period) / DT);
  for (let s = 0; s < samples; s += 1) {
    solver.step([source]);
    for (let j = 0; j < n; j += 1) {
      const v = solver.h[j * n + screenX]!;
      intensity[j] = intensity[j]! + v * v;
    }
  }
  const lo = cy - 45;
  const hi = cy + 45;
  const peaks: number[] = [];
  for (let j = Math.ceil(lo); j <= hi; j += 1) {
    const v = intensity[j]!;
    if (v > intensity[j - 1]! && v >= intensity[j + 1]! && v > intensity[j - 2]! && v >= intensity[j + 2]!) peaks.push(j);
  }
  assert.ok(peaks.length >= 4, `expected several fringes, found ${peaks.length}: ${peaks.join(',')}`);
  // Bright fringes sit where the two path lengths differ by a whole number of wavelengths.
  // (Exact geometry, not the far-field lambda L / d, because the screen is close.)
  const slitX = wallX + 2; // middle of the 4-cell wall
  const L = screenX - slitX;
  const pathDiff = (y: number): number => Math.hypot(L, y - slitGap / 2) - Math.hypot(L, y + slitGap / 2);
  for (const m of [1, 2]) {
    let lo2 = 0;
    let hi2 = 60;
    for (let it = 0; it < 50; it += 1) {
      const mid2 = (lo2 + hi2) / 2;
      if (-pathDiff(mid2) < m * lambda) lo2 = mid2;
      else hi2 = mid2;
    }
    const predicted = lo2;
    for (const sign of [1, -1]) {
      const nearest = peaks.reduce((a, b) => (Math.abs(a - cy - sign * predicted) < Math.abs(b - cy - sign * predicted) ? a : b));
      assert.ok(
        Math.abs(nearest - cy - sign * predicted) <= 3,
        `order ${sign * m} fringe at ${nearest - cy}, predicted ${sign * predicted}`,
      );
    }
  }
  // And the far-field rule of thumb lambda * L / d is the right order of magnitude.
  const rough = (lambda * L) / slitGap;
  const firstOrder = Math.abs(peaks.filter((p) => p > cy + 2)[0]! - cy);
  assert.ok(firstOrder > 0.7 * rough && firstOrder < 1.5 * rough, `first order ${firstOrder} vs ${rough}`);
  // The central maximum is on the axis (symmetry).
  const central = peaks.reduce((a, b) => (intensity[a]! > intensity[b]! ? a : b));
  assert.ok(Math.abs(central - cy) <= 2, `central fringe at ${central}`);
}

// --- Presets and brushes ---
{
  const n = 640;
  for (const preset of PRESETS) {
    const built = buildPreset(preset.id, n, 96);
    assert.equal(built.depth.length, n * n);
    assert.ok(built.sources.length <= 8 && (preset.id === 'open' ? built.sources.length === 0 : built.sources.length >= 1), preset.id);
    // Nothing is built inside the absorber.
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        if (Math.min(i, j, n - 1 - i, n - 1 - j) < 96) {
          assert.equal(built.depth[j * n + i], 1, `${preset.id} touches the absorber at ${i},${j}`);
        }
      }
    }
    for (const s of built.sources) {
      assert.ok(s.x > 96 && s.x < n - 96 && s.y > 96 && s.y < n - 96, preset.id);
    }
  }

  const depth = new Float32Array(100 * 100).fill(1);
  stampDisc(depth, 100, 50, 50, 5, 'wall', 0);
  assert.equal(depth[50 * 100 + 50], 0);
  assert.equal(depth[50 * 100 + 60], 1);
  stampDisc(depth, 100, 50, 50, 5, 'erase', 0);
  assert.equal(depth[50 * 100 + 50], 1);
  stampSegment(depth, 100, 10, 10, 40, 10, 2, 'wall', 0);
  assert.equal(depth[10 * 100 + 25], 0);
  stampDisc(depth, 100, 50, 50, 8, 'shoal', 0.3);
  assert.ok(Math.abs(depth[50 * 100 + 50]! - 0.3) < 1e-6);
  assert.ok(depth[50 * 100 + 57]! > 0.3 && depth[50 * 100 + 57]! <= 1);
  // Shoal painting never turns a wall back into water.
  stampDisc(depth, 100, 50, 50, 5, 'wall', 0);
  stampDisc(depth, 100, 50, 50, 8, 'shoal', 0.3);
  assert.equal(depth[50 * 100 + 50], 0);
}

console.log('wavepool: all tests passed');
