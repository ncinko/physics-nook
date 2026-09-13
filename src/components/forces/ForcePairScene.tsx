import { ForceArrow } from './ForceArrow';
import NewtSprite, { NEWT_MOUTH_OFFSET } from './NewtSprite';
import { TongueMouthStub, TongueStrand } from './NewtTongue';
import {
  add,
  normalize,
  scale,
  SCENE_VIEW,
  thirdLawPair,
  type Interaction,
  type InteractionScene,
  type LabelSpot,
  type Vector2,
} from '../../lib/forces';

// The realistic drawing beside the interaction diagram. With no link selected
// it is just the scene; with one selected, its third-law pair is drawn in
// place, one arrow on each object. Object placement, arrow tails, and any
// hand-placed labels come from lib/forces/interactions.

const { width: W, height: H, ground: G, arrowLength: ARROW } = SCENE_VIEW;

const INK = 'var(--text-primary)';
const MUTED = 'var(--text-muted)';

const Earth = ({ label }: { label: Vector2 }) => (
  <g>
    <rect x={0} y={G} width={W} height={H - G} fill="var(--grid-line)" fillOpacity={0.4} />
    <line x1={0} y1={G} x2={W} y2={G} stroke={MUTED} strokeWidth={2.5} />
    <text x={label.x} y={label.y} textAnchor="middle" fontSize={13} fontWeight={600} fill={MUTED}>
      Earth
    </text>
  </g>
);

const Ball = ({ at }: { at: Vector2 }) => (
  <g>
    {[-9, 0, 9].map((dx) => (
      <line
        key={dx}
        x1={at.x + dx}
        y1={at.y - 30 - Math.abs(dx)}
        x2={at.x + dx}
        y2={at.y - 48 - Math.abs(dx)}
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.6}
      />
    ))}
    <circle cx={at.x} cy={at.y} r={18} fill="var(--surface-plot)" stroke={INK} strokeWidth={2.5} />
    <path
      d={`M ${at.x - 12} ${at.y - 13} Q ${at.x - 4} ${at.y} ${at.x - 12} ${at.y + 13} M ${at.x + 12} ${at.y - 13} Q ${at.x + 4} ${at.y} ${at.x + 12} ${at.y + 13}`}
      fill="none"
      stroke={MUTED}
      strokeWidth={1.5}
    />
  </g>
);

const Table = ({ top }: { top: Vector2 }) => (
  <g>
    <line x1={top.x - 75} y1={top.y + 8} x2={top.x - 75} y2={G} stroke={INK} strokeWidth={5} strokeLinecap="round" />
    <line x1={top.x + 75} y1={top.y + 8} x2={top.x + 75} y2={G} stroke={INK} strokeWidth={5} strokeLinecap="round" />
    <rect x={top.x - 90} y={top.y} width={180} height={10} rx={2} fill="var(--surface-plot)" stroke={INK} strokeWidth={2} />
  </g>
);

const Tree = ({ joint, branchTip }: { joint: Vector2; branchTip: number }) => (
  <g stroke={MUTED} strokeLinecap="round">
    <line x1={joint.x} y1={G} x2={joint.x} y2={joint.y - 22} strokeWidth={12} />
    <line x1={joint.x} y1={joint.y} x2={branchTip} y2={joint.y} strokeWidth={7} />
    <line x1={joint.x} y1={joint.y - 8} x2={joint.x + 26} y2={joint.y - 30} strokeWidth={5} />
  </g>
);

const Crate = ({ centre }: { centre: Vector2 }) => {
  const x = centre.x - 40;
  const y = centre.y - 40;
  return (
    <g>
      <rect x={x} y={y} width={80} height={80} rx={3} fill="var(--surface-plot)" stroke={INK} strokeWidth={2.5} />
      <rect x={x + 8} y={y + 8} width={64} height={64} fill="none" stroke={MUTED} strokeWidth={1.5} opacity={0.6} />
      <line x1={x + 8} y1={y + 72} x2={x + 72} y2={y + 8} stroke={MUTED} strokeWidth={1.5} opacity={0.6} />
    </g>
  );
};

