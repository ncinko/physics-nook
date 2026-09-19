import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CANNON_ALTITUDE_M,
  EARTH_RADIUS_M,
  LAUNCH_RADIUS_M,
  cannonOrbit,
  circularSpeed,
  escapeSpeed,
  launchState,
  niceLength,
  orbitPeriod,
  orbitPointAt,
  stepVerlet,
  type BallState,
  type CannonOrbitKind,
} from '../../lib/astronomy/cannonball';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { getCssColor, onThemeChange } from '../shared/themeColors';

// Newton's mountain as a zoomable canvas. Gravity points at Earth's centre and
// weakens as 1/r^2; nothing else. The ball draws its path as it flies. The
// first time it nears the edge, the view zooms out once, to a scale that fits
// the whole trajectory.

const R = EARTH_RADIUS_M;
const R0 = LAUNCH_RADIUS_M;
const V_CIRCULAR = circularSpeed(R0) / 1000;
const V_ESCAPE = escapeSpeed(R0) / 1000;

const SPEED_MIN = 0.1;
const SPEED_MAX = 12;
const SPEED_STEP = 0.05;
const SPEED_DEFAULT = 1;
/** Slider values this close to a threshold snap onto it, so both are reachable. */
const SNAP_KMS = 0.06;

/** Width of the view, in metres, across the zoom slider (log scale). */
const SPAN_MIN = 10e3;
const SPAN_MAX = 300e6;
const SPAN_DEFAULT = 100e3;
const ZOOM_MAX = 100;
const spanForZoom = (zoom: number) => SPAN_MIN * (SPAN_MAX / SPAN_MIN) ** (zoom / ZOOM_MAX);
const zoomForSpan = (span: number) => (ZOOM_MAX * Math.log(span / SPAN_MIN)) / Math.log(SPAN_MAX / SPAN_MIN);

/** An escaping ball this far from Earth's centre counts as gone; still in the widest view. */
const ESCAPE_RADIUS = 0.3 * SPAN_MAX;

/** Keep the ball this far (as a fraction of the canvas) inside the edges. */
const EDGE_MARGIN = 0.08;
/** How long the one-time zoom-out takes; the ball waits while it runs. */
const ZOOM_TRANSITION_SECONDS = 0.9;
/** Points sampled along the predicted path when fitting the view to it. */
const FIT_SAMPLES = 480;

const ARROW_LENGTH_PX = 28;
/** A launched ball crosses the view in about this many seconds. */
const CROSSING_SECONDS = 5;
/** Below this speed, pace the animation by the fall rather than the sideways speed. */
const PACE_MIN_SPEED = 400;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (t: number) => t * t * (3 - 2 * t);

const snapSpeed = (value: number) => {
  for (const threshold of [V_CIRCULAR, V_ESCAPE]) {
    if (Math.abs(value - threshold) <= SNAP_KMS) return threshold;
  }
  return value;
};

const formatDistance = (metres: number) => {
  const km = metres / 1000;
  if (km >= 100 || Number.isInteger(km)) return `${Math.round(km).toLocaleString('en-US')} km`;
  if (km >= 10) return `${km.toFixed(1)} km`;
  return `${km.toFixed(2)} km`;
};

interface Viewport {
  width: number;
  height: number;
  scale: number; // px per metre
  cx: number;
  cy: number;
  /** 0 fully zoomed in (local framing), 1 zoomed out (planet framing). */
  blend: number;
}

/**
 * Zoomed in, the cannon sits near the left with the ground low in the frame.
 * Zoomed out, it sits centred near the top, like Newton's plate, leaving room
 * below for the orbits, which always swing out on the far side of Earth. The
 * blend runs between roughly a tenth of an Earth radius and two radii across.
 */
const makeViewport = (span: number, width: number, height: number): Viewport => {
  const aspect = height / width;
  const lo = Math.log(0.12 * R);
  const hi = Math.log(2.2 * R);
  const w = smoothstep(clamp((Math.log(span) - lo) / (hi - lo), 0, 1));
  const localX = 0.4 * span;
  const localY = R + 0.35 * span * aspect;
  const farY = R0 - 0.36 * span * aspect;
  return { width, height, scale: width / span, cx: localX * (1 - w), cy: localY * (1 - w) + farY * w, blend: w };
};

