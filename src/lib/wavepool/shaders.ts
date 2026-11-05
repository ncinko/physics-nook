// WGSL for the wave pool. `simShader` is a direct port of WaveSolver in solver.ts
// (same staggered grid, same semi-implicit damping, same Neumann treatment of walls),
// so the CPU reference tests also describe what the GPU does.

import { MAX_SOURCES } from './solver.ts';

export const PARAMS_STRIDE = 512; // dynamic-offset stride, >= minUniformBufferOffsetAlignment
export const PARAMS_FLOATS = 80; // 320 bytes used
export const RENDER_FLOATS = 4 * 4 + 4 * 4 + MAX_SOURCES * 4 * 2;

export const simShader = /* wgsl */ `
struct Source {
  a: vec4<f32>, // x, y, omega, amp
  b: vec4<f32>, // phase, half length, angle, unused
}

struct Params {
  n: u32,
  nsrc: u32,
  pad0: u32,
  pad1: u32,
  dt: f32,
  time: f32,
  beta: f32,
  friction: f32,
  absorber: f32,
  sigmaFactor: f32,
  sigmaPower: f32,
  pad2: f32,
  bump: vec4<f32>, // x, y, amp, radius (amp == 0: none)
  sources: array<Source, ${MAX_SOURCES}>,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> H: array<f32>;
@group(0) @binding(2) var<storage, read_write> UX: array<f32>;
@group(0) @binding(3) var<storage, read_write> UY: array<f32>;
@group(0) @binding(4) var<storage, read> D: array<f32>;

fn idx(i: i32, j: i32) -> u32 {
  return u32(j) * P.n + u32(i);
}

fn sigma(x: f32, y: f32) -> f32 {
  if (P.absorber <= 0.0) { return 0.0; }
  let nf = f32(P.n);
  let edge = min(min(x, y), min(nf - x, nf - y));
  let s = clamp((P.absorber - edge) / P.absorber, 0.0, 1.0);
  return P.sigmaFactor / P.absorber * pow(s, P.sigmaPower);
}

fn faceDepth(a: f32, b: f32) -> f32 {
  return select(0.5 * (a + b), 0.0, a <= 0.0 || b <= 0.0);
}

// Height with a no-flux neighbour: out of range or solid reads as the centre value.
fn hs(centre: f32, i: i32, j: i32) -> f32 {
  let n = i32(P.n);
  if (i < 0 || j < 0 || i >= n || j >= n) { return centre; }
  let k = idx(i, j);
  return select(H[k], centre, D[k] <= 0.0);
}

fn q(i: i32, j: i32) -> f32 {
  let hc = H[idx(i, j)];
  if (P.beta == 0.0) { return hc; }
  let lap = hs(hc, i + 1, j) + hs(hc, i - 1, j) + hs(hc, i, j + 1) + hs(hc, i, j - 1) - 4.0 * hc;
  return hc - P.beta * lap;
}

@compute @workgroup_size(8, 8)
fn stepVelocity(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let n = i32(P.n);
  let i = i32(gid.x);
  let j = i32(gid.y);
  let c = idx(i, j);
  let dt = P.dt;

  var ux = 0.0;
  if (i < n - 1) {
    let df = faceDepth(D[c], D[c + 1u]);
    if (df > 0.0) {
      let damp = 0.5 * dt * (sigma(f32(i + 1), f32(j) + 0.5) + P.friction);
      let grad = q(i + 1, j) - q(i, j);
      ux = ((1.0 - damp) * UX[c] - dt * grad) / (1.0 + damp);
    }
  }
  UX[c] = ux;

  var uy = 0.0;
  if (j < n - 1) {
    let df = faceDepth(D[c], D[c + P.n]);
    if (df > 0.0) {
      let damp = 0.5 * dt * (sigma(f32(i) + 0.5, f32(j + 1)) + P.friction);
      let grad = q(i, j + 1) - q(i, j);
      uy = ((1.0 - damp) * UY[c] - dt * grad) / (1.0 + damp);
    }
  }
  UY[c] = uy;
}

fn sourceWeight(s: Source, px: f32, py: f32) -> f32 {
  let dx = px - s.a.x;
  let dy = py - s.a.y;
  let ca = cos(s.b.z);
  let sa = sin(s.b.z);
  let along = dx * ca + dy * sa;
  let across = -dx * sa + dy * ca;
  let clamped = clamp(along, -s.b.y, s.b.y);
  let r2 = (along - clamped) * (along - clamped) + across * across;
  return exp(-r2 / (2.0 * 1.5 * 1.5));
}

@compute @workgroup_size(8, 8)
fn stepHeight(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  let n = i32(P.n);
  let i = i32(gid.x);
  let j = i32(gid.y);
  let c = idx(i, j);
  let dc = D[c];
  if (dc <= 0.0) {
    H[c] = 0.0;
    return;
  }
  var fxE = 0.0;
  var fxW = 0.0;
  var fyN = 0.0;
  var fyS = 0.0;
  if (i < n - 1) { fxE = faceDepth(dc, D[c + 1u]) * UX[c]; }
  if (i > 0) { fxW = faceDepth(D[c - 1u], dc) * UX[c - 1u]; }
  if (j < n - 1) { fyN = faceDepth(dc, D[c + P.n]) * UY[c]; }
  if (j > 0) { fyS = faceDepth(D[c - P.n], dc) * UY[c - P.n]; }
  let div = fxE - fxW + fyN - fyS;

  var inject = 0.0;
  let px = f32(i) + 0.5;
  let py = f32(j) + 0.5;
  for (var k = 0u; k < P.nsrc; k = k + 1u) {
    let s = P.sources[k];
    inject = inject + s.a.w * sin(s.a.z * P.time + s.b.x) * sourceWeight(s, px, py);
  }
  let damp = 0.5 * P.dt * sigma(px, py);
  H[c] = ((1.0 - damp) * H[c] - P.dt * div + P.dt * inject) / (1.0 + damp);
}

@compute @workgroup_size(8, 8)
fn addBump(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.n || gid.y >= P.n) { return; }
  if (P.bump.z == 0.0) { return; }
  let c = idx(i32(gid.x), i32(gid.y));
  if (D[c] <= 0.0) { return; }
  let dx = f32(gid.x) + 0.5 - P.bump.x;
  let dy = f32(gid.y) + 0.5 - P.bump.y;
  H[c] = H[c] + P.bump.z * exp(-(dx * dx + dy * dy) / (2.0 * P.bump.w * P.bump.w));
}
`;