/** A muted velocity hint, so the direction of sliding friction makes sense. */
const MotionHint = ({ from, to }: { from: Vector2; to: Vector2 }) => (
  <g fill={MUTED} stroke={MUTED} opacity={0.8}>
    <line x1={from.x} y1={from.y} x2={to.x - 10} y2={to.y} strokeWidth={2.5} strokeLinecap="round" />
    <polygon points={`${to.x},${to.y} ${to.x - 12},${to.y - 5} ${to.x - 12},${to.y + 5}`} stroke="none" />
    <text x={to.x + 8} y={to.y + 5} fontSize={14} fontWeight={600} fontStyle="italic" stroke="none">
      v
    </text>
  </g>
);

const Backdrop = ({ scene }: { scene: InteractionScene }) => {
  const at = (id: string) => scene.objects.find((object) => object.id === id)!.inScene;

  switch (scene.id) {
    case 'falling-ball':
      return <Ball at={at('ball')} />;
    case 'table':
      return (
        <>
          <Table top={at('table')} />
          <NewtSprite x={at('newt').x} y={at('newt').y} />
        </>
      );
    case 'hanging': {
      const newt = at('newt');
      const joint = at('tree');
      const mouth = add(newt, NEWT_MOUTH_OFFSET);
      return (
        <>
          <Tree joint={joint} branchTip={newt.x - 60} />
          {/* The branch is 7 wide, so the tongue sticks to its underside. */}
          <TongueStrand anchor={{ x: mouth.x, y: joint.y + 4 }} mouth={mouth} />
          <NewtSprite x={newt.x} y={newt.y}>
            <TongueMouthStub angle={-90} />
          </NewtSprite>
        </>
      );
    }
    case 'pushing-box': {
      const box = at('box');
      return (
        <>
          <MotionHint from={{ x: box.x - 60, y: 120 }} to={{ x: box.x + 4, y: 120 }} />
          <Crate centre={box} />
          <NewtSprite x={at('newt').x} y={at('newt').y} />
        </>
      );
    }
    default:
      return null;
  }
};

const PairLabel = ({ spot, color, text }: { spot: LabelSpot; color: string; text: string }) => (
  <text
    x={spot.x}
    y={spot.y}
    fill={color}
    textAnchor={spot.anchor}
    dominantBaseline="middle"
    fontSize="14"
    fontWeight="700"
    paintOrder="stroke"
    stroke="var(--surface-plot)"
    strokeWidth="4"
  >
    {text}
  </text>
);

interface ForcePairSceneProps {
  scene: InteractionScene;
  pair?: Interaction;
  color?: string;
}

export default function ForcePairScene({ scene, pair, color = INK }: ForcePairSceneProps) {
  const objectById = (id: string) => scene.objects.find((object) => object.id === id)!;
  const earth = scene.objects.find((object) => object.id === 'earth');

  const arrows = pair
    ? (() => {
        const { onA, onB } = thirdLawPair(pair);
        const a = objectById(pair.a);
        const b = objectById(pair.b);
        return [
          { end: 'b' as const, force: onB, text: `${a.label} on ${b.label}` },
          { end: 'a' as const, force: onA, text: `${b.label} on ${a.label}` },
        ].map((arrow) => ({
          ...arrow,
          origin: pair.applyAt[arrow.end],
          spot: pair.labelAt?.[arrow.end],
          vector: scale(normalize(arrow.force), ARROW),
        }));
      })()
    : [];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={pair ? `Drawing of ${scene.title.toLowerCase()}: ${pair.pair}` : `Drawing of ${scene.title.toLowerCase()}`}
      className="mx-auto block h-auto w-full max-w-[420px] select-none"
    >
      {earth && <Earth label={earth.inScene} />}
      <Backdrop scene={scene} />
      {arrows.map((arrow) => (
        <g key={`${pair!.id}-${arrow.end}`}>
          <ForceArrow
            origin={arrow.origin}
            vector={arrow.vector}
            maxLength={ARROW}
            color={color}
            label={arrow.spot ? '' : arrow.text}
            labelBounds={SCENE_VIEW}
          />
          {arrow.spot && <PairLabel spot={arrow.spot} color={color} text={arrow.text} />}
        </g>
      ))}
    </svg>
  );
}
