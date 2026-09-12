import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

import {
  BASE_RANGE_M,
  gridStep,
  isHit,
  nextTargetX,
  zoomedRange,
} from '../../lib/kinematics/projectileLauncher';
import { fixed } from '../../utils/format';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

type Size = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type ProjectileState = {
  id: number;
  launchIndex: number;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  path: Point[];
  landed: boolean;
  maxHeight: number;
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const TRAIL_FADE_LAUNCHES = 10;
// On a hit, Resetti pops up beside the flag for this long, and then the flag
// moves somewhere new.
const HIT_SPRITE_DURATION_MS = 2500;
const HIT_SPRITE_SIZE = 26;
const HIT_SPRITE_SRC = '/images/resetti.png';

// Canvas insets around the plot, in CSS pixels.
const PLOT_LEFT = 48;
const PLOT_RIGHT_INSET = 36;
const GROUND_INSET = 42;
const PLOT_TOP_INSET = 34;
// Vertical space in fullscreen taken by the block header, readout, buttons, and
// sliders, which the graph has to leave free.
const FULLSCREEN_CHROME_PX = 260;

// One quantity, one colour, matching the 2D hedgehog and the other kinematics
// interactives: trajectories trace position in blue, velocity is green, and
// acceleration is purple.
const VELOCITY_COLOR = '#16a34a';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

const makeProjectile = (
  angleDeg: number,
  speed: number,
  id: number,
  launchIndex: number,
): ProjectileState => {
  const angle = toRadians(angleDeg);
  return {
    id,
    launchIndex,
    t: 0,
    x: 0,
    y: 0,
    vx: speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
    path: [{ x: 0, y: 0 }],
    landed: false,
    maxHeight: 0,
  };
};

const cloneProjectile = (projectile: ProjectileState): ProjectileState => ({
  ...projectile,
  path: [...projectile.path],
});

const cloneProjectiles = (projectiles: ProjectileState[]) => projectiles.map(cloneProjectile);

const getTrailOpacity = (launchIndex: number, currentLaunchIndex: number) => {
  const age = Math.max(0, currentLaunchIndex - launchIndex);
  return clamp(1 - age / TRAIL_FADE_LAUNCHES, 0, 1);
};

const pruneTrajectories = (trajectories: ProjectileState[], currentLaunchIndex: number) =>
  trajectories.filter((trajectory) => currentLaunchIndex - trajectory.launchIndex < TRAIL_FADE_LAUNCHES);

export default function ProjectileLauncher() {
  const [size, setSize] = useState<Size>({ width: 860, height: 480 });
  const [angleDeg, setAngleDeg] = useState(42);
  const [speed, setSpeed] = useState(24);
  const [gravity, setGravity] = useState(9.8);
  const [drag, setDrag] = useState(0);
  const [targetX, setTargetX] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [activeProjectiles, setActiveProjectiles] = useState<ProjectileState[]>([]);
  const [landedTrajectories, setLandedTrajectories] = useState<ProjectileState[]>([]);
  const [focusedProjectileId, setFocusedProjectileId] = useState<number | null>(null);
  const [launchCount, setLaunchCount] = useState(0);
  const [showHitSprite, setShowHitSprite] = useState(false);
  const [hitSpriteReady, setHitSpriteReady] = useState(false);
  // Horizontal extent of the view in metres. Grows when a shot leaves the
  // screen and holds there until Reset.
  const [rangeM, setRangeM] = useState(BASE_RANGE_M);
  const rangeRef = useRef(BASE_RANGE_M);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitSpriteRef = useRef<HTMLImageElement | null>(null);
  const activeProjectilesRef = useRef<ProjectileState[]>([]);
  const landedTrajectoriesRef = useRef<ProjectileState[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const aimingRef = useRef(false);
  const nextProjectileIdRef = useRef(1);
  const launchCountRef = useRef(0);
  const hitSpriteTimeoutRef = useRef<number | null>(null);

  const initialComponents = useMemo(() => {
    const angle = toRadians(angleDeg);
    return {
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  }, [angleDeg, speed]);

  const currentTrajectory = useMemo(() => {
    if (focusedProjectileId === null) {
      return null;
    }

    return (
      activeProjectiles.find((projectile) => projectile.id === focusedProjectileId) ??
      landedTrajectories.find((projectile) => projectile.id === focusedProjectileId) ??
      null
    );
  }, [activeProjectiles, focusedProjectileId, landedTrajectories]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return undefined;
    }

    const block = element.closest('[data-simulation-block]');

    const isFullscreen = () =>
      block instanceof HTMLElement &&
      (document.fullscreenElement === block || block.classList.contains('is-fallback-fullscreen'));

    const resize = () => {
      const width = Math.max(340, Math.floor(element.clientWidth));
      // On the page the graph is at most 480px tall. Fullscreen has the whole
      // screen to spend, so allow up to twice that, while leaving room below
      // for the readout, buttons, and sliders.
      const height = isFullscreen()
        ? Math.max(300, Math.min(960, width, window.innerHeight - FULLSCREEN_CHROME_PX))
        : Math.max(300, Math.min(480, Math.round(width * 0.5)));
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    // Entering fullscreen does not always change the wrapper's width, so watch
    // the fullscreen state itself as well.
    const mutationObserver = new MutationObserver(resize);
    if (block) {
      mutationObserver.observe(block, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('fullscreenchange', resize);
    window.addEventListener('resize', resize);

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('fullscreenchange', resize);
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    const image = new Image();
    hitSpriteRef.current = image;
    image.onload = () => setHitSpriteReady(true);
    image.src = HIT_SPRITE_SRC;

    return () => {
      image.onload = null;
      if (hitSpriteTimeoutRef.current !== null) {
        window.clearTimeout(hitSpriteTimeoutRef.current);
      }
    };
  }, []);

  // A hit shows Resetti beside the flag, then moves the flag once he leaves. A
  // second hit while he is still up (another ball landing by the same flag)
  // does not restart the celebration.
  const celebrateHit = useCallback(() => {
    if (hitSpriteTimeoutRef.current !== null) {
      return;
    }

    setShowHitSprite(true);
    hitSpriteTimeoutRef.current = window.setTimeout(() => {
      setShowHitSprite(false);
      hitSpriteTimeoutRef.current = null;
      setTargetX((current) => nextTargetX(current));
    }, HIT_SPRITE_DURATION_MS);
  }, []);

  const launch = () => {
    const nextLaunchCount = launchCountRef.current + 1;
    const projectile = makeProjectile(
      angleDeg,
      speed,
      nextProjectileIdRef.current,
      nextLaunchCount,
    );
    const nextActiveProjectiles = [...activeProjectilesRef.current, projectile];
    const nextLandedTrajectories = pruneTrajectories(
      landedTrajectoriesRef.current,
      nextLaunchCount,
    );

    nextProjectileIdRef.current += 1;
    launchCountRef.current = nextLaunchCount;
    activeProjectilesRef.current = nextActiveProjectiles;
    landedTrajectoriesRef.current = nextLandedTrajectories;

    setLaunchCount(nextLaunchCount);
    setActiveProjectiles(cloneProjectiles(nextActiveProjectiles));
    setLandedTrajectories(cloneProjectiles(nextLandedTrajectories));
    setFocusedProjectileId(projectile.id);
    setPlaying(true);
  };

  const clear = () => {
    if (hitSpriteTimeoutRef.current !== null) {
      window.clearTimeout(hitSpriteTimeoutRef.current);
      hitSpriteTimeoutRef.current = null;
    }

    activeProjectilesRef.current = [];
    landedTrajectoriesRef.current = [];
    launchCountRef.current = 0;
    nextProjectileIdRef.current = 1;
    lastFrameRef.current = null;
    rangeRef.current = BASE_RANGE_M;
    setRangeM(BASE_RANGE_M);
    setActiveProjectiles([]);
    setLandedTrajectories([]);
    setFocusedProjectileId(null);
    setLaunchCount(0);
    setShowHitSprite(false);
    setPlaying(false);
  };

  const step = useCallback(
    (dt: number) => {
      const projectiles = activeProjectilesRef.current;
      if (projectiles.length === 0) {
        return;
      }

      const stillActive: ProjectileState[] = [];
      const newlyLanded: ProjectileState[] = [];

      projectiles.forEach((state) => {
        const previousX = state.x;
        const previousY = state.y;
        const previousT = state.t;
        const ax = -drag * state.vx;
        const ay = -gravity - drag * state.vy;

        state.vx += ax * dt;
        state.vy += ay * dt;
        state.x += state.vx * dt;
        state.y += state.vy * dt;
        state.t += dt;
        state.maxHeight = Math.max(state.maxHeight, state.y);
        state.path.push({ x: state.x, y: Math.max(0, state.y) });

        if (state.y <= 0 && state.t > 0.02) {
          const fraction =
            previousY === state.y
              ? 1
              : clamp(previousY / (previousY - state.y), 0, 1);
          state.x = lerp(previousX, state.x, fraction);
          state.y = 0;
          state.t = lerp(previousT, state.t, fraction);
          state.vx = 0;
          state.vy = 0;
          state.landed = true;
          state.path[state.path.length - 1] = { x: state.x, y: 0 };
          if (isHit(state.x, targetX)) {
            celebrateHit();
          }
          newlyLanded.push(state);
          return;
        }

        stillActive.push(state);
      });

      activeProjectilesRef.current = stillActive;

      if (newlyLanded.length > 0) {
        landedTrajectoriesRef.current = pruneTrajectories(
          [...landedTrajectoriesRef.current, ...newlyLanded],
          launchCountRef.current,
        );
      }
    },
    [drag, gravity, targetX, celebrateHit],
  );

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = (timestamp - lastFrameRef.current) / 1000;
        const dt = Math.min(0.05, elapsed);
        const substeps = Math.max(1, Math.ceil(dt / (1 / 180)));
        for (let index = 0; index < substeps; index += 1) {
          step(dt / substeps);
        }

        // Zoom out to keep every ball in flight on screen. The range only grows.
        const plotAspect =
          (size.height - GROUND_INSET - PLOT_TOP_INSET) / Math.max(1, size.width - PLOT_LEFT - PLOT_RIGHT_INSET);
        let nextRange = rangeRef.current;
        activeProjectilesRef.current.forEach((projectile) => {
          nextRange = zoomedRange(nextRange, projectile.x, projectile.y, plotAspect);
        });
        if (nextRange !== rangeRef.current) {
          rangeRef.current = nextRange;
          setRangeM(nextRange);
        }

        setActiveProjectiles(cloneProjectiles(activeProjectilesRef.current));
        setLandedTrajectories(cloneProjectiles(landedTrajectoriesRef.current));

        if (activeProjectilesRef.current.length === 0) {
          setPlaying(false);
          rafRef.current = null;
          lastFrameRef.current = null;
          return;
        }
      }

      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [playing, step, size.height, size.width]);

  const getWorldViewport = useCallback(() => {
    const plotWidth = size.width - PLOT_LEFT - PLOT_RIGHT_INSET;
    const scale = plotWidth / rangeM;

    return {
      scale,
      // Pixels per metre at the unzoomed range. Arrows are sized with this, so
      // they keep their on-screen length when the view zooms out.
      baseScale: plotWidth / BASE_RANGE_M,
      rangeMax: rangeM,
      heightMax: Math.max(0, (size.height - GROUND_INSET - PLOT_TOP_INSET) / scale),
    };
  }, [rangeM, size.height, size.width]);

  const worldToScreen = useCallback(
    (point: Point) => {
      const { scale } = getWorldViewport();
      return {
        x: PLOT_LEFT + point.x * scale,
        y: size.height - GROUND_INSET - point.y * scale,
      };
    },
    [getWorldViewport, size.height],
  );

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = getCssColor('--surface-plot', '#ffffff');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const position = getCssColor('--accent-blue', '#2563eb');
    const red = getCssColor('--accent-red', '#ef4444');
    const velocity = VELOCITY_COLOR;
    const acceleration = getCssColor('--accent-purple', '#7e57c2');

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

    const { rangeMax, heightMax, baseScale } = getWorldViewport();
    const groundY = size.height - GROUND_INSET;
    const stepMeters = gridStep(rangeMax);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= rangeMax; x += stepMeters) {
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.beginPath();
      ctx.moveTo(sx, 18);
      ctx.lineTo(sx, groundY + 6);
      ctx.stroke();
    }
    for (let y = 0; y <= heightMax; y += stepMeters) {
      const sy = worldToScreen({ x: 0, y }).y;
      ctx.beginPath();
      ctx.moveTo(34, sy);
      ctx.lineTo(size.width - 18, sy);
      ctx.stroke();
    }

    // The ground is a neutral line: green is reserved for velocity.
    ctx.strokeStyle = text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, groundY);
    ctx.lineTo(size.width - 18, groundY);
    ctx.stroke();

    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(48, 18);
    ctx.lineTo(48, groundY + 10);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let x = 0; x <= rangeMax; x += stepMeters * 2) {
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.fillText(`${x.toFixed(0)} m`, sx, groundY + 20);
    }
    ctx.textAlign = 'left';

    const target = worldToScreen({ x: targetX, y: 0 });
    ctx.strokeStyle = red;
    ctx.fillStyle = red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(target.x, target.y - 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - 44);
    ctx.lineTo(target.x + 18, target.y - 35);
    ctx.lineTo(target.x, target.y - 26);
    ctx.closePath();
    ctx.fill();

    if (showHitSprite && hitSpriteReady && hitSpriteRef.current) {
      const spriteSize = HIT_SPRITE_SIZE;
      const spriteGap = 20;
      const spriteX =
        target.x + spriteGap + spriteSize <= size.width - 18
          ? target.x + spriteGap
          : target.x - spriteGap - spriteSize;
      const spriteY = target.y - 44;
      ctx.drawImage(hitSpriteRef.current, spriteX, spriteY, spriteSize, spriteSize);
    }

    const drawPath = (path: Point[], color: string, alpha = 1, width = 2.5, dash: number[] = []) => {
      if (path.length < 2) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      path.forEach((point, index) => {
        const screen = worldToScreen(point);
        if (index === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      });
      ctx.stroke();
      ctx.restore();
    };

    landedTrajectories.forEach((trajectory) => {
      drawPath(
        trajectory.path,
        position,
        getTrailOpacity(trajectory.launchIndex, launchCount),
        2.3,
        [8, 6],
      );
    });

    activeProjectiles.forEach((projectile) => {
      drawPath(projectile.path, position, projectile.id === focusedProjectileId ? 1 : 0.68, 2.6);
    });

    const origin = worldToScreen({ x: 0, y: 0 });
    const launchTip = {
      x: origin.x + initialComponents.vx * 0.72 * baseScale,
      y: origin.y - initialComponents.vy * 0.72 * baseScale,
    };
    drawArrow(ctx, origin.x, origin.y, launchTip.x, launchTip.y, velocity, 3);
    drawVectorLabel(ctx, origin, launchTip, 'v', '0', velocity);

    // Arrows go down before the balls so each ball sits on top of its own arrows.
    const focusedActiveProjectile =
      focusedProjectileId === null
        ? null
        : activeProjectiles.find((projectile) => projectile.id === focusedProjectileId) ?? null;

    if (focusedActiveProjectile) {
      const ball = worldToScreen({ x: focusedActiveProjectile.x, y: focusedActiveProjectile.y });
      const vTip = {
        x: ball.x + focusedActiveProjectile.vx * baseScale * 0.35,
        y: ball.y - focusedActiveProjectile.vy * baseScale * 0.35,
      };
      // The full acceleration, drag included, not just gravity.
      const ax = -drag * focusedActiveProjectile.vx;
      const ay = -gravity - drag * focusedActiveProjectile.vy;
      const aTip = { x: ball.x + ax * baseScale * 0.52, y: ball.y - ay * baseScale * 0.52 };
      drawArrow(ctx, ball.x, ball.y, vTip.x, vTip.y, velocity, 2.4);
      drawArrow(ctx, ball.x, ball.y, aTip.x, aTip.y, acceleration, 2.4);
      drawVectorLabel(ctx, ball, vTip, 'v', '', velocity);
      drawVectorLabel(ctx, ball, aTip, 'a', '', acceleration);
    }

    activeProjectiles.forEach((projectile) => {
      const ball = worldToScreen({ x: projectile.x, y: projectile.y });
      ctx.save();
      ctx.globalAlpha = projectile.id === focusedProjectileId ? 1 : 0.72;
      ctx.fillStyle = position;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = text;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const focusedLandedProjectile =
      focusedProjectileId === null
        ? null
        : landedTrajectories.find((projectile) => projectile.id === focusedProjectileId) ?? null;

    if (focusedLandedProjectile) {
      const landing = worldToScreen({ x: focusedLandedProjectile.x, y: 0 });
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = red;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(landing.x, landing.y - 12);
      ctx.lineTo(target.x, target.y - 12);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = bg;
      ctx.strokeStyle = red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(landing.x, landing.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [
    activeProjectiles,
    drag,
    focusedProjectileId,
    getWorldViewport,
    gravity,
    initialComponents.vx,
    initialComponents.vy,
    landedTrajectories,
    launchCount,
    showHitSprite,
    hitSpriteReady,
    size.height,
    size.width,
    targetX,
    worldToScreen,
  ]);

  useEffect(() => {
    drawScene();
  }, [drawScene]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    aimingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    handlePointerMove(event);
  };

  // Dragging anywhere aims the launch arrow. The pointer is read at the
  // unzoomed scale the arrow is drawn at, so aiming feels the same zoomed out.
  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!aimingRef.current) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const { baseScale } = getWorldViewport();
    const dx = (event.clientX - rect.left - PLOT_LEFT) / baseScale;
    const dy = (size.height - GROUND_INSET - (event.clientY - rect.top)) / baseScale;

    setAngleDeg(clamp(toDegrees(Math.atan2(dy, dx)), 0, 88));
    setSpeed(clamp(Math.hypot(dx, dy) / 0.72, 2, 60));
  };

  const stopDragging = () => {
    aimingRef.current = false;
  };

  return (
    <div ref={wrapperRef} className="flex h-full flex-col gap-3 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]">
      <Readout variant="inline" className="justify-center tabular-nums">
        <Readout.Value label="t" value={fixed(currentTrajectory?.t ?? 0, 2)} unit="s" />
        <Readout.Value label="range" value={fixed(currentTrajectory?.x ?? 0, 1)} unit="m" />
        <Readout.Value label="max height" value={fixed(currentTrajectory?.maxHeight ?? 0, 1)} unit="m" />
      </Readout>

      <canvas
        ref={canvasRef}
        className="block max-w-full rounded-lg border border-[var(--grid-line)] bg-[var(--surface-plot)] shadow-sm"
        style={{ touchAction: 'none' }}
        aria-label="Projectile launcher: drag to aim the launch velocity, and land within a metre of the red flag"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={stopDragging}
      />

      <ControlBar>
        <button type="button" onClick={launch} className={buttonClass}>
          Launch
        </button>
        <button
          type="button"
          onClick={() => setPlaying((value) => (activeProjectiles.length > 0 ? !value : value))}
          className={buttonClass}
          disabled={activeProjectiles.length === 0}
        >
          {playing ? 'Pause' : 'Resume'}
        </button>
        <button type="button" title="Clear trajectories" onClick={clear} className={buttonClass}>
          Reset
        </button>
      </ControlBar>

      <ControlBar>
        <Slider label="Angle" unit="°" min={0} max={88} step={0.5} value={angleDeg} onChange={setAngleDeg} format={(value) => fixed(value, 0)} />
        <Slider label="Speed" unit="m/s" min={2} max={60} step={0.5} value={speed} onChange={setSpeed} format={(value) => fixed(value, 1)} />
        <Slider label="Gravity" unit="m/s²" min={1} max={20} step={0.1} value={gravity} onChange={setGravity} format={(value) => fixed(value, 1)} />
        <Slider label="Air drag" unit="1/s" min={0} max={0.7} step={0.01} value={drag} onChange={setDrag} format={(value) => fixed(value, 2)} />
      </ControlBar>
    </div>
  );
}

const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The shaft stops at the base of the head instead of running through it to the
 * tip, so a wide line never pokes out past the point.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  lineWidth = 2,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 3) {
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(Math.max(10, lineWidth * 4), length * 0.6);
  const halfWidth = head * 0.5;
  const baseX = x1 - ux * head;
  const baseY = y1 - uy * head;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  // A hair past the base so no seam shows between shaft and head.
  ctx.lineTo(baseX + ux, baseY + uy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(baseX - uy * halfWidth, baseY + ux * halfWidth);
  ctx.lineTo(baseX + uy * halfWidth, baseY - ux * halfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** An italic vector symbol, with an optional subscript, just past an arrow's tip. */
function drawVectorLabel(
  ctx: CanvasRenderingContext2D,
  from: Point,
  tip: Point,
  symbol: string,
  subscript: string,
  color: string,
) {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 3) {
    return;
  }

  const x = tip.x + (dx / length) * 13;
  const y = tip.y + (dy / length) * 13;

  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `italic 700 15px ${FONT}`;
  ctx.fillText(symbol, x, y);
  if (subscript) {
    const symbolWidth = ctx.measureText(symbol).width;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(subscript, x + symbolWidth / 2, y + 5);
  }
  ctx.restore();
}
