import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  clampMagnitude,
  directionDegrees,
  formatVector,
  magnitude,
  subtract,
  type Vector2,
} from '../../../lib/math/vectors';
import {
  WORLD,
  chooseUpgrade,
  createGame,
  landingPoint,
  startGame,
  step,
  throwGrenade,
  trajectoryPoints,
  type GameState,
} from '../../../lib/caerbannog/game';
import { UPGRADES, type UpgradeId } from '../../../lib/caerbannog/upgrades';
import { BunnySprite, KILLER_PALETTE } from '../BunnySprite';
import { GRENADE_SPRITE, KEEP_SPRITE, type PixelSprite } from './sprites';

// --- World <-> screen mapping ---------------------------------------------
const VIEW_W = 900;
const VIEW_H = 480;
const MARGIN = 18;
const PLOT_W = VIEW_W - MARGIN * 2;
const PLOT_H = VIEW_H - MARGIN * 2;
const W_MIN_X = 0;
const W_MAX_X = 100;
const W_MIN_Y = 0;
const W_MAX_Y = 45;

const SX = PLOT_W / (W_MAX_X - W_MIN_X); // screen px per world unit (x)
const sx = (wx: number) => MARGIN + (wx - W_MIN_X) * SX;
const sy = (wy: number) => MARGIN + ((W_MAX_Y - wy) / (W_MAX_Y - W_MIN_Y)) * PLOT_H;

const MAX_POWER = 80; // clamp on the drawn launch velocity
const STORAGE_KEY = 'caerbannog:bestWave';

const COLORS = {
  skyTop: '#1e293b',
  skyBottom: '#475569',
  ground: '#3f6212',
  groundDark: '#365314',
  cave: '#0f172a',
  aim: '#fbbf24',
  blast: '#f97316',
};

const pointerToWorld = (event: PointerEvent<SVGElement>): Vector2 => {
  const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as SVGSVGElement);
  const rect = svg.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VIEW_W;
  const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * VIEW_H;
  const wx = W_MIN_X + ((px - MARGIN) / PLOT_W) * (W_MAX_X - W_MIN_X);
  const wy = W_MAX_Y - ((py - MARGIN) / PLOT_H) * (W_MAX_Y - W_MIN_Y);
  return { x: wx, y: wy };
};

const readBest = (): number => {
  if (typeof window === 'undefined') {
    return 0;
  }
  return Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '0', 10) || 0;
};

