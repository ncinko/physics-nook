import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  add,
  clampMagnitude,
  magnitude,
  scale,
  subtract,
  type Vector2,
} from '../../../lib/math/vectors';
import {
  WORLD,
  buyDefense,
  canRepairKeep,
  chooseBlessing,
  createGame,
  nextWave,
  rabbitTraits,
  repairCost,
  repairKeep,
  startGame,
  step,
  throwGrenade,
  type GameState,
  type RabbitKind,
} from '../../../lib/caerbannog/game';
import {
  BLESSINGS,
  SHOP,
  canBuy,
  type BlessingId,
  type ShopId,
} from '../../../lib/caerbannog/upgrades';
import { BunnySprite, KILLER_PALETTE } from '../BunnySprite';
import { GRENADE_SPRITE, KEEP_SPRITE, TIM_SPRITE, type PixelSprite } from './sprites';

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
const SY = PLOT_H / (W_MAX_Y - W_MIN_Y); // screen px per world unit (y)
const sx = (wx: number) => MARGIN + (wx - W_MIN_X) * SX;
const sy = (wy: number) => MARGIN + (W_MAX_Y - wy) * SY;

const MAX_POWER = 80; // clamp on the launch velocity (same reach as before)
// The slingshot maps full launch power to a short pull-back, so the cursor
// never has to travel far enough to leave the viewport while aiming.
const MAX_DRAW = 8; // world units of draw-back that reach MAX_POWER
const DRAW_SCALE = MAX_POWER / MAX_DRAW;
const STORAGE_KEY = 'caerbannog:bestWave';

// Slingshot frame geometry (screen px), shared by the prongs and the bands.
const LAUNCH_PX = sx(WORLD.launch.x);
const LAUNCH_PY = sy(WORLD.launch.y);
const FORK_DX = 9; // half the gap between the two prongs
const FORK_DY = 16; // how far the prongs rise above the pouch
const FORK_LEFT = { x: LAUNCH_PX - FORK_DX, y: LAUNCH_PY - FORK_DY };
const FORK_RIGHT = { x: LAUNCH_PX + FORK_DX, y: LAUNCH_PY - FORK_DY };

const COLORS = {
  skyTop: '#1e293b',
  skyBottom: '#475569',
  ground: '#3f6212',
  groundDark: '#365314',
  cave: '#0f172a',
  aim: '#fbbf24',
  blast: '#f97316',
};

