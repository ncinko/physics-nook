import { Cloud, Pause, Play, RotateCcw, Timer, Trophy, WifiOff, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  GOAL_RUSH_DEFAULTS,
  selectBestGoalRushScoresByUniqueName,
  type GoalRushLeaderboardScore,
} from '../../lib/kinematics/goalRush';
import { sanitizeLeaderboardName } from '../../lib/kinematics/stopZones';

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
  running: boolean;
  gravityOn: boolean;
  goalRush: boolean;
  score: number;
  normalHits: number;
  goldenHits: number;
  timeLeft: number;
  boostLeft: number;
  ended: boolean;
  spawns: Spawn[];
  lastTime: number | null;
  elapsedMs: number;
  finalDurationMs: number | null;
  runId: string | null;
};

type Snapshot = Runtime & {
  speed: number;
};

type ApiStatus = 'checking' | 'online' | 'offline';
type GoalRushScoreEntry = GoalRushLeaderboardScore & { id?: string };

const GAME_TIME = GOAL_RUSH_DEFAULTS.gameTimeS;
const PLAYER_RADIUS = 8;
const CONTROL_ACCEL = 200;
const BOOST_ACCEL_BONUS = 100;
const MAX_SPEED = 820;
const BOOST_DURATION = 5;
const CLOCK_BONUS = 5;
const SPAWN_COUNT = 4;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

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
  running: false,
  gravityOn: false,
  goalRush: false,
  score: 0,
  normalHits: 0,
  goldenHits: 0,
  timeLeft: GAME_TIME,
  boostLeft: 0,
  ended: false,
  spawns: [],
  lastTime: null,
  elapsedMs: 0,
  finalDurationMs: null,
  runId: null,
});

const makeSnapshot = (runtime: Runtime): Snapshot => ({
  ...runtime,
  spawns: runtime.spawns.map((spawn) => ({ ...spawn })),
  speed: Math.hypot(runtime.vx, runtime.vy),
});

