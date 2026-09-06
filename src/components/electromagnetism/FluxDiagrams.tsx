import { useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ControlBar, Select, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { BOX_FACES, add3, cross3, flatFlux, formatFlux, scale3, uniformBoxFlux, type Vector3 } from '../../lib/electromagnetism/gauss';

// A consistent orthographic view of three-dimensional vectors and surfaces.
const project = ([x, y, z]: Vector3) => [360 + 72 * (0.84 * x + 0.5 * z), 175 + 72 * (-0.28 * x - 0.88 * y + 0.48 * z)];
type Projection = typeof project;
const points = (vertices: Vector3[], projection: Projection) => vertices.map(v => projection(v).join(',')).join(' ');
const ink = 'var(--text-primary)', fieldColor = 'var(--accent-blue)', normalColor = 'var(--accent-green)';

type View = readonly [yaw: number, pitch: number];

// Default viewing angles, one per diagram because each has a different normal.
// Unrotated, both normals lie almost exactly in the picture plane: the patch
// collapses to a sliver and neither arrow shows which way it actually points.
// These turn each scene so its normal reads up and to the right and tilted
// ~20deg out of the page toward the reader, which is enough to open the patch
// up and to give the cube a three-quarter view.
const PATCH_VIEW: View = [-0.67, -0.17];
const BOX_VIEW: View = [-0.69, -0.67];

// Rotate the geometry before applying the original projection: the initial drawing stays exact.
function useDiagramRotation(initial: View = [0, 0]) {
  const [[yaw, pitch], setRotation] = useState<View>(initial);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const rotate = ([x, y, z]: Vector3): Vector3 => {
    const xx = x * Math.cos(yaw) + z * Math.sin(yaw);
    const zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [xx, y * Math.cos(pitch) - zz * Math.sin(pitch), y * Math.sin(pitch) + zz * Math.cos(pitch)];
  };
  const stop = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    project: (v: Vector3) => project(rotate(v)),
    depth: (v: Vector3) => { const [x, y, z] = rotate(v); return x * 0.45 + y * 0.5 + z * 0.75; },
    interaction: {
      tabIndex: 0,
      style: { cursor: 'grab', touchAction: 'none', userSelect: 'none' as const, outline: 'none' },
      'aria-description': 'Drag to rotate the view. Arrow keys also rotate; Home restores the original view.',
      onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setRotation(([a, b]) => [a + dx * 0.008, b + dy * 0.008]);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: () => { drag.current = null; },
      onDoubleClick: () => setRotation(initial),
      onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') setRotation(initial);
        else setRotation(([a, b]) => [a + (event.key === 'ArrowLeft' ? -0.1 : event.key === 'ArrowRight' ? 0.1 : 0),
          b + (event.key === 'ArrowUp' ? -0.1 : event.key === 'ArrowDown' ? 0.1 : 0)]);
      },
    },
  };
}

function Arrow({ from, to, color, id, project }: { from: Vector3; to: Vector3; color: string; id: string; project: Projection }) {
  const [x1, y1] = project(from), [x2, y2] = project(to);
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} markerEnd={`url(#${id})`} />;
}

function Markers({ id }: { id: string }) {
  return <defs><marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
  </marker></defs>;
}

export function ElectricFluxPatch() {
  const { project, interaction } = useDiagramRotation(PATCH_VIEW);
  const [angle, setAngle] = useState(30), [area, setArea] = useState(2);
  const id = useId();
  const a = angle * Math.PI / 180;
  const normal: Vector3 = [Math.cos(a), Math.sin(a), 0];
  const tangent: Vector3 = [-Math.sin(a), Math.cos(a), 0];
  const halfSide = Math.sqrt(area) / 2;
  const vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
    add3(scale3(tangent, u * halfSide), [0, 0, v * halfSide]));
  const tip = project(scale3(normal, 1.9));
  const arc = Array.from({ length: 41 }, (_, i) => {
    const t = a * i / 40; return project([0.65 * Math.cos(t), 0.65 * Math.sin(t), 0]).join(',');
  }).join(' ');
  return <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
    <ControlBar>
      <Slider label="Angle θ" unit="°" min={0} max={180} step={5} value={angle} onChange={setAngle} />
      <Slider label="Area A" unit="m²" min={0.5} max={4} step={0.5} value={area} onChange={setArea} />
    </ControlBar>
    <svg {...interaction} viewBox="100 0 540 340" className="mx-auto block w-full max-w-xl" role="img"
      aria-label={`A surface of area ${area} square metres in a 100 newton-per-coulomb field. The normal makes an angle of ${angle} degrees with the field. Flux ${formatFlux(flatFlux(100, area, angle))} newton square metres per coulomb.`}>
      <Markers id={id} />
      {[-0.9, 0, 0.9].flatMap(y => [-0.8, 0.8].map(z => <Arrow project={project} key={`${y}-${z}`} from={[-2.8, y, z]} to={[2.8, y, z]} color={fieldColor} id={id} />))}
      <polygon points={points(vertices, project)} fill="var(--accent-purple)" fillOpacity={0.2} stroke={ink} strokeWidth={2} />
      <polyline points={arc} fill="none" stroke={normalColor} strokeWidth={2} />
      <Arrow project={project} from={[0, 0, 0]} to={scale3(normal, 1.7)} color={normalColor} id={id} />
      <text x={tip[0]} y={tip[1] - 10} fill={normalColor} textAnchor="middle" fontSize={20}>normal n̂</text>
      <text x={585} y={120} fill={fieldColor} fontSize={20}>E →</text>
    </svg>
    <p className="mb-3 text-center text-sm">θ = {angle}° · {angle === 90 ? 'Field runs along the surface' : angle > 90 ? 'Field opposes the chosen normal' : 'Field points through the surface'}</p>
    <Readout variant="inline" className="justify-center">
      <Readout.Value label="E" value="100" unit="N/C" />
      <Readout.Value label="Φ = EA cos θ" value={formatFlux(flatFlux(100, area, angle))} unit="N·m²/C" />
    </Readout>
    <figcaption className="mt-3 text-center text-sm text-[var(--text-muted)]">Measure θ from the normal arrow, which is perpendicular to the surface.</figcaption>
  </figure>;
}