export default function CaerbannogDefense({ onExit }: { onExit?: () => void }) {
  const seedRef = useRef(Math.floor(Math.random() * 1e9));
  const [state, setState] = useState<GameState>(() => createGame(seedRef.current));
  const stateRef = useRef(state);
  const [best, setBest] = useState(0);

  const [aim, setAim] = useState<Vector2 | null>(null);
  const aimRef = useRef<Vector2 | null>(null);

  // Single source of truth: keep the ref in sync so the rAF loop reads fresh state.
  const setGame = useCallback((updater: (prev: GameState) => GameState) => {
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    setBest(readBest());
  }, []);

  // Persist the best wave whenever it climbs.
  useEffect(() => {
    if (state.bestWave > 0) {
      setBest((prev) => {
        const next = Math.max(prev, state.bestWave);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, String(next));
        }
        return next;
      });
    }
  }, [state.bestWave]);

  // Real-time loop: only runs while playing, so the intro/intermission/gameover
  // screens stay idle (no wasted frames). Restarts when play resumes.
  useEffect(() => {
    if (state.phase !== 'playing') {
      return undefined;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setGame((prev) => step(prev, dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.phase, setGame]);

  const aimVel = aim ? clampMagnitude(subtract(aim, WORLD.launch), MAX_POWER) : null;

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (state.phase !== 'playing') {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; ignore if the pointer isn't capturable.
    }
    const world = pointerToWorld(event);
    aimRef.current = world;
    setAim(world);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!aimRef.current) {
      return;
    }
    const world = pointerToWorld(event);
    aimRef.current = world;
    setAim(world);
  };

  const onPointerUp = () => {
    const target = aimRef.current;
    aimRef.current = null;
    setAim(null);
    if (target) {
      const velocity = clampMagnitude(subtract(target, WORLD.launch), MAX_POWER);
      if (magnitude(velocity) > 1) {
        setGame((prev) => throwGrenade(prev, velocity));
      }
    }
  };

  const begin = () => setGame((prev) => startGame(prev));
  const pick = (id: UpgradeId) => setGame((prev) => chooseUpgrade(prev, id));
  const restart = () => {
    seedRef.current = Math.floor(Math.random() * 1e9);
    setGame(() => startGame(createGame(seedRef.current)));
  };

  const stats = state.stats;

  return (
    <section className="not-prose w-full text-[var(--text-primary)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-semibold">The Rabbit of Caerbannog</h3>
          <p className="m-0 text-sm text-[var(--text-muted)]">
            Drag from the keep to aim the Holy Hand Grenade. Release to lob it.
          </p>
        </div>
        <Hud state={state} best={best} />
      </div>

      <div className="relative overflow-hidden rounded-xl border border-[var(--grid-line)] shadow-inner">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label="Killer rabbit siege"
          className="block h-auto w-full select-none"
          style={{ touchAction: 'none', cursor: state.phase === 'playing' ? 'crosshair' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <Scenery />

          {/* Keep on the left, sitting on the ground. */}
          <g transform={`translate(${sx(WORLD.keepX - 4)}, ${sy(0) - (KEEP_SPRITE.rows / 2) * 3})`}>
            <Pixels sprite={KEEP_SPRITE} cell={3} />
          </g>
          <Catapult />

          {/* Explosions (behind rabbits/grenades so sprites stay readable). */}
          {state.explosions.map((boom) => {
            const t = boom.age / boom.ttl;
            const r = boom.radius * SX * (0.4 + 0.6 * t);
            return (
              <g key={boom.id} opacity={1 - t}>
                <circle cx={sx(boom.pos.x)} cy={sy(boom.pos.y)} r={r} fill={COLORS.blast} opacity={0.5} />
                <circle cx={sx(boom.pos.x)} cy={sy(boom.pos.y)} r={r * 0.6} fill="#fde68a" />
              </g>
            );
          })}

          {state.rabbits.map((rabbit) => (
            <g
              key={rabbit.id}
              transform={`translate(${sx(rabbit.x)}, ${sy(rabbit.y)}) scale(-1, 1)`}
            >
              <BunnySprite frame="hop" cell={2} palette={KILLER_PALETTE} />
            </g>
          ))}

          {state.grenades.map((grenade) => {
            const angle =
              grenade.state === 'flying'
                ? (Math.atan2(-grenade.vel.y, grenade.vel.x) * 180) / Math.PI
                : 0;
            const count = Math.ceil(grenade.fuse / (stats.fuseTime / 3 || 1));
            return (
              <g key={grenade.id} transform={`translate(${sx(grenade.pos.x)}, ${sy(grenade.pos.y)})`}>
                <g transform={`rotate(${angle})`}>
                  <Pixels sprite={GRENADE_SPRITE} cell={2} />
                </g>
                {grenade.state === 'fuse' && (
                  <text
                    x={0}
                    y={-22}
                    textAnchor="middle"
                    fontSize="18"
                    fontWeight="900"
                    fill="#fde68a"
                    stroke="#78350f"
                    strokeWidth={0.6}
                  >
                    {Math.min(3, Math.max(1, count))}
                  </text>
                )}
              </g>
            );
          })}

          {/* Aim preview while dragging. */}
          {aimVel && state.phase === 'playing' && (
            <AimPreview velocity={aimVel} canFire={stats.ammo > 0} />
          )}
        </svg>

        {state.phase === 'intro' && (
          <Overlay>
            <h2 className="m-0 text-2xl font-black tracking-tight text-white">
              The Tale of the Killer Rabbit
            </h2>
            <p className="mt-3 mb-0 max-w-md text-sm leading-6 text-slate-200">
              That&apos;s no ordinary rabbit. Waves of the beasts pour from the Cave of
              Caerbannog toward Arthur&apos;s keep. Lob the Holy Hand Grenade of Antioch by
              dragging a launch <em>vector</em> from the catapult — angle and power both
              matter. Survive each wave to claim a blessing.
            </p>
            <button type="button" onClick={begin} className={primaryBtn}>
              Begin the Siege
            </button>
          </Overlay>
        )}

        {state.phase === 'intermission' && (
          <Overlay>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Wave {state.wave} repelled
            </p>
            <h2 className="mt-1 mb-0 text-2xl font-black text-white">Choose a Blessing</h2>
            <div className="mt-4 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
              {state.offer.map((id) => {
                const upgrade = UPGRADES.find((u) => u.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pick(id)}
                    className="flex flex-col gap-1 rounded-xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 text-left text-[var(--text-primary)] transition hover:border-[var(--accent-blue)] hover:shadow-md"
                  >
                    <span className="text-sm font-bold text-[var(--text-primary)]">
                      {upgrade.name}
                    </span>
                    <span className="text-xs leading-5 text-[var(--text-muted)]">
                      {upgrade.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </Overlay>
        )}

        {state.phase === 'gameover' && (
          <Overlay>
            <h2 className="m-0 text-2xl font-black text-[#ef4444]">The keep has fallen</h2>
            <p className="mt-2 mb-0 text-sm text-slate-200">
              You held until <strong className="text-white">wave {state.wave}</strong>
              {' · '}rabbits felled: {state.score}
              {best > 0 && <> · best: wave {best}</>}
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={restart} className={primaryBtn}>
                Try Again
              </button>
              {onExit && (
                <button type="button" onClick={onExit} className={ghostBtn}>
                  Run away!
                </button>
              )}
            </div>
          </Overlay>
        )}
      </div>
    </section>
  );
}

// --- Subcomponents ---------------------------------------------------------

const primaryBtn =
  'mt-4 rounded-lg border border-[var(--accent-blue)] bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110';
const ghostBtn =
  'mt-4 rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-blue)]';

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 p-4 text-center text-white backdrop-blur-sm">
      {children}
    </div>
  );
}

function Pixels({ sprite, cell }: { sprite: PixelSprite; cell: number }) {
  return (
    <g shapeRendering="crispEdges">
      {sprite.pixels.map((px, i) => (
        <rect
          key={i}
          x={(px.x - sprite.cols / 2) * cell}
          y={(px.y - sprite.rows / 2) * cell}
          width={cell}
          height={cell}
          fill={px.fill}
        />
      ))}
    </g>
  );
}

function Scenery() {
  return (
    <g>
      <defs>
        <linearGradient id="caer-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.skyTop} />
          <stop offset="100%" stopColor={COLORS.skyBottom} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#caer-sky)" />
      {/* Ground */}
      <rect x={0} y={sy(0)} width={VIEW_W} height={VIEW_H - sy(0)} fill={COLORS.ground} />
      <rect x={0} y={sy(0)} width={VIEW_W} height={4} fill={COLORS.groundDark} />
      {/* Cave of Caerbannog on the right, where the rabbits emerge. */}
      <path
        d={`M ${sx(94)} ${sy(0)} Q ${sx(94)} ${sy(20)} ${sx(99)} ${sy(20)} Q ${sx(101)} ${sy(20)} ${sx(101)} ${sy(0)} Z`}
        fill={COLORS.cave}
      />
    </g>
  );
}

function Catapult() {
  const x = sx(WORLD.launch.x);
  const y = sy(WORLD.launch.y);
  const base = sy(0);
  return (
    <g>
      <line x1={x} y1={y} x2={x - 10} y2={base} stroke="#78350f" strokeWidth={4} strokeLinecap="round" />
      <line x1={x} y1={y} x2={x + 10} y2={base} stroke="#78350f" strokeWidth={4} strokeLinecap="round" />
      <circle cx={x} cy={y} r={6} fill="#92400e" stroke="#78350f" strokeWidth={2} />
    </g>
  );
}

function AimPreview({ velocity, canFire }: { velocity: Vector2; canFire: boolean }) {
  const points = trajectoryPoints(WORLD.launch, velocity)
    .map((p) => `${sx(p.x)},${sy(p.y)}`)
    .join(' ');
  const land = landingPoint(WORLD.launch, velocity);
  const stroke = canFire ? COLORS.aim : '#94a3b8';
  return (
    <g opacity={canFire ? 1 : 0.5}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={2.5} strokeDasharray="6 6" />
      <line
        x1={sx(WORLD.launch.x)}
        y1={sy(WORLD.launch.y)}
        x2={sx(WORLD.launch.x + velocity.x * 0.25)}
        y2={sy(WORLD.launch.y + velocity.y * 0.25)}
        stroke={stroke}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <g>
        <line x1={sx(land.x) - 7} y1={sy(0) - 7} x2={sx(land.x) + 7} y2={sy(0) + 7} stroke={stroke} strokeWidth={2.5} />
        <line x1={sx(land.x) - 7} y1={sy(0) + 7} x2={sx(land.x) + 7} y2={sy(0) - 7} stroke={stroke} strokeWidth={2.5} />
      </g>
      <text x={sx(WORLD.launch.x) + 14} y={sy(WORLD.launch.y) - 10} fontSize="13" fontWeight="700" fill={stroke}>
        {formatVector(velocity, 0)} · |v| {magnitude(velocity).toFixed(0)} · {directionDegrees(velocity).toFixed(0)}°
      </text>
    </g>
  );
}

function Hud({ state, best }: { state: GameState; best: number }) {
  const { stats } = state;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
      <span className="font-semibold">Wave {Math.max(1, state.wave)}</span>
      <span aria-label="keep health" title="Keep health">
        {Array.from({ length: stats.maxCastleHp }, (_, i) => (
          <span key={i} style={{ color: i < stats.castleHp ? '#ef4444' : '#475569' }}>
            ♥
          </span>
        ))}
      </span>
      <span title="Grenades ready">
        <span className="text-[var(--text-muted)]">grenades </span>
        <span className="font-semibold">
          {stats.ammo}/{stats.maxAmmo}
        </span>
      </span>
      <span className="text-[var(--text-muted)]">
        felled <span className="font-semibold text-[var(--text-primary)]">{state.score}</span>
      </span>
      {best > 0 && <span className="text-[var(--text-muted)]">best W{best}</span>}
    </div>
  );
}
