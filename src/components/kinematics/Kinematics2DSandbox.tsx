import { Cloud, Dices, Trophy, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  GOAL_RUSH_DEFAULTS,
  selectBestGoalRushScoresByUniqueName,
  type GoalRushLeaderboardScore,
} from '../../lib/kinematics/goalRush';
import {
  isBlockedLeaderboardName,
  sanitizeLeaderboardName,
} from '../../lib/kinematics/stopZones';
import { generateLeaderboardName } from '../../lib/shared/leaderboardNames';
import { fixed } from '../../utils/format';
import { ControlBar, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

type Size = {
  width: number;
  height: number;
};

type SpawnKind = 'goal' | 'boost' | 'clock';

type Spawn = {
  id: number;
  kind: SpawnKind;
  x: number;
  y: number;
  radius: number;
  points: number;
  golden: boolean;
};

type Runtime = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  gravityOn: boolean;
  goalRush: boolean;
  score: number;
  normalHits: number;
  goldenHits: number;
  timeLeft: number;
  boostLeft: number;
  spawns: Spawn[];
  lastTime: number | null;
  elapsedMs: number;
  finalDurationMs: number | null;
  runId: string | null;
  nextClockSpawnMs: number;
};

type Snapshot = Runtime & {
  speed: number;
};

type ApiStatus = 'checking' | 'online' | 'offline';
type GoalRushScoreEntry = GoalRushLeaderboardScore & { id?: string };

const GAME_TIME = GOAL_RUSH_DEFAULTS.gameTimeS;
const GRID_HALF_CELLS = 8;
const GRID_CELLS = GRID_HALF_CELLS * 2;
const GRID_CELL_SIZE = 50;
const BOARD_SIZE = GRID_CELLS * GRID_CELL_SIZE;
const BOARD_HALF_SIZE = BOARD_SIZE / 2;
const PLAYER_RADIUS = 8;
const CONTROL_ACCEL = 400;
const BOOST_ACCEL_BONUS = 200;
const GRAVITY_ACCEL = 210;
const MAX_SPEED = 820;
const BOOST_DURATION = 5;
const CLOCK_BONUS = 5;
const CLOCK_SPAWN_INTERVAL_MS = 5000;
const SPAWN_COUNT = 4;
const FULLSCREEN_RAIL_MIN_WIDTH = 1100;
const FULLSCREEN_RAIL_MIN_HEIGHT = 760;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
// On the lesson page the board is capped so the sandbox sits in the reading
// flow; fullscreen lets it grow to fill the screen.
const INLINE_MAX_SIDE = 480;

// One quantity, one colour, matching the 2D hedgehog and the 1D explorers.
const POSITION_COLOR = 'var(--accent-blue)';
const VELOCITY_COLOR = '#16a34a';
const ACCELERATION_COLOR = 'var(--accent-purple)';

/** A board vector as grid-square components, with y flipped to point up. */
const gridVector = (x: number, y: number) =>
  `⟨${fixed(x / GRID_CELL_SIZE, 1)}, ${fixed(-y / GRID_CELL_SIZE, 1)}⟩`;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

const createRuntime = (): Runtime => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  ax: 0,
  ay: 0,
  gravityOn: false,
  goalRush: false,
  score: 0,
  normalHits: 0,
  goldenHits: 0,
  timeLeft: GAME_TIME,
  boostLeft: 0,
  spawns: [],
  lastTime: null,
  elapsedMs: 0,
  finalDurationMs: null,
  runId: null,
  nextClockSpawnMs: CLOCK_SPAWN_INTERVAL_MS,
});

const makeSnapshot = (runtime: Runtime): Snapshot => ({
  ...runtime,
  spawns: runtime.spawns.map((spawn) => ({ ...spawn })),
  speed: Math.hypot(runtime.vx, runtime.vy),
});