const RABBIT_PALETTES: Record<RabbitKind, Record<string, string>> = {
  common: KILLER_PALETTE,
  runner: { ...KILLER_PALETTE, '#': '#713f12', o: '#fde68a', p: '#fb923c' },
  brute: { ...KILLER_PALETTE, '#': '#1e293b', o: '#94a3b8', p: '#64748b' },
  boss: { ...KILLER_PALETTE, '#': '#7f1d1d', o: '#fff7ed', p: '#fca5a5', n: '#dc2626' },
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

// Pull back to fire: the grenade flies opposite the drag, harder the further it
// is drawn. Clamping in world space matches the (non-uniform) screen mapping, so
// the visible pouch position lines up with the launch power it produces.
const pullToVelocity = (pointer: Vector2): Vector2 =>
  clampMagnitude(scale(subtract(WORLD.launch, pointer), DRAW_SCALE), MAX_POWER);

// Where the drawn-back grenade sits, clamped to the maximum draw length.
const pouchPoint = (pointer: Vector2): Vector2 =>
  add(WORLD.launch, clampMagnitude(subtract(pointer, WORLD.launch), MAX_DRAW));

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
      const velocity = pullToVelocity(target);
      if (magnitude(velocity) > 1) {
        setGame((prev) => throwGrenade(prev, velocity));
      }
    }
  };

  const begin = () => setGame((prev) => startGame(prev));
  const pickBlessing = (id: BlessingId) => setGame((prev) => chooseBlessing(prev, id));
  const purchase = (id: ShopId) => setGame((prev) => buyDefense(prev, id));
  const repair = () => setGame((prev) => repairKeep(prev));
  const continueSiege = () => setGame((prev) => nextWave(prev));
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
            Pull back from the slingshot to aim the Holy Hand Grenade. Release to fling it.
          </p>
        </div>
        <Hud state={state} best={best} />
      </div>

      <div
        className={`relative overflow-hidden rounded-xl border border-[var(--grid-line)] shadow-inner ${
          state.phase === 'playing' ? '' : 'min-h-[70vh] sm:min-h-0'
        }`}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label="Killer rabbit siege"
          className="block h-auto w-full select-none"
          style={{
            touchAction: 'none',
            cursor: state.phase === 'playing' ? (aim ? 'grabbing' : 'grab') : 'default',
          }}
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
          {stats.maxCastleHp > 5 && <KeepReinforcements level={stats.maxCastleHp - 5} />}
          {stats.caltropsLevel > 0 && <Caltrops level={stats.caltropsLevel} />}
          {stats.timLevel > 0 && <Tim level={stats.timLevel} />}
          <Slingshot />

          {/* Explosions (behind rabbits/grenades so sprites stay readable).
              Drawn at the TRUE kill radius from frame one — a world circle, which
              is an ellipse on screen because x/y use different scales — so the
              visible blast matches exactly what took damage at detonation. The
              outer ring marks the kill boundary; the whole thing just fades out. */}
          {state.explosions.map((boom) => {
            const t = boom.age / boom.ttl;
            const cx = sx(boom.pos.x);
            const cy = sy(boom.pos.y);
            const rx = boom.radius * SX;
            const ry = boom.radius * SY;
            const ring = 1 + 0.18 * t; // a shockwave that expands slightly as it fades
            return (
              <g key={boom.id}>
                <ellipse cx={cx} cy={cy} rx={rx * ring} ry={ry * ring} fill="none" stroke={COLORS.blast} strokeWidth={2.5} opacity={(1 - t) * 0.85} />
                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={COLORS.blast} opacity={(1 - t) * 0.5} />
                <ellipse cx={cx} cy={cy} rx={rx * 0.5} ry={ry * 0.5} fill="#fde68a" opacity={1 - t} />
              </g>
            );
          })}

          {state.rabbits.map((rabbit) => {
            const px = sx(rabbit.x);
            const py = sy(rabbit.y);
            const cell = 2 * rabbitTraits(rabbit.kind, state.wave).scale;
            return (
              <g key={rabbit.id}>
                {/* scaled -1 to face the keep; sprite is authored facing right */}
                <g transform={`translate(${px}, ${py}) scale(-1, 1)`}>
                  <BunnySprite frame="hop" cell={cell} palette={RABBIT_PALETTES[rabbit.kind]} />
                </g>
                {rabbit.maxHp > 1 && (
                  <RabbitHealth
                    x={px}
                    topY={py - 16 * cell - 6}
                    hp={rabbit.hp}
                    maxHp={rabbit.maxHp}
                    kind={rabbit.kind}
                  />
                )}
              </g>
            );
          })}

          {state.rewardPopups.map((popup) => {
            const t = popup.age / popup.ttl;
            return (
              <text
                key={popup.id}
                x={sx(popup.pos.x)}
                y={sy(popup.pos.y) - t * 24}
                textAnchor="middle"
                fontSize={popup.tone === 'boss' ? 15 : 12}
                fontWeight="900"
                fill={popup.tone === 'boss' ? '#fca5a5' : '#fde68a'}
                stroke="#0f172a"
                strokeWidth={3}
                paintOrder="stroke"
                opacity={1 - t}
              >
                {popup.text}
              </text>
            );
          })}

          {state.zaps.map((zap) => (
            <g key={zap.id} opacity={1 - zap.age / zap.ttl}>
              <line
                x1={sx(zap.from.x)}
                y1={sy(zap.from.y)}
                x2={sx(zap.to.x)}
                y2={sy(zap.to.y)}
                stroke="#fb923c"
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.45}
              />
              <line
                x1={sx(zap.from.x)}
                y1={sy(zap.from.y)}
                x2={sx(zap.to.x)}
                y2={sy(zap.to.y)}
                stroke="#fde68a"
                strokeWidth={2}
                strokeLinecap="round"
              />
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

          {/* Loaded grenade resting in the sling, drawn back as the player pulls. */}
          {state.phase === 'playing' && <SlingPull aim={aim} canFire={stats.ammo > 0} />}
        </svg>

        {state.phase === 'playing' && state.announcementTimer > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
            <div className="rounded-xl border border-red-400/70 bg-red-950/90 px-5 py-2 text-center text-white shadow-xl">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.28em] text-red-200">
                Milestone wave {state.wave}
              </p>
              <p className="m-0 text-base font-black">The White Rabbit approaches</p>
            </div>
          </div>
        )}

        {state.phase === 'intro' && (
          <Overlay>
            <h2 className="m-0 text-2xl font-black tracking-tight text-white">
              The Tale of the Killer Rabbit
            </h2>
            <p className="mt-3 mb-0 max-w-md text-sm leading-6 text-slate-200">
              That&apos;s no ordinary rabbit. Waves of the beasts pour from the Cave of
              Caerbannog toward Arthur&apos;s keep. Draw back the holy slingshot and release
              to fling the Holy Hand Grenade of Antioch — the launch is a <em>vector</em>,
              so angle and draw both matter. Close blasts hit hardest. Spend gold between
              waves on the keep&apos;s defenses; sacred blessings improve only your grenades.
            </p>
            <button type="button" onClick={begin} className={primaryBtn}>
              Begin the Siege
            </button>
          </Overlay>
        )}

        {state.phase === 'intermission' && (
          <Overlay>
            <div className="mx-auto flex w-full max-w-3xl flex-col items-center py-3">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
                Wave {state.wave} repelled · {state.gold} gold
              </p>
              <p className="mt-1 mb-0 text-xs text-slate-300">
                This wave: <strong className="text-amber-300">+{state.waveGoldEarned} gold</strong>
                {' · '}{state.precisionKillsThisWave} precision {state.precisionKillsThisWave === 1 ? 'kill' : 'kills'}
              </p>
              {state.blessingPending && (
                <>
                  <h2 className="mt-1 mb-0 text-xl font-black text-white">Choose a grenade blessing</h2>
                  <p className="mt-1 mb-0 text-xs text-slate-300">Blessings arrive after waves 1, 4, 7, …</p>
                  <div className="mt-3 grid w-full gap-2 sm:grid-cols-3">
                    {state.offer.map((id) => {
                      const blessing = BLESSINGS.find((item) => item.id === id)!;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => pickBlessing(id)}
                          className="flex flex-col gap-1 rounded-xl border border-amber-400/50 bg-amber-950/80 p-3 text-left transition hover:border-amber-300 hover:bg-amber-900/80"
                        >
                          <span className="text-sm font-bold text-amber-100">{blessing.name}</span>
                          <span className="text-xs leading-5 text-amber-50/75">{blessing.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="mt-3 flex w-full items-end justify-between gap-3 text-left">
                <div>
                  <h2 className="m-0 text-lg font-black text-white">Fortify the keep</h2>
                  <p className="m-0 text-xs text-slate-300">Static defenses remain for the whole run.</p>
                </div>
                <span className="shrink-0 font-mono text-sm font-bold text-amber-300">{state.gold} gold</span>
              </div>
              <div className="mt-2 grid w-full gap-2 sm:grid-cols-3">
                {SHOP.map((item) => {
                  const level = item.level(stats);
                  const maxed = level >= item.maxLevel;
                  const cost = item.cost(level);
                  const affordable = canBuy(stats, state.gold, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => purchase(item.id)}
                      disabled={!affordable}
                      className="flex min-h-28 flex-col rounded-xl border border-slate-500/70 bg-slate-950/80 p-3 text-left transition enabled:hover:border-sky-300 enabled:hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-bold text-white">
                        {item.name}
                        <span className="font-mono text-[11px] text-slate-300">Lv {level}/{item.maxLevel}</span>
                      </span>
                      <span className="mt-1 text-[11px] leading-4 text-slate-300">{item.detail(level)}</span>
                      <span className="mt-auto pt-2 font-mono text-xs font-bold text-amber-300">
                        {maxed ? 'MAXED' : `${cost} gold`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={repair}
                disabled={!canRepairKeep(state)}
                className="mt-2 flex w-full items-center justify-between rounded-lg border border-emerald-500/60 bg-emerald-950/70 px-3 py-2 text-left text-xs text-emerald-100 transition enabled:hover:border-emerald-300 enabled:hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  <strong>Patch one breach</strong> · restore one keep heart
                </span>
                <span className="font-mono font-bold text-amber-300">
                  {stats.castleHp >= stats.maxCastleHp ? 'KEEP FULL' : `${repairCost(state.wave)} gold`}
                </span>
              </button>
              <button
                type="button"
                onClick={continueSiege}
                disabled={state.blessingPending}
                className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-45`}
              >
                {state.blessingPending ? 'Choose a blessing first' : `Begin wave ${state.wave + 1}`}
              </button>
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
    <div className="absolute inset-0 flex flex-col items-center overflow-y-auto bg-black/65 p-4 text-center text-white backdrop-blur-sm">
      <div className="my-auto flex w-full flex-col items-center">{children}</div>
    </div>
  );
}

// A fixed-width, continuous bar remains readable when late-wave HP reaches the
// double digits. Fractional damage is represented by the exact fill width.
function RabbitHealth({
  x,
  topY,
  hp,
  maxHp,
  kind,
}: {
  x: number;
  topY: number;
  hp: number;
  maxHp: number;
  kind: RabbitKind;
}) {
  const width = kind === 'boss' ? 68 : kind === 'brute' ? 48 : 38;
  const height = kind === 'boss' ? 7 : 4;
  const startX = x - width / 2;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  const healthy = kind === 'boss' ? '#f87171' : kind === 'brute' ? '#60a5fa' : '#4ade80';
  const fill = ratio > 0.6 ? healthy : ratio > 0.3 ? '#facc15' : '#fb7185';
  const stroke = kind === 'boss' ? '#fef2f2' : '#0f172a';
  return (
    <g shapeRendering="crispEdges">
      <rect x={startX} y={topY} width={width} height={height} rx={1} fill="rgba(15,23,42,0.75)" />
      <rect x={startX} y={topY} width={width * ratio} height={height} rx={1} fill={fill} />
      <rect x={startX} y={topY} width={width} height={height} rx={1} fill="none" stroke={stroke} strokeWidth={kind === 'boss' ? 1.5 : 0.75} />
    </g>
  );
}

function KeepReinforcements({ level }: { level: number }) {
  return (
    <g aria-label={`Keep reinforcement level ${level}`}>
      <rect
        x={sx(0.8)}
        y={sy(6.8)}
        width={sx(7.4) - sx(0.8)}
        height={sy(0) - sy(6.8)}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={Math.min(5, 1.5 + level * 0.55)}
        opacity={0.45 + Math.min(level, 4) * 0.1}
      />
    </g>
  );
}

function Caltrops({ level }: { level: number }) {
  const count = 8 + level * 3;
  const edge = WORLD.keepX + WORLD.caltropsZone;
  return (
    <g aria-label={`Caltrops level ${level}`} stroke="#d1d5db" strokeWidth={1 + level * 0.15} opacity={0.8}>
      {Array.from({ length: count }, (_, i) => {
        const x = WORLD.keepX + 1.2 + ((i * 7.1) % (WORLD.caltropsZone - 2));
        const px = sx(Math.min(x, edge));
        const py = sy(0) - 1 - (i % 2) * 2;
        return <path key={i} d={`M ${px - 4} ${py} L ${px} ${py - 7} L ${px + 4} ${py}`} fill="none" />;
      })}
    </g>
  );
}

function Tim({ level }: { level: number }) {
  const x = sx(WORLD.tim.x);
  const y = sy(WORLD.tim.y);
  return (
    <g aria-label={`Tim the Enchanter level ${level}`} transform={`translate(${x}, ${y})`}>
      <Pixels sprite={TIM_SPRITE} cell={2} />
    </g>
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

// The wooden slingshot frame: a trunk rising from the ground that splits into
// two prongs. The elastic bands and the grenade are drawn separately (SlingPull)
// so they can render on top of the rabbits.
function Slingshot() {
  const base = sy(0);
  const forkY = LAUNCH_PY - 2; // where the trunk splits, just below the prongs
  return (
    <g stroke="#78350f" strokeLinecap="round" fill="none">
      <line x1={LAUNCH_PX} y1={base} x2={LAUNCH_PX} y2={forkY} strokeWidth={5} />
      <line x1={LAUNCH_PX} y1={forkY} x2={FORK_LEFT.x} y2={FORK_LEFT.y} strokeWidth={4} />
      <line x1={LAUNCH_PX} y1={forkY} x2={FORK_RIGHT.x} y2={FORK_RIGHT.y} strokeWidth={4} />
    </g>
  );
}

// The loaded grenade and the two elastic bands. At rest the grenade sits in the
// pouch at the launch point; while the player pulls, it is drawn back (clamped to
// MAX_DRAW) and the bands stretch with it. No trajectory, arrow, or label — the
// pull itself is the aim.
function SlingPull({ aim, canFire }: { aim: Vector2 | null; canFire: boolean }) {
  const pouch = aim ? pouchPoint(aim) : WORLD.launch;
  const cx = sx(pouch.x);
  const cy = sy(pouch.y);
  const dir = subtract(WORLD.launch, pouch); // launch direction (world, y-up)
  const angle = aim ? (Math.atan2(-dir.y, dir.x) * 180) / Math.PI : 0;
  const drawn = aim ? magnitude(dir) / MAX_DRAW : 0; // 0..1 fraction of full power
  const band = canFire ? COLORS.aim : '#94a3b8';
  return (
    <g>
      <line x1={FORK_LEFT.x} y1={FORK_LEFT.y} x2={cx} y2={cy} stroke={band} strokeWidth={3} strokeLinecap="round" />
      <line x1={FORK_RIGHT.x} y1={FORK_RIGHT.y} x2={cx} y2={cy} stroke={band} strokeWidth={3} strokeLinecap="round" />
      {canFire && (
        <g transform={`translate(${cx}, ${cy})`} opacity={aim ? 0.6 + 0.4 * drawn : 1}>
          <g transform={`rotate(${angle})`}>
            <Pixels sprite={GRENADE_SPRITE} cell={2} />
          </g>
        </g>
      )}
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
      <span title="Gold available for defenses" className="font-semibold text-amber-500">
        {state.gold} gold
      </span>
      {best > 0 && <span className="text-[var(--text-muted)]">best W{best}</span>}
    </div>
  );
}
