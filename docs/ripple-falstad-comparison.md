# Ripple Tank vs Falstad RippleGL

This note compares Physics Nook's current Ripple Tank Studio logic with Paul Falstad's
[`pfalstad/ripplegl`](https://github.com/pfalstad/ripplegl). It is meant as engineering context
for future simulator work, not as a formal derivation.

Falstad source references use commit
[`28c479d268983cfca49d2b61322932ac8469348e`](https://github.com/pfalstad/ripplegl/tree/28c479d268983cfca49d2b61322932ac8469348e)
so line links stay stable.

## Current Physics Nook Model

Our ripple simulation runs in the browser on CPU-side typed arrays in
[`apps/client/src/ripple-main.ts`](../apps/client/src/ripple-main.ts). The grid stores three height
fields:

- `previous`
- `current`
- `next`

The core update is a height-history finite-difference step:

```ts
nextValue = ((neighborSum * 0.5) - previous[index]) * DAMPING;
```

Objects are represented by an `objectMask`. Masked cells are held at zero, and masked neighbors are
sampled as a softened inverted value:

```ts
objectMask[index] ? -grid.current[currentIndex] * 0.78 : grid.current[index]
```

That produces recognizable reflection from barriers, slits, and parabolas without requiring a
separate material or velocity field. It is deliberately lightweight and works well with the shared
room model, where the server synchronizes emitters, objects, splashes, pause/reset state, and
presence through snapshots in [`apps/server/src/ripple.ts`](../apps/server/src/ripple.ts).

## Falstad RippleGL Model

Falstad's simulator runs the numerical update in WebGL. The state lives in floating-point render
textures:

- red channel: wave position/height
- green channel: wave velocity
- blue channel: wall or medium value

The simulation shader samples the four neighbor cells, averages them, and updates velocity and
position:

```glsl
mid = .25*(mid1+mid2+mid3+mid4);
newvel = med*(mid-pos)+vel*vDamping;
newpos = pos+newvel;
```

Relevant source:

- [`war/Ripple.html` shader](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/war/Ripple.html#L160-L205)
- [`war/ripple.js` WebGL runtime](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/war/ripple.js#L341-L381)
- [`src/com/falstad/ripple/client/RippleSim.java` frame loop](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/RippleSim.java#L1003-L1024)

This gives Falstad more physical controls than our current implementation: explicit velocity,
medium-dependent propagation, fixed-wall versus acoustic-wall behavior, and GPU-side rasterization
of walls and media.

## Feature Comparison

| Area | Physics Nook | Falstad RippleGL |
| --- | --- | --- |
| Solver state | Three height fields: `previous/current/next` | Float textures storing position, velocity, and wall/medium |
| Update path | CPU loops over typed arrays, then Canvas 2D drawing | WebGL shader ping-pongs render textures |
| Damping | Fixed global damping plus hidden sink and boundary damping | User damping slider applied to simulation geometry |
| Boundary handling | Absorbing layer plus hidden sink around active world | Off-screen border with damped simulation strips |
| Walls | Boolean mask with softened fixed reflection | Blue-channel wall/media encoding; acoustic mode can mirror samples |
| Media | No variable propagation medium yet | Blue-channel medium controls wave response |
| Sources | Shared sine emitters plus pointer splashes | Sine, pulse, packet, triangle, line source, Gaussian line source, phased arrays, moving/rotating source classes |
| Objects | Barrier, single slit, double slit, parabola | Walls, slits, parabolas, lenses, ellipses, prisms, media regions, cavities, mode boxes |
| Rendering | Canvas 2D cells plus optional gradient drawing | WebGL 2D and 3D views with brightness/color schemes |
| Architecture | Multiplayer room state synchronized by Node server | Single-user local simulator with import/export |

## Sources and Objects

Our sources are collaborative emitters whose shared settings are validated in
[`packages/shared/src/ripple.ts`](../packages/shared/src/ripple.ts). They inject a soft cosine-squared
disk into the current height field each frame. That is visually smooth and network-friendly, but it
does not yet model distinct source waveforms.

Falstad's `Source` class computes waveform values before drawing into the simulation texture. It
supports sine, triangle, pulse, and wave-packet behavior, including phase continuity when frequency
changes:

- [`Source.java` waveform value](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/Source.java#L112-L139)
- [`LineSource.java`](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/LineSource.java)

For slits, our implementation treats a single-slit or double-slit object as a rotated rectangular
mask with openings. Falstad treats a slit as a line wall with one or more gaps cut out along the
wall segment:

- [`Slit.java` segmented wall drawing](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/Slit.java#L42-L58)

For parabolas, both systems draw a parabolic barrier. Falstad rasterizes it into the simulation
texture:

- [`Parabola.java`](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/Parabola.java)
- [`ripple.js` `drawParabola`](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/war/ripple.js#L699-L724)

## Why Falstad's Off-Screen Boundary Looks Reflection-Free

Falstad still has numerical boundaries. The important point is that the visible area is not the
whole simulation grid, and the boundaries are pushed far enough away and damped enough that returned
energy is usually not visually obvious.

Likely reasons:

1. **The displayed window excludes the border.** Falstad chooses texture coordinates that sample
   from `windowOffsetX/gridSizeX` to `1 - windowOffsetX/gridSizeX`, so the visible render is cropped
   to the interior window rather than the full simulation texture. The actual grid edge lives outside
   that displayed region.

2. **The simulation grid includes an off-screen border.** `setResolution()` sets a border of
   `newWidth / 8`, with a minimum of 20 cells, then makes the full grid
   `windowWidth + 2 * windowOffsetX` by `windowHeight + 2 * windowOffsetY`. A wave must travel into
   that hidden border before it can encounter the numerical edge.

3. **Side and corner strips get their own simulation geometry.** `ripple.js` builds separate
   rectangles for the visible area, side strips, top/bottom strips, and corners. This lets the solver
   assign damping attributes across the off-screen regions rather than treating the entire grid as
   one visible block.

4. **The far outer edge is damped more heavily.** In `setPosRect()`, vertices at the near-outer grid
   edge get a lower damping value. That reduces the amplitude of waves reaching the boundary and
   reduces any wave returning from it.

5. **The display shader only shows the interior sample range.** Even if there is some reflection or
   numerical disturbance near the outer grid edge, the normal 2D render is sampling the interior
   texture coordinates. Boundary artifacts must propagate back through the hidden border before they
   become visible.

6. **Damping and presets often hide the return trip.** Falstad's damping slider maps to
   `exp(-dampingBar * 0.0002)`, and many setups use finite sources or enough damping that waves lose
   energy before reflected components can re-enter the visible window strongly.

Relevant source:

- [`ripple.js` visible texture coordinates and off-screen rectangles](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/war/ripple.js#L239-L295)
- [`ripple.js` damping attributes](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/war/ripple.js#L320-L334)
- [`RippleSim.java` resolution border setup](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/RippleSim.java#L1098-L1121)
- [`RippleSim.java` damping slider mapping](https://github.com/pfalstad/ripplegl/blob/28c479d268983cfca49d2b61322932ac8469348e/src/com/falstad/ripple/client/RippleSim.java#L1068-L1072)

In short: Falstad's off-screen boundary is not reflection-free in a mathematical sense. It is
visually reflection-free because the numerical boundary is outside the displayed area, energy is
damped before and at that boundary, and the renderer crops away the region most likely to contain
boundary artifacts.

## What This Suggests For Future Work

If we ever want Physics Nook's tank to move closer to Falstad's behavior, the most valuable ideas to
borrow conceptually are:

- add a velocity buffer rather than relying only on height history;
- add a numeric medium map instead of a boolean object mask;
- expose wall modes, especially fixed versus acoustic reflection;
- add richer source waveforms and line sources;
- keep the current hidden sink/camera approach, but tune it with measured reflection tests.

Because RippleGL is GPL-licensed, implementation work should use these as conceptual references
rather than copying source code directly unless the project intentionally adopts compatible licensing.