const makeSpawnPosition = () => {
  const margin = 58;

  return {
    x: randomBetween(-BOARD_HALF_SIZE + margin, BOARD_HALF_SIZE - margin),
    y: randomBetween(-BOARD_HALF_SIZE + margin, BOARD_HALF_SIZE - margin),
  };
};

const makeClockSpawn = (id: number): Spawn => {
  const { x, y } = makeSpawnPosition();

  return { id, kind: 'clock', x, y, radius: 16, points: 0, golden: false };
};

const makeSpawn = (id: number): Spawn => {
  const roll = Math.random();

  if (roll < 0.14) {
    return makeClockSpawn(id);
  }

  const { x, y } = makeSpawnPosition();

  if (roll < 0.29) {
    return { id, kind: 'boost', x, y, radius: 16, points: 0, golden: false };
  }

  const golden = Math.random() < 0.16;
  return {
    id,
    kind: 'goal',
    x,
    y,
    radius: golden ? 20 : 18,
    points: golden ? 3 : 1,
    golden,
  };
};

export default function Kinematics2DSandbox() {
  const [size, setSize] = useState<Size>({ width: BOARD_SIZE, height: BOARD_SIZE });
  const [snapshot, setSnapshot] = useState<Snapshot>(() => makeSnapshot(createRuntime()));
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime>(createRuntime());
  const rafRef = useRef<number | null>(null);
  const keysRef = useRef({ left: false, right: false, up: false, down: false });
  const pointerRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const spawnIdRef = useRef(0);
  const submittedRef = useRef(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [cloudScores, setCloudScores] = useState<GoalRushScoreEntry[]>([]);
  const [localScores, setLocalScores] = useState<GoalRushScoreEntry[]>([]);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [shellSize, setShellSize] = useState<Size>({ width: 0, height: 0 });
  const [fullscreenActive, setFullscreenActive] = useState(false);

  const syncSnapshot = useCallback(() => {
    setSnapshot(makeSnapshot(runtimeRef.current));
  }, []);

  const seedSpawns = useCallback(() => {
    const runtime = runtimeRef.current;
    const nextSpawns: Spawn[] = [];

    spawnIdRef.current += 1;
    nextSpawns.push(makeClockSpawn(spawnIdRef.current));

    for (let index = 0; index < SPAWN_COUNT; index += 1) {
      if (nextSpawns.length >= SPAWN_COUNT) {
        break;
      }

      spawnIdRef.current += 1;
      nextSpawns.push(makeSpawn(spawnIdRef.current));
    }

    runtime.spawns = nextSpawns;
    runtime.nextClockSpawnMs = CLOCK_SPAWN_INTERVAL_MS;
  }, []);

  const loadLocalScores = useCallback(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(GOAL_RUSH_DEFAULTS.localStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return selectBestGoalRushScoresByUniqueName(parsed as GoalRushScoreEntry[]);
      }
    } catch {
      return [];
    }

    return [];
  }, []);

  const saveLocalScore = useCallback((score: GoalRushScoreEntry) => {
    const next = selectBestGoalRushScoresByUniqueName([...loadLocalScores(), score]);

    try {
      window.localStorage.setItem(GOAL_RUSH_DEFAULTS.localStorageKey, JSON.stringify(next));
    } catch {
      // Local scores are a bonus path; the sandbox should keep running without storage.
    }

    setLocalScores(next);
    return next;
  }, [loadLocalScores]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const response = await fetch('/api/kinematics/goal-rush/leaderboard?limit=10', {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Goal Rush leaderboard request failed: ${response.status}`);
      }

      const body = await response.json();
      const scores = Array.isArray(body.scores) ? body.scores : [];
      setCloudScores(scores);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    }
  }, []);

  const createServerRun = useCallback(async () => {
    const runtime = runtimeRef.current;

    try {
      const response = await fetch('/api/kinematics/goal-rush/run', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Goal Rush run request failed: ${response.status}`);
      }

      const body = await response.json();
      runtime.runId = typeof body.runId === 'string' ? body.runId : null;
      setApiStatus(runtime.runId ? 'online' : 'offline');
    } catch {
      runtime.runId = null;
      setApiStatus('offline');
    }
  }, []);

  const reset = useCallback(
    (keepMode = true) => {
      const previous = runtimeRef.current;
      runtimeRef.current = {
        ...createRuntime(),
        goalRush: keepMode ? previous.goalRush : false,
        gravityOn: keepMode ? previous.gravityOn : false,
      };
      submittedRef.current = false;
      setNameModalOpen(false);

      if (runtimeRef.current.goalRush) {
        seedSpawns();
        void createServerRun();
      }

      syncSnapshot();
    },
    [createServerRun, seedSpawns, syncSnapshot],
  );

  // Back to the centre in the current mode: a fresh sandbox, or a fresh Goal
  // Rush run that starts counting down straight away.
  const restart = useCallback(() => {
    reset(true);
    window.requestAnimationFrame(() => wrapperRef.current?.focus({ preventScroll: true }));
  }, [reset]);

  useEffect(() => {
    setLocalScores(loadLocalScores());
    void refreshLeaderboard();
  }, [loadLocalScores, refreshLeaderboard]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return undefined;
    }

    const block = wrapper.closest('[data-simulation-block]');
    const target = block instanceof HTMLElement ? block : wrapper;

    const updateShellState = () => {
      const rect = target.getBoundingClientRect();
      const nextWidth = Math.max(0, Math.round(rect.width));
      const nextHeight = Math.max(0, Math.round(rect.height));
      setShellSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
      setFullscreenActive(
        document.fullscreenElement === target ||
          (target instanceof HTMLElement && target.classList.contains('is-fallback-fullscreen')),
      );
    };

    updateShellState();
    const resizeObserver = new ResizeObserver(updateShellState);
    resizeObserver.observe(target);
    const mutationObserver = new MutationObserver(updateShellState);
    mutationObserver.observe(target, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('fullscreenchange', updateShellState);
    window.addEventListener('resize', updateShellState);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('fullscreenchange', updateShellState);
      window.removeEventListener('resize', updateShellState);
    };
  }, []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const availableWidth = Math.max(320, Math.floor(element.clientWidth));
      const availableHeight = fullscreenActive
        ? Math.max(320, shellSize.height - 220)
        : INLINE_MAX_SIDE;
      const side = Math.max(320, Math.floor(Math.min(availableWidth, availableHeight)));
      setSize({ width: side, height: side });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [fullscreenActive, shellSize.height]);

  useEffect(() => {
    if (runtimeRef.current.goalRush) {
      seedSpawns();
      syncSnapshot();
    }
  }, [seedSpawns, syncSnapshot]);

  useEffect(() => {
    const updateKey = (event: KeyboardEvent, isDown: boolean) => {
      const key = event.key.toLowerCase();
      const usesControl =
        key === 'arrowleft' ||
        key === 'arrowright' ||
        key === 'arrowup' ||
        key === 'arrowdown' ||
        key === 'a' ||
        key === 'd' ||
        key === 'w' ||
        key === 's' ||
        key === 'r';

      if (!usesControl) {
        return;
      }

      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }

      event.preventDefault();

      if (key === 'r') {
        if (isDown && !event.repeat) {
          restart();
        }
        return;
      }

      keysRef.current.left = key === 'arrowleft' || key === 'a' ? isDown : keysRef.current.left;
      keysRef.current.right = key === 'arrowright' || key === 'd' ? isDown : keysRef.current.right;
      keysRef.current.up = key === 'arrowup' || key === 'w' ? isDown : keysRef.current.up;
      keysRef.current.down = key === 'arrowdown' || key === 's' ? isDown : keysRef.current.down;
    };

    // Listen on the sandbox itself, not the window: the steering keys should
    // steer only while the sandbox (or a control inside it) has focus, and
    // scroll the page as usual everywhere else.
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return undefined;
    }

    const onDown = (event: KeyboardEvent) => updateKey(event, true);
    const onUp = (event: KeyboardEvent) => updateKey(event, false);
    // A key released after focus has moved away never reaches us, so drop any
    // held keys on the way out rather than letting the player drift forever.
    const onFocusOut = (event: FocusEvent) => {
      if (!wrapper.contains(event.relatedTarget as Node | null)) {
        keysRef.current = { left: false, right: false, up: false, down: false };
      }
    };
    wrapper.addEventListener('keydown', onDown);
    wrapper.addEventListener('keyup', onUp);
    wrapper.addEventListener('focusout', onFocusOut);

    return () => {
      wrapper.removeEventListener('keydown', onDown);
      wrapper.removeEventListener('keyup', onUp);
      wrapper.removeEventListener('focusout', onFocusOut);
    };
  }, [restart]);

  const toScreen = useCallback(
    (x: number, y: number) => ({
      x: BOARD_HALF_SIZE + x,
      y: BOARD_HALF_SIZE + y,
    }),
    [],
  );

  const toWorld = useCallback(
    (x: number, y: number) => ({
      x: (x / Math.max(1, size.width)) * BOARD_SIZE - BOARD_HALF_SIZE,
      y: (y / Math.max(1, size.height)) * BOARD_SIZE - BOARD_HALF_SIZE,
    }),
    [size.height, size.width],
  );

  const finishGame = useCallback(() => {
    const runtime = runtimeRef.current;
    runtime.timeLeft = 0;
    runtime.finalDurationMs = Math.max(0, Math.round(runtime.elapsedMs));
    // Straight back to free play, so the board never stops responding. The
    // finished run's score and run id stay on the runtime for the save dialog;
    // clearing goalRush also stops the countdown from finishing a second time.
    runtime.goalRush = false;
    runtime.spawns = [];
    runtime.boostLeft = 0;
    setNameModalOpen(true);
  }, []);

  const stepRuntime = useCallback(
    (dt: number) => {
      const runtime = runtimeRef.current;
      const keys = keysRef.current;
      let controlX = 0;
      let controlY = 0;

      if (pointerRef.current.active) {
        controlX = pointerRef.current.x - runtime.x;
        controlY = pointerRef.current.y - runtime.y;
      } else {
        controlX = Number(keys.right) - Number(keys.left);
        controlY = Number(keys.down) - Number(keys.up);
      }

      let ax = 0;
      let ay = 0;
      const controlMagnitude = Math.hypot(controlX, controlY);
      if (controlMagnitude > 0.0001) {
        const controlAccel = CONTROL_ACCEL + (runtime.boostLeft > 0 ? BOOST_ACCEL_BONUS : 0);
        ax = (controlX / controlMagnitude) * controlAccel;
        ay = (controlY / controlMagnitude) * controlAccel;
      }

      if (runtime.gravityOn) {
        ay += GRAVITY_ACCEL;
      }

      runtime.ax = ax;
      runtime.ay = ay;
      runtime.boostLeft = Math.max(0, runtime.boostLeft - dt);

      runtime.vx += runtime.ax * dt;
      runtime.vy += runtime.ay * dt;
      const speed = Math.hypot(runtime.vx, runtime.vy);
      if (speed > MAX_SPEED) {
        runtime.vx *= MAX_SPEED / speed;
        runtime.vy *= MAX_SPEED / speed;
      }
      runtime.x += runtime.vx * dt;
      runtime.y += runtime.vy * dt;

      if (runtime.goalRush) {
        runtime.elapsedMs += dt * 1000;
        while (runtime.elapsedMs >= runtime.nextClockSpawnMs) {
          spawnIdRef.current += 1;
          runtime.spawns[0] = makeClockSpawn(spawnIdRef.current);
          runtime.nextClockSpawnMs += CLOCK_SPAWN_INTERVAL_MS;
        }

        runtime.timeLeft = Math.max(0, runtime.timeLeft - dt);
        if (runtime.timeLeft <= 0) {
          finishGame();
        }
      }

      const halfW = BOARD_HALF_SIZE - PLAYER_RADIUS - 8;
      const halfH = BOARD_HALF_SIZE - PLAYER_RADIUS - 8;
      if (runtime.x < -halfW) {
        runtime.x = -halfW;
        runtime.vx *= -0.62;
      }
      if (runtime.x > halfW) {
        runtime.x = halfW;
        runtime.vx *= -0.62;
      }
      if (runtime.y < -halfH) {
        runtime.y = -halfH;
        runtime.vy *= -0.62;
      }
      if (runtime.y > halfH) {
        runtime.y = halfH;
        runtime.vy *= -0.62;
      }

      if (runtime.goalRush) {
        runtime.spawns.forEach((spawn, index) => {
          const touched = Math.hypot(runtime.x - spawn.x, runtime.y - spawn.y) <= PLAYER_RADIUS + spawn.radius;
          if (!touched) {
            return;
          }

          if (spawn.kind === 'goal') {
            runtime.score += spawn.points;
            if (spawn.golden) {
              runtime.goldenHits += 1;
            } else {
              runtime.normalHits += 1;
            }
          } else if (spawn.kind === 'boost') {
            runtime.boostLeft = BOOST_DURATION;
          } else {
            runtime.timeLeft += CLOCK_BONUS;
          }

          spawnIdRef.current += 1;
          runtime.spawns[index] = makeSpawn(spawnIdRef.current);
        });
      }
    },
    [finishGame],
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
    const displayWidth = Math.max(1, size.width);
    const displayHeight = Math.max(1, size.height);
    const scaleX = displayWidth / BOARD_SIZE;
    const scaleY = displayHeight / BOARD_SIZE;
    canvas.width = Math.floor(displayWidth * dpr);
    canvas.height = Math.floor(displayHeight * dpr);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    ctx.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
    // Board units per CSS pixel, so strokes and text keep their on-screen size
    // however far the board is scaled down.
    const px = 1 / scaleX;

    const bg = getCssColor('--surface-plot', '#ffffff');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const red = getCssColor('--accent-red', '#ef4444');
    const velocity = VELOCITY_COLOR;
    const acceleration = getCssColor('--accent-purple', '#7e57c2');
    // Pickups stay clear of the vector colours: velocity is green and
    // acceleration purple, so plain targets are neutral and clocks are cyan.
    const amber = '#d97706';
    const cyan = '#0891b2';

    const runtime = runtimeRef.current;
    ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    ctx.strokeStyle = grid;
    ctx.lineWidth = px;
    for (let x = BOARD_HALF_SIZE; x <= BOARD_SIZE; x += GRID_CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BOARD_SIZE);
      ctx.stroke();
    }
    for (let x = BOARD_HALF_SIZE - GRID_CELL_SIZE; x >= 0; x -= GRID_CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BOARD_SIZE);
      ctx.stroke();
    }
    for (let y = BOARD_HALF_SIZE; y <= BOARD_SIZE; y += GRID_CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BOARD_SIZE, y);
      ctx.stroke();
    }
    for (let y = BOARD_HALF_SIZE - GRID_CELL_SIZE; y >= 0; y -= GRID_CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BOARD_SIZE, y);
      ctx.stroke();
    }

    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(0, BOARD_HALF_SIZE);
    ctx.lineTo(BOARD_SIZE, BOARD_HALF_SIZE);
    ctx.moveTo(BOARD_HALF_SIZE, 0);
    ctx.lineTo(BOARD_HALF_SIZE, BOARD_SIZE);
    ctx.stroke();

    if (runtime.goalRush) {
      runtime.spawns.forEach((spawn) => {
        const point = toScreen(spawn.x, spawn.y);
        if (spawn.kind === 'goal') {
          ctx.strokeStyle = spawn.golden ? amber : muted;
          ctx.lineWidth = spawn.golden ? 4 : 3;
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = spawn.golden ? amber : muted;
          ctx.globalAlpha = spawn.golden ? 0.28 : 0.22;
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (spawn.kind === 'boost') {
          ctx.fillStyle = red;
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 18px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', point.x, point.y);
        } else {
          ctx.strokeStyle = cyan;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(point.x, point.y - 8);
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(point.x + 7, point.y + 4);
          ctx.stroke();
        }
      });
    }

    const player = toScreen(runtime.x, runtime.y);
    if (runtime.boostLeft > 0) {
      const pulse = 1 + 0.16 * Math.sin(performance.now() * 0.012);
      ctx.fillStyle = 'rgba(239,68,68,0.18)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, 25 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Arrows start at the player's centre and sit behind its disc.
    drawArrow(ctx, player.x, player.y, player.x + runtime.ax * 0.24, player.y + runtime.ay * 0.24, acceleration, 'a', px);
    drawArrow(ctx, player.x, player.y, player.x + runtime.vx * 0.18, player.y + runtime.vy * 0.18, velocity, 'v', px);

    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = `600 ${13 * px}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (runtime.goalRush) {
      ctx.fillText(`time ${runtime.timeLeft.toFixed(1)} s`, 12 * px, 10 * px);
      ctx.fillText(`score ${runtime.score}`, 12 * px, 28 * px);
    }

    ctx.strokeStyle = muted;
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(px, px, BOARD_SIZE - 2 * px, BOARD_SIZE - 2 * px);
  }, [size.height, size.width, toScreen]);

  useEffect(() => {
    const animate = (timestamp: number) => {
      const runtime = runtimeRef.current;
      const previous = runtime.lastTime ?? timestamp;
      runtime.lastTime = timestamp;
      const dt = Math.min(0.04, Math.max(0, (timestamp - previous) / 1000));
      stepRuntime(dt);
      drawScene();
      setSnapshot(makeSnapshot(runtime));
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [drawScene, stepRuntime]);

  // Starting a game always turns gravity off: every run is played on the same
  // flat field, so scores on the board compare like with like.
  const startGoalRush = () => {
    runtimeRef.current.goalRush = true;
    runtimeRef.current.gravityOn = false;
    restart();
  };

  const endGoalRush = () => {
    runtimeRef.current.goalRush = false;
    restart();
  };

  const setGravity = (gravityOn: boolean) => {
    runtimeRef.current.gravityOn = gravityOn;
    syncSnapshot();
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    // Clicking the board focuses the sandbox, so the keys work from here on.
    wrapperRef.current?.focus({ preventScroll: true });
    const rect = event.currentTarget.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    pointerRef.current = { active: true, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current.active) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const point = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    pointerRef.current = { active: true, x: point.x, y: point.y };
  };

  const handlePointerUp = () => {
    pointerRef.current.active = false;
  };

  const leaderboardScores = useMemo(
    () => selectBestGoalRushScoresByUniqueName(apiStatus === 'online' ? cloudScores : localScores),
    [apiStatus, cloudScores, localScores],
  );
  const leaderboardLabel = apiStatus === 'online' ? 'Cloud leaderboard' : 'Local leaderboard';
  const useLeaderboardRail =
    fullscreenActive &&
    shellSize.width >= FULLSCREEN_RAIL_MIN_WIDTH &&
    shellSize.height >= FULLSCREEN_RAIL_MIN_HEIGHT;

  const handleScoreSubmit = async () => {
    const runtime = runtimeRef.current;
    if (runtime.finalDurationMs === null || submittedRef.current) {
      setNameModalOpen(false);
      return;
    }

    // Keep the modal open so the player can fix the name. The API validators
    // enforce the same rule for anything that bypasses this check.
    if (isBlockedLeaderboardName(playerName)) {
      setNameError('That name cannot go on a shared board. Try another, or roll one.');
      return;
    }

    submittedRef.current = true;
    const score: GoalRushScoreEntry = {
      name: sanitizeLeaderboardName(playerName),
      score: runtime.score,
      goldenHits: runtime.goldenHits,
      normalHits: runtime.normalHits,
      durationMs: runtime.finalDurationMs,
      createdAt: Date.now(),
    };

    saveLocalScore(score);
    setNameModalOpen(false);

    if (!runtime.runId) {
      setApiStatus('offline');
      return;
    }

    setIsPosting(true);
    try {
      const response = await fetch('/api/kinematics/goal-rush/leaderboard', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: runtime.runId,
          name: score.name,
          score: score.score,
          goldenHits: score.goldenHits,
          normalHits: score.normalHits,
          durationMs: score.durationMs,
        }),
      });

      if (!response.ok) {
        throw new Error(`Goal Rush score submit failed: ${response.status}`);
      }

      const body = await response.json();
      setCloudScores(Array.isArray(body.scores) ? body.scores : []);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      aria-label="2D acceleration sandbox: focus here, then steer with the arrow keys or WASD"
      className="flex h-full flex-col gap-3 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
    >
      <Readout variant="inline" className="justify-center tabular-nums">
        <Readout.Value label={<VectorSymbol color={POSITION_COLOR}>r</VectorSymbol>} value={gridVector(snapshot.x, snapshot.y)} unit="sq" />
        <Readout.Value label={<VectorSymbol color={VELOCITY_COLOR}>v</VectorSymbol>} value={gridVector(snapshot.vx, snapshot.vy)} unit="sq/s" />
        <Readout.Value label={<VectorSymbol color={ACCELERATION_COLOR}>a</VectorSymbol>} value={gridVector(snapshot.ax, snapshot.ay)} unit="sq/s²" />
      </Readout>

      <div
        className={
          useLeaderboardRail
            ? 'grid flex-1 gap-4 grid-cols-[minmax(0,1fr)_minmax(20rem,0.36fr)]'
            : 'flex flex-1 flex-col gap-3'
        }
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div ref={stageRef} className="flex min-w-0 justify-center">
            <canvas
              ref={canvasRef}
              className="block max-w-full rounded-lg border border-[var(--grid-line)] bg-[var(--surface-plot)] shadow-sm"
              style={{ touchAction: 'none' }}
              aria-label="Two-dimensional acceleration sandbox with velocity and acceleration vectors"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>

          <ControlBar>
              <button type="button" onClick={snapshot.goalRush ? endGoalRush : startGoalRush} className={buttonClass}>
                {snapshot.goalRush ? 'End Goal Rush' : 'Goal Rush'}
              </button>
              <button type="button" title="Reset" onClick={restart} className={buttonClass}>
                Reset
                <kbd className="ml-1 border border-[var(--grid-line)] bg-[var(--sim-bg)] px-1.5 py-0.5 text-[0.7rem] font-semibold leading-none text-[var(--text-muted)]">
                  R
                </kbd>
              </button>
              <Toggle checked={snapshot.gravityOn} onChange={setGravity} label="Gravity" />
          </ControlBar>
        </div>

        <aside className={useLeaderboardRail ? 'flex min-w-0 flex-col gap-4' : 'mx-auto flex w-full max-w-[32rem] min-w-0 flex-col gap-4'}>
          <details className="group border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="text-[var(--text-muted)] transition-transform group-open:rotate-90">
                  ▸
                </span>
                <span className="text-base font-semibold">{leaderboardLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)]">
                {apiStatus === 'online' ? <Cloud size={15} /> : <WifiOff size={15} />}
                {apiStatus}
              </span>
            </summary>
            <div className="px-4 pb-4">
            {leaderboardScores.length > 0 ? (
              <div>
                <div className="grid grid-cols-[2.25rem_minmax(5.5rem,0.85fr)_minmax(0,1fr)_4.5rem] gap-2 border-b border-[var(--grid-line)] pb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
                  <span className="text-right">#</span>
                  <span>Date</span>
                  <span>Name</span>
                  <span>Score</span>
                </div>
                <ol className="m-0 space-y-0 p-0">
                  {leaderboardScores.map((score, index) => (
                    <li
                      key={`${score.id ?? score.name}-${score.score}-${score.durationMs}-${index}`}
                      className="grid grid-cols-[2.25rem_minmax(5.5rem,0.85fr)_minmax(0,1fr)_4.5rem] items-center gap-2 border-b border-[var(--grid-line)] py-2 text-sm last:border-b-0"
                    >
                      <span className="text-right font-semibold text-[var(--text-muted)]">#{index + 1}</span>
                      <span className="text-xs text-[var(--text-muted)]">{formatScoreDate(score.createdAt)}</span>
                      <span className="min-w-0 truncate font-semibold">{score.name}</span>
                      <span className="font-semibold">{score.score}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="m-0 text-sm text-[var(--text-muted)]">No scores yet.</p>
            )}
            {isPosting && <p className="mt-3 mb-0 text-sm text-[var(--text-muted)]">Posting score...</p>}
            </div>
          </details>
        </aside>
      </div>

      {nameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-sm border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 text-[var(--text-primary)] shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleScoreSubmit();
            }}
          >
            <h3 className="m-0 text-lg font-semibold">Save score</h3>
            <p className="mt-2 mb-4 text-sm text-[var(--text-muted)]">
              {snapshot.score} points in {formatGoalRushDuration(snapshot.finalDurationMs)}
            </p>
            <label className="block text-sm font-semibold">
              Display name
              <div className="mt-2 flex gap-2">
                <input
                  value={playerName}
                  onChange={(event) => {
                    setPlayerName(event.target.value);
                    setNameError(null);
                  }}
                  maxLength={24}
                  placeholder="Initials or display name"
                  className="w-full rounded-md border border-[var(--grid-line)] bg-[var(--sim-bg)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                  autoFocus
                />
                <button
                  type="button"
                  className={buttonClass}
                  title="Roll a random name"
                  onClick={() => {
                    setPlayerName(generateLeaderboardName());
                    setNameError(null);
                  }}
                >
                  <Dices size={16} aria-hidden="true" />
                  Roll
                </button>
              </div>
            </label>
            {nameError ? (
              <p role="alert" className="mt-2 mb-0 text-sm text-[var(--accent-red)]">
                {nameError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setNameModalOpen(false)}>
                Skip
              </button>
              <button type="submit" className={buttonClass}>
                <Trophy size={16} aria-hidden="true" />
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]';

function formatScoreDate(createdAt: number) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return '--';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(createdAt));
}

function formatGoalRushDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return '--';
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function VectorSymbol({ color, children }: { color: string; children: string }) {
  return (
    <span className="font-bold italic" style={{ color }}>
      {children}
    </span>
  );
}

/**
 * Arrow in board units. `px` is board units per CSS pixel, so the shaft, head,
 * and label keep a constant on-screen size at any board scale. The shaft stops
 * at the base of the head rather than running through it to the tip.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  label: string,
  px: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 4 * px) {
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(11 * px, length * 0.6);
  const halfWidth = 5.5 * px;
  const baseX = x1 - ux * head;
  const baseY = y1 - uy * head;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.6 * px;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  // A hair past the base so no seam shows between shaft and head.
  ctx.lineTo(baseX + ux * px, baseY + uy * px);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(baseX - uy * halfWidth, baseY + ux * halfWidth);
  ctx.lineTo(baseX + uy * halfWidth, baseY - ux * halfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.font = `italic 700 ${15 * px}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x1 + ux * 12 * px, y1 + uy * 12 * px);
  ctx.restore();
}