export const renderShader = /* wgsl */ `
struct R {
  eye: vec4<f32>,
  fwd: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  a: vec4<f32>,      // aspect, tanHalf, n, absorber
  b: vec4<f32>,      // height scale, mode (0 = lit water, 1 = top-down), wall height, overlay radius
  cursor: vec4<f32>, // x, y, radius, visible
  sun: vec4<f32>,
  src: array<vec4<f32>, ${MAX_SOURCES}>,  // x, y, half length, angle
  flag: array<vec4<f32>, ${MAX_SOURCES}>, // exists, selected, 0, 0
}

@group(0) @binding(0) var<uniform> V: R;
@group(0) @binding(1) var<storage, read> H: array<f32>;
@group(0) @binding(2) var<storage, read> D: array<f32>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

fn nCells() -> i32 { return i32(V.a.z); }

fn cellH(i: i32, j: i32) -> f32 {
  let n = nCells();
  if (i < 0 || j < 0 || i >= n || j >= n) { return 0.0; }
  let k = u32(j * n + i);
  return select(H[k], 0.0, D[k] <= 0.0);
}

fn cellD(i: i32, j: i32) -> f32 {
  let n = nCells();
  if (i < 0 || j < 0 || i >= n || j >= n) { return 1.0; }
  return D[u32(j * n + i)];
}

fn sampleH(p: vec2<f32>) -> f32 {
  let q = p - vec2(0.5);
  let f = floor(q);
  let t = q - f;
  let i = i32(f.x);
  let j = i32(f.y);
  let a = mix(cellH(i, j), cellH(i + 1, j), t.x);
  let b = mix(cellH(i, j + 1), cellH(i + 1, j + 1), t.x);
  return mix(a, b, t.y);
}

fn sampleD(p: vec2<f32>) -> f32 {
  return cellD(i32(floor(p.x)), i32(floor(p.y)));
}

// Waves fade out over the absorbing margin so the simulated domain has no visible edge.
fn fade(p: vec2<f32>) -> f32 {
  let nf = V.a.z;
  let e = min(min(p.x, p.y), min(nf - p.x, nf - p.y));
  return smoothstep(V.a.w * 0.15, V.a.w * 0.9, e);
}

fn height(p: vec2<f32>) -> f32 {
  return sampleH(p) * V.b.x * fade(p);
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let h = clamp(dir.z, 0.0, 1.0);
  let horizon = vec3(1.05, 0.62, 0.38);
  let mid = vec3(0.42, 0.45, 0.62);
  let zenith = vec3(0.06, 0.14, 0.32);
  var c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  c = mix(c, zenith, smoothstep(0.12, 0.8, h));
  let s = max(dot(dir, V.sun.xyz), 0.0);
  c = c + vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.5;
  c = c + vec3(1.0, 0.85, 0.6) * pow(s, 600.0) * 18.0;
  return c;
}

fn tonemap(c: vec3<f32>) -> vec3<f32> {
  let a = c * (c * 2.51 + vec3(0.03));
  let b = c * (c * 2.43 + vec3(0.59)) + vec3(0.14);
  return clamp(a / b, vec3(0.0), vec3(1.0));
}

fn segDist(px: vec2<f32>, c: vec2<f32>, halfLen: f32, angle: f32) -> f32 {
  let d = px - c;
  let ca = cos(angle);
  let sa = sin(angle);
  let along = d.x * ca + d.y * sa;
  let across = -d.x * sa + d.y * ca;
  let cl = clamp(along, -halfLen, halfLen);
  return length(vec2(along - cl, across));
}

fn overlay(col: vec3<f32>, p: vec2<f32>) -> vec3<f32> {
  var c = col;
  let r = V.b.w;
  for (var k = 0; k < ${MAX_SOURCES}; k = k + 1) {
    let fl = V.flag[k];
    if (fl.x < 0.5) { continue; }
    let s = V.src[k];
    let dist = segDist(p, s.xy, s.z, s.w);
    let sel = fl.y;
    let tint = mix(vec3(1.0, 0.85, 0.3), vec3(1.0, 1.0, 1.0), sel);
    let ring = smoothstep(r * 0.2, 0.0, abs(dist - r * 0.9));
    let core = smoothstep(r * 0.65, r * 0.55, dist);
    c = mix(c, tint, max(ring, core * 0.85));
  }
  if (V.cursor.w > 0.5) {
    let dc = length(p - V.cursor.xy);
    let ring = smoothstep(V.b.w * 0.18, 0.0, abs(dc - V.cursor.z));
    c = mix(c, vec3(1.0), ring * 0.85);
  }
  return c;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let eye = V.eye.xyz;
  let dir = normalize(V.fwd.xyz + V.right.xyz * (in.ndc.x * V.a.x * V.a.y) + V.up.xyz * (in.ndc.y * V.a.y));
  let wallTop = V.b.z;
  let topDown = V.b.y > 0.5;

  // Sky: the ray never reaches the ground.
  if (dir.z >= -0.0005) {
    return vec4(pow(tonemap(skyColor(dir)), vec3(1.0 / 2.2)), 1.0);
  }

  // Water plane hit.
  let tWater = -eye.z / dir.z;
  let tTop = max(0.0, (wallTop - eye.z) / dir.z);
  var t = tWater;
  var hitWall = false;
  var wallTopFace = false;
  var wallNormal = vec3(0.0, 0.0, 1.0);

  if (wallTop > 0.0) {
    // March the slab 0 < z < wallTop one cell at a time looking for walls.
    let pTop = eye + dir * tTop;
    if (sampleD(pTop.xy) <= 0.0) {
      hitWall = true;
      wallTopFace = true;
      t = tTop;
    } else {
      let span = tWater - tTop;
      let horiz = max(length(dir.xy), 1e-4);
      let steps = clamp(i32(ceil(span * horiz)) + 1, 1, 80);
      let dt = span / f32(steps);
      var prev = pTop.xy;
      for (var s = 1; s <= steps; s = s + 1) {
        let tt = tTop + dt * f32(s);
        let pp = eye + dir * tt;
        if (sampleD(pp.xy) <= 0.0) {
          hitWall = true;
          t = tt;
          // Side-face normal from the solid gradient.
          let gx = f32(sampleD(pp.xy + vec2(1.0, 0.0)) > 0.0) - f32(sampleD(pp.xy - vec2(1.0, 0.0)) > 0.0);
          let gy = f32(sampleD(pp.xy + vec2(0.0, 1.0)) > 0.0) - f32(sampleD(pp.xy - vec2(0.0, 1.0)) > 0.0);
          var nn = vec2(gx, gy);
          if (length(nn) < 0.1) { nn = normalize(prev - pp.xy + vec2(1e-4)); }
          wallNormal = vec3(normalize(nn), 0.0);
          break;
        }
        prev = pp.xy;
      }
    }
  }

  let p3 = eye + dir * t;
  let ground = eye + dir * tWater;
  let sunDir = V.sun.xyz;
  var col: vec3<f32>;

  if (hitWall) {
    let lit = select(max(dot(wallNormal, sunDir), 0.0), 0.55, wallTopFace);
    let stone = vec3(0.62, 0.58, 0.52);
    col = stone * (0.25 + 0.9 * lit);
    if (topDown) { col = vec3(0.55, 0.56, 0.6); }
  } else {
    let p = ground.xy;
    let e = 1.0;
    let hx = height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0));
    let hy = height(p + vec2(0.0, e)) - height(p - vec2(0.0, e));
    let depthHere = clamp(sampleD(p), 0.0, 1.0);
    let hh = height(p);
    if (topDown) {
      let v = clamp(hh * 0.6, -1.0, 1.0);
      let bg = mix(vec3(0.05, 0.1, 0.16), vec3(0.09, 0.2, 0.22), 1.0 - depthHere);
      col = select(mix(bg, vec3(0.2, 0.55, 0.95), -v), mix(bg, vec3(1.0, 0.8, 0.45), v), v > 0.0);
    } else {
      let n = normalize(vec3(-0.5 * hx, -0.5 * hy, 1.0));
      let v = normalize(eye - ground);
      let cosv = clamp(dot(n, v), 0.0, 1.0);
      let fres = min(0.02 + 0.98 * pow(1.0 - cosv, 5.0), 0.3);
      let refl = reflect(-v, n);
      let sky = skyColor(vec3(refl.x, refl.y, abs(refl.z)));
      let deep = vec3(0.01, 0.07, 0.11);
      let shallow = vec3(0.04, 0.26, 0.28);
      var body = mix(deep, shallow, 1.0 - depthHere);
      body = body + vec3(0.02, 0.07, 0.06) * clamp(hh * 3.0, -0.5, 1.0);
      col = mix(body, sky, fres);
    }
  }

  col = overlay(col, ground.xy);

  if (!topDown) {
    // Distance haze toward the horizon colour.
    let dist = length(p3 - eye);
    let fog = 1.0 - exp(-dist * 0.0002);
    col = mix(col, vec3(0.05, 0.17, 0.21), fog);
  }

  return vec4(pow(tonemap(col), vec3(1.0 / 2.2)), 1.0);
}
`;