const toScreen = (view: Viewport, x: number, y: number) => ({
  x: view.width / 2 + (x - view.cx) * view.scale,
  y: view.height / 2 - (y - view.cy) * view.scale,
});

type Point = { x: number; y: number };

const insideMargin = (view: Viewport, x: number, y: number) => {
  const p = toScreen(view, x, y);
  return (
    p.x > view.width * EDGE_MARGIN &&
    p.x < view.width * (1 - EDGE_MARGIN) &&
    p.y > view.height * EDGE_MARGIN &&
    p.y < view.height * (1 - EDGE_MARGIN)
  );
};

/** The whole path the ball will take, from the exact conic, in world coordinates. */
const predictedPath = (v: number): Point[] => {
  const orbit = cannonOrbit(v);
  const end =
    orbit.impactAngle ?? (orbit.asymptoteAngle !== null ? orbit.asymptoteAngle - 1e-6 : 2 * Math.PI);
  const points: Point[] = [];
  for (let i = 0; i <= FIT_SAMPLES; i += 1) {
    const p = orbitPointAt(orbit, (end * i) / FIT_SAMPLES);
    if (!Number.isFinite(p.x) || Math.hypot(p.x, p.y) > ESCAPE_RADIUS) break;
    points.push(p);
  }
  return points;
};

/** The narrowest view, at least `from` wide, that keeps every point inside the margin. */
const spanToFit = (points: Point[], from: number, width: number, height: number) => {
  for (let span = from; span < SPAN_MAX; span *= 1.02) {
    const view = makeViewport(span, width, height);
    if (points.every((p) => insideMargin(view, p.x, p.y))) return span;
  }
  return SPAN_MAX;
};