const makeSpawn = (width: number, height: number, id: number): Spawn => {
  const roll = Math.random();
  const margin = 58;
  const x = randomBetween(-width / 2 + margin, width / 2 - margin);
  const y = randomBetween(-height / 2 + margin, height / 2 - margin);

  if (roll < 0.14) {
    return { id, kind: 'clock', x, y, radius: 16, points: 0, golden: false };
  }

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
  const [size, setSize] = useState<Size>({ width: 860, height: 560 });
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
  const [isPosting, setIsPosting] = useState(false);

  const readouts = useMemo(
    () => [
      { label: 'position', value: `<${snapshot.x.toFixed(0)}, ${(-snapshot.y).toFixed(0)}>` },
      { label: 'velocity', value: `${snapshot.speed.toFixed(0)} px/s` },
      { label: 'acceleration', value: `${Math.hypot(snapshot.ax, snapshot.ay).toFixed(0)} px/s^2` },
      { label: 'score', value: snapshot.goalRush ? String(snapshot.score) : '--' },
    ],
    [snapshot.ax, snapshot.ay, snapshot.goalRush, snapshot.score, snapshot.speed, snapshot.x, snapshot.y],
  );

  const syncSnapshot = useCallback(() => {
    setSnapshot(makeSnapshot(runtimeRef.current));
  }, []);

  const seedSpawns = useCallback(() => {
    const runtime = runtimeRef.current;
    const nextSpawns: Spawn[] = [];
    for (let index = 0; index < SPAWN_COUNT; index += 1) {
      spawnIdRef.current += 1;
      nextSpawns.push(makeSpawn(size.width, size.height, spawnIdRef.current));
    }
    runtime.spawns = nextSpawns;
  }, [size.height, size.width]);

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

  useEffect(() => {
    setLocalScores(loadLocalScores());
    void refreshLeaderboard();
  }, [loadLocalScores, refreshLeaderboard]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return undefined;
    }

    const resize = () => {
      const width = Math.max(320, Math.floor(element.clientWidth));
      const height = Math.max(380, Math.min(620, Math.round(width * 0.66)));
      setSize({ width, height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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
        key === ' ';

      if (!usesControl) {
        return;
      }

      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }

      event.preventDefault();

      keysRef.current.left = key === 'arrowleft' || key === 'a' ? isDown : keysRef.current.left;
      keysRef.current.right = key === 'arrowright' || key === 'd' ? isDown : keysRef.current.right;
      keysRef.current.up = key === 'arrowup' || key === 'w' ? isDown : keysRef.current.up;
      keysRef.current.down = key === 'arrowdown' || key === 's' ? isDown : keysRef.current.down;

      if (key === ' ' && isDown) {
        runtimeRef.current.running = true;
        syncSnapshot();
      }
    };

    const onDown = (event: KeyboardEvent) => updateKey(event, true);
    const onUp = (event: KeyboardEvent) => updateKey(event, false);
    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp, { passive: false });

    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [syncSnapshot]);

  const toScreen = useCallback(
    (x: number, y: number) => ({
      x: size.width / 2 + x,
      y: size.height / 2 + y,
    }),
    [size.height, size.width],
  );

  const toWorld = useCallback(
    (x: number, y: number) => ({
      x: x - size.width / 2,
      y: y - size.height / 2,
    }),
    [size.height, size.width],
  );

  const finishGame = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.ended) {
      return;
    }

    runtime.ended = true;
    runtime.running = false;
    runtime.timeLeft = 0;
    runtime.finalDurationMs = Math.max(0, Math.round(runtime.elapsedMs));
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
        ay += 105;
      }

      runtime.ax = ax;
      runtime.ay = ay;
      runtime.boostLeft = Math.max(0, runtime.boostLeft - dt);

      if (runtime.running && !runtime.ended) {
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
          runtime.timeLeft = Math.max(0, runtime.timeLeft - dt);
          if (runtime.timeLeft <= 0) {
            finishGame();
          }
        }
      } else {
        const damping = Math.exp(-2.4 * dt);
        runtime.vx *= damping;
        runtime.vy *= damping;
        runtime.x += runtime.vx * dt;
        runtime.y += runtime.vy * dt;
      }

      const halfW = size.width / 2 - PLAYER_RADIUS - 8;
      const halfH = size.height / 2 - PLAYER_RADIUS - 8;
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

      if (runtime.goalRush && runtime.running && !runtime.ended) {
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
          runtime.spawns[index] = makeSpawn(size.width, size.height, spawnIdRef.current);
        });
      }
    },
    [finishGame, size.height, size.width],
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

    const bg = getCssColor('--sim-bg', '#f8fafc');
    const grid = getCssColor('--grid-line', '#d1d5db');
    const text = getCssColor('--text-primary', '#111827');
    const muted = getCssColor('--text-muted', '#4b5563');
    const blue = getCssColor('--accent-blue', '#3b82f6');
    const red = getCssColor('--accent-red', '#ef4444');
    const green = '#16a34a';
    const amber = '#d97706';
    const violet = '#7c3aed';

    const runtime = runtimeRef.current;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = size.width / 2; x <= size.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }
    for (let x = size.width / 2 - 50; x >= 0; x -= 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }
    for (let y = size.height / 2; y <= size.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
    }
    for (let y = size.height / 2 - 50; y >= 0; y -= 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, size.height / 2);
    ctx.lineTo(size.width, size.height / 2);
    ctx.moveTo(size.width / 2, 0);
    ctx.lineTo(size.width / 2, size.height);
    ctx.stroke();

    if (runtime.goalRush) {
      runtime.spawns.forEach((spawn) => {
        const point = toScreen(spawn.x, spawn.y);
        if (spawn.kind === 'goal') {
          ctx.strokeStyle = spawn.golden ? amber : green;
          ctx.lineWidth = spawn.golden ? 4 : 3;
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = spawn.golden ? 'rgba(217,119,6,0.28)' : 'rgba(22,163,74,0.22)';
          ctx.beginPath();
          ctx.arc(point.x, point.y, spawn.radius * 0.42, 0, Math.PI * 2);
          ctx.fill();
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
          ctx.strokeStyle = violet;
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

    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    drawArrow(ctx, player.x, player.y, player.x + runtime.vx * 0.18, player.y + runtime.vy * 0.18, blue, 'v');
    drawArrow(ctx, player.x, player.y, player.x + runtime.ax * 0.24, player.y + runtime.ay * 0.24, amber, 'a');

    ctx.fillStyle = text;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (runtime.goalRush) {
      ctx.fillText(`time ${runtime.timeLeft.toFixed(1)} s`, 14, 12);
      ctx.fillText(`score ${runtime.score}`, 14, 32);
    } else {
      ctx.fillText('sandbox', 14, 12);
    }

    ctx.strokeStyle = muted;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size.width - 2, size.height - 2);
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

  const setRunning = (running: boolean) => {
    const runtime = runtimeRef.current;
    if (runtime.ended && running) {
      reset(true);
      runtimeRef.current.running = true;
    } else {
      runtime.running = running;
    }
    syncSnapshot();
  };

  const setGoalRush = (goalRush: boolean) => {
    const runtime = runtimeRef.current;
    runtime.goalRush = goalRush;
    runtime.running = false;
    runtime.ended = false;
    runtime.timeLeft = GAME_TIME;
    runtime.score = 0;
    runtime.normalHits = 0;
    runtime.goldenHits = 0;
    runtime.boostLeft = 0;
    runtime.elapsedMs = 0;
    runtime.finalDurationMs = null;
    runtime.runId = null;
    runtime.spawns = [];
    submittedRef.current = false;
    setNameModalOpen(false);
    if (goalRush) {
      seedSpawns();
      void createServerRun();
    }
    syncSnapshot();
  };

  const setGravity = (gravityOn: boolean) => {
    runtimeRef.current.gravityOn = gravityOn;
    syncSnapshot();
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
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
  const bestScore = leaderboardScores[0]?.score ?? 0;

  const handleScoreSubmit = async () => {
    const runtime = runtimeRef.current;
    if (runtime.finalDurationMs === null || submittedRef.current) {
      setNameModalOpen(false);
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
    <div ref={wrapperRef} className="flex h-full min-h-[48rem] flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]">
      <div className="grid gap-3 md:grid-cols-4">
        {readouts.map((readout) => (
          <Readout key={readout.label} label={readout.label} value={readout.value} />
        ))}
      </div>

      <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div ref={stageRef} className="min-w-0">
            <canvas
              ref={canvasRef}
              className="block max-w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
              style={{ touchAction: 'none' }}
              aria-label="Two-dimensional acceleration sandbox with velocity and acceleration vectors"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)]">
            <div className="flex flex-wrap gap-2 border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
              <button type="button" title={snapshot.running ? 'Pause' : 'Start'} onClick={() => setRunning(!snapshot.running)} className={buttonClass}>
                {snapshot.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {snapshot.running ? 'Pause' : 'Start'}
              </button>
              <button type="button" title="Reset" onClick={() => reset(true)} className={buttonClass}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <Toggle checked={snapshot.goalRush} onChange={setGoalRush} label="Goal Rush" />
              <Toggle checked={snapshot.gravityOn} onChange={setGravity} label="Gravity" />
            </div>

            <div className="grid gap-2 border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                  <Timer className="h-4 w-4 text-[var(--accent-blue)]" />
                  Time
                </span>
                <strong>{snapshot.goalRush ? `${snapshot.timeLeft.toFixed(1)} s` : 'sandbox'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                  <Trophy className="h-4 w-4 text-[#d97706]" />
                  Best
                </span>
                <strong>{bestScore}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                  <Zap className="h-4 w-4 text-[var(--accent-red)]" />
                  Boost
                </span>
                <strong>{snapshot.boostLeft > 0 ? `${snapshot.boostLeft.toFixed(1)} s` : '--'}</strong>
              </div>
            </div>
          </div>

          {snapshot.goalRush && snapshot.ended && (
            <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 text-center shadow-sm">
              <p className="m-0 text-lg font-semibold">Final score: {snapshot.score}</p>
              <p className="mt-1 mb-0 text-sm text-[var(--text-muted)]">
                Normal zones: {snapshot.normalHits}. Golden zones: {snapshot.goldenHits}.
              </p>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="m-0 text-base font-semibold">{leaderboardLabel}</h3>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)]">
                {apiStatus === 'online' ? <Cloud size={15} /> : <WifiOff size={15} />}
                {apiStatus}
              </span>
            </div>
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
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{score.name}</span>
                        <span className="block truncate text-xs text-[var(--text-muted)]">
                          {score.normalHits} normal, {score.goldenHits} golden
                        </span>
                      </span>
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
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                maxLength={24}
                placeholder="Initials or display name"
                className="mt-2 w-full rounded-md border border-[var(--grid-line)] bg-[var(--sim-bg)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                autoFocus
              />
            </label>
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

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="accent-[var(--accent-blue)]"
      />
      {label}
    </label>
  );
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  label: string,
) {
  if (Math.hypot(x1 - x0, y1 - y0) < 2) {
    return;
  }

  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText(label, x1 + 8, y1 + 4);
  ctx.restore();
}