export function ClosedSurfaceFlux() {
  const { project, depth, interaction } = useDiagramRotation(BOX_VIEW);
  const [angle, setAngle] = useState(0), [selected, setSelected] = useState(1);
  const id = useId(), a = angle * Math.PI / 180;
  const direction: Vector3 = [Math.cos(a), Math.sin(a), 0];
  const faces = uniformBoxFlux(scale3(direction, 100));
  const patches = faces.map((face, index) => {
    const n = face.normal;
    const u = Math.abs(n[1]) === 1 ? [1, 0, 0] as const : [0, 1, 0] as const;
    const v = cross3(n, u);
    const vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => add3(n, add3(scale3(u, s), scale3(v, t))));
    return { ...face, index, vertices, depth: depth(n) };
  }).sort((a, b) => a.depth - b.depth);
  const total = faces.reduce((sum, face) => sum + face.flux, 0);
  return <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
    <ControlBar>
      <Slider label="Field direction" unit="°" min={0} max={90} step={5} value={angle} onChange={setAngle} />
      <Select label="Inspect face" value={String(selected)} onChange={v => setSelected(Number(v))}
        options={BOX_FACES.map((f, i) => ({ value: String(i), label: f.name }))} />
    </ControlBar>
    <svg {...interaction} viewBox="90 -40 540 440" className="mx-auto block w-full max-w-xl" role="img"
      aria-label={`A closed cube in a uniform electric field. ${faces[selected].name} flux is ${formatFlux(faces[selected].flux)}. Net flux through all six faces is zero.`}>
      <Markers id={id} />
      {[-0.5, 0.5].flatMap(y => [-0.5, 0.5].map(z => {
        const offset: Vector3 = [-y * Math.sin(a), y * Math.cos(a), z];
        return <Arrow project={project} key={`${y}-${z}`} from={add3(offset, scale3(direction, -2.8))} to={add3(offset, scale3(direction, 2.8))} color={fieldColor} id={id} />;
      }))}
      {patches.map(face => <polygon key={face.name} points={points(face.vertices, project)}
        fill={face.flux > 1e-8 ? 'var(--accent-red)' : face.flux < -1e-8 ? 'var(--accent-blue)' : 'var(--grid-line)'}
        fillOpacity={face.index === selected ? 0.48 : 0.14} stroke={face.index === selected ? ink : 'var(--text-muted)'}
        strokeWidth={face.index === selected ? 2.5 : 1} />)}
      <Arrow project={project} from={faces[selected].normal} to={scale3(faces[selected].normal, 1.8)} color={normalColor} id={id} />
      <text x={project(scale3(faces[selected].normal, 2.1))[0]} y={project(scale3(faces[selected].normal, 2.1))[1] - 8}
        fill={normalColor} textAnchor="middle" fontSize={20}>normal</text>
    </svg>
    <p className="mb-3 text-center text-sm">Each face has area 4 m² · E = 100 N/C</p>
    <Readout variant="inline" className="justify-center">
      <Readout.Value label={faces[selected].name} value={formatFlux(faces[selected].flux)} unit="N·m²/C" />
      <Readout.Value label="Net flux" value={formatFlux(total)} unit="N·m²/C" />
    </Readout>
    <figcaption className="mt-3 text-center text-sm text-[var(--text-muted)]">
      <span className="text-[var(--accent-red)]">Red: outward (+)</span>{' '}
      <span className="text-[var(--accent-blue)]">Blue: inward (-).</span> 
    </figcaption>
  </figure>;
}