const drawArrow = (ctx: CanvasRenderingContext2D, from: Point, dx: number, dy: number, color: string) => {
  const length = Math.hypot(dx, dy);
  if (length < 3) return;
  const ux = dx / length;
  const uy = dy / length;
  const tip = { x: from.x + dx, y: from.y + dy };
  const head = Math.min(8, length * 0.45);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(tip.x - ux * head * 0.6, tip.y - uy * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - ux * head - uy * head * 0.5, tip.y - uy * head + ux * head * 0.5);
  ctx.lineTo(tip.x - ux * head + uy * head * 0.5, tip.y - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
};

type FlightStatus = 'flying' | 'landed' | 'lapped' | 'escaped';

interface Flight {
  v: number;
  kind: CannonOrbitKind;
  period: number;
  ball: BallState;
  /** World-space points the ball has passed through. */
  trail: Point[];
  time: number;
  status: FlightStatus;
  /** The one-time zoom-out in progress, as log-interpolated view widths. */
  zoomTransition: { from: number; to: number; t: number } | null;
}

const newFlight = (v: number): Flight => {
  const orbit = cannonOrbit(v);
  return {
    v,
    kind: orbit.kind,
    period: orbitPeriod(orbit),
    ball: launchState(v),
    trail: [{ x: 0, y: R0 }],
    time: 0,
    status: 'flying',
    zoomTransition: null,
  };
};

/** Angle travelled around Earth, clockwise from the mountain, in [0, 2pi). */
const angleAround = (x: number, y: number) => {
  const phi = Math.atan2(x, y);
  return phi < 0 ? phi + 2 * Math.PI : phi;
};

const describeFlight = (flight: Flight | null) => {
  if (!flight) return 'Set a launch speed and press Launch.';
  switch (flight.status) {
    case 'flying':
      return 'In flight…';
    case 'landed':
      return `Landed ${formatDistance(angleAround(flight.ball.x, flight.ball.y) * R)} from the mountain, measured along the ground.`;
    case 'lapped':
      return flight.kind === 'circular'
        ? 'Back at the mountain: a circular orbit. The ground curves away exactly as fast as the ball falls.'
        : 'Back at the mountain: an elliptical orbit. The ball never lands; it just keeps missing the Earth.';
    case 'escaped':
      return 'Escaped: the ball is fast enough that it never comes back.';
  }
};

export default function NewtonsCannonball() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 640, height: 400 });
  const [speed, setSpeed] = useState(SPEED_DEFAULT);
  const [zoom, setZoom] = useState(() => zoomForSpan(SPAN_DEFAULT));
  const [themeTick, setThemeTick] = useState(0);
  const [status, setStatus] = useState<FlightStatus | null>(null);
  const flightRef = useRef<Flight | null>(null);
  // The animation loop reads and auto-zooms the span directly; the slider mirrors it.
  const spanRef = useRef(spanForZoom(zoom));
  spanRef.current = spanForZoom(zoom);

  useEffect(() => onThemeChange(() => setThemeTick((tick) => tick + 1)), []);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const resize = () => {
      const width = Math.max(280, Math.floor(element.clientWidth));
      const height = clamp(Math.round(width * 0.62), 260, 480);
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new speed clears the flight and its trace.
  useEffect(() => {
    flightRef.current = null;
    setStatus(null);
  }, [speed]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = size;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = {
      bg: getCssColor('--surface-plot', '#ffffff'),
      text: getCssColor('--text-primary', '#111827'),
      muted: getCssColor('--text-muted', '#6b7280'),
      earth: getCssColor('--accent-green', '#22c55e'),
      path: getCssColor('--accent-blue', '#2563eb'),
      gravity: getCssColor('--accent-purple', '#7e57c2'),
    };
    const font = getComputedStyle(document.body).fontFamily;
    const span = spanRef.current;
    const view = makeViewport(span, width, height);
    const s = view.scale;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    // Earth.
    const centre = toScreen(view, 0, 0);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, R * s, 0, Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colors.earth;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (centre.x > -20 && centre.x < width + 20 && centre.y > -20 && centre.y < height + 20) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centre.x - 5, centre.y);
      ctx.lineTo(centre.x + 5, centre.y);
      ctx.moveTo(centre.x, centre.y - 5);
      ctx.lineTo(centre.x, centre.y + 5);
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.font = `12px ${font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText("Earth's center", centre.x + 7, centre.y + 4);
    }

    // The mountain and cannon at true scale: they shrink away as the view widens.
    const peak = toScreen(view, 0, R0);
    const mountainPx = CANNON_ALTITUDE_M * s;
    if (mountainPx > 0.5) {
      ctx.fillStyle = colors.muted;
      ctx.beginPath();
      ctx.moveTo(peak.x - mountainPx * 1.7, peak.y + mountainPx);
      ctx.lineTo(peak.x, peak.y);
      ctx.lineTo(peak.x + mountainPx * 1.7, peak.y + mountainPx);
      ctx.closePath();
      ctx.fill();
      const barrel = Math.min(12, mountainPx);
      ctx.fillStyle = colors.text;
      ctx.fillRect(peak.x - barrel * 0.25, peak.y - barrel * 0.4, barrel, barrel * 0.33);
    }

    // The path so far.
    const flight = flightRef.current;
    if (flight && flight.trail.length > 1) {
      ctx.strokeStyle = colors.path;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = toScreen(view, flight.trail[0].x, flight.trail[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < flight.trail.length; i += 1) {
        const p = toScreen(view, flight.trail[i].x, flight.trail[i].y);
        ctx.lineTo(p.x, p.y);
      }
      const b = toScreen(view, flight.ball.x, flight.ball.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // The ball, with gravity's pull: toward the centre, weaker with distance.
    const ball = flight?.ball ?? launchState(0);
    const b = toScreen(view, ball.x, ball.y);
    const r = Math.hypot(ball.x, ball.y);
    const arrow = ARROW_LENGTH_PX * (R0 / r) ** 2;
    drawArrow(ctx, b, (-ball.x / r) * arrow, (ball.y / r) * arrow, colors.gravity);
    ctx.fillStyle = colors.path;
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Scale bar in open sky: above the ground zoomed in, below the planet zoomed out.
    const barMetres = niceLength(span * 0.18);
    const barPx = barMetres * s;
    const barY = view.blend < 0.5 ? 34 : height - 16;
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, barY - 4);
    ctx.lineTo(14, barY);
    ctx.lineTo(14 + barPx, barY);
    ctx.lineTo(14 + barPx, barY - 4);
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.font = `12px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatDistance(barMetres), 14, barY - 6);
    // themeTick and zoom are read so a theme change or zoom repaints.
  }, [size, themeTick, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  /**
   * Advance the flight by `realDt` seconds of wall time: step the physics and
   * extend the trace. If the ball nears the edge, pause it and zoom out, once,
   * to a view that fits the whole trajectory. Returns true once it is over.
   */
  const advance = (flight: Flight, realDt: number) => {
    const { width, height } = size;

    const transition = flight.zoomTransition;
    if (transition) {
      transition.t = Math.min(1, transition.t + realDt / ZOOM_TRANSITION_SECONDS);
      const eased = smoothstep(transition.t);
      const span = transition.from * (transition.to / transition.from) ** eased;
      spanRef.current = span;
      setZoom(zoomForSpan(span));
      if (transition.t >= 1) flight.zoomTransition = null;
      return false;
    }

    const pace = Math.max(flight.v, PACE_MIN_SPEED);
    const span = spanRef.current;
    let remaining = realDt * (span / (pace * CROSSING_SECONDS));
    const maxStep = Math.min(2, span / (pace * 200));
    let steps = 0;

    while (remaining > 0 && flight.status === 'flying' && steps < 4000) {
      const dt = Math.min(maxStep, remaining);
      const next = stepVerlet(flight.ball, dt);
      const r = Math.hypot(next.x, next.y);
      flight.time += dt;
      remaining -= dt;
      steps += 1;

      if (r <= R) {
        flight.ball = { ...next, x: (next.x / r) * R, y: (next.y / r) * R };
        flight.status = 'landed';
      } else if (flight.time >= flight.period) {
        flight.ball = launchState(flight.v);
        flight.status = 'lapped';
      } else {
        flight.ball = next;
        if (flight.kind === 'escape' && r > ESCAPE_RADIUS) flight.status = 'escaped';
      }

      const last = flight.trail[flight.trail.length - 1];
      if (flight.status !== 'flying' || Math.hypot(flight.ball.x - last.x, flight.ball.y - last.y) > span / 1500) {
        flight.trail.push({ x: flight.ball.x, y: flight.ball.y });
      }
    }

    // Nearing the edge: zoom out to fit the rest of the flight in one move.
    if (
      flight.status === 'flying' &&
      span < SPAN_MAX &&
      !insideMargin(makeViewport(span, width, height), flight.ball.x, flight.ball.y)
    ) {
      const target = spanToFit(predictedPath(flight.v), span, width, height);
      if (target > span) flight.zoomTransition = { from: span, to: target, t: 0 };
    }

    return flight.status !== 'flying';
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (status !== 'flying') return;
    let raf = 0;
    let last: number | null = null;
    const tick = (timestamp: number) => {
      const flight = flightRef.current;
      if (!flight) return;
      const realDt = last === null ? 0 : Math.min(0.05, (timestamp - last) / 1000);
      last = timestamp;
      const done = advanceRef.current(flight, realDt);
      drawRef.current();
      if (done) {
        setStatus(flight.status);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const launch = () => {
    flightRef.current = newFlight(speed * 1000);
    // Restart the loop even when a flight is already running.
    setStatus(null);
    requestAnimationFrame(() => setStatus('flying'));
  };

  const description = describeFlight(status ? flightRef.current : null);

  return (
    <figure className="not-prose mx-auto my-8 flex w-full max-w-3xl flex-col gap-3 text-[var(--text-primary)]">
      <div ref={wrapperRef} className="w-full">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Newton's cannonball fired horizontally from a mountain at ${speed.toFixed(2)} km/s. ${description}`}
          className="block max-w-full rounded-[var(--radius-panel)] border border-[var(--grid-line)] bg-[var(--surface-plot)]"
        />
      </div>

      <figcaption className="flex flex-col items-center gap-2 text-center">
        <p className="type-supporting m-0 max-w-2xl text-[var(--text-primary)]" aria-live="polite">
          {description}
        </p>
      </figcaption>

      <ControlBar>
        <Slider
          label="Speed"
          unit="km/s"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={speed}
          onChange={(value) => setSpeed(snapSpeed(value))}
          format={(value) => value.toFixed(2)}
          ticks={[V_CIRCULAR, V_ESCAPE]}
          ariaLabel="Launch speed in kilometres per second"
        />
        <Slider
          label="Zoom"
          min={0}
          max={ZOOM_MAX}
          step={0.1}
          value={zoom}
          onChange={setZoom}
          format={() => `${formatDistance(spanForZoom(zoom))} wide`}
          ariaLabel="View width"
        />
        <Button type="button" onClick={launch}>
          {status ? 'Relaunch' : 'Launch'}
        </Button>
      </ControlBar>
    </figure>
  );
}
