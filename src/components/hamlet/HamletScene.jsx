import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatPacificClock,
  getHamletTime,
} from '../../lib/hamlet/hamletTime';
import {
  CARE_ACTIONS,
  deriveHamletMood,
  emptyCareSummary,
  formatRelativeTime,
} from '../../lib/hamlet/hamletCare';

// Presentation metadata for each global care action.
const CARE_META = {
  feed: { label: 'Feed', emoji: '🌻', verb: 'fed', lastKey: 'lastFedAt' },
  water: { label: 'Water', emoji: '💧', verb: 'watered', lastKey: 'lastWateredAt' },
  pet: { label: 'Pet', emoji: '🤚', verb: 'petted', lastKey: 'lastPettedAt' },
};

const MOOD_EMOJI = { hungry: '🍽️', thirsty: '🥤', happy: '💛', content: '🐹' };

// Hamlet's run cycle is a 10-frame pixel sprite strip (public/sprites/hamlet-run.png),
// sliced from the uploaded gallop sheet. We show one frame through a clip window and step
// across the strip from JS (see HamletSky) so the motion renders in the preview too.
// fw/fh are the per-frame size in viewBox units (cell aspect ≈ 1.79 — the frame-4 full
// stretch sets the width); x/y centre the clip window at the wheel's base.
const SPRITE = { frames: 10, fw: 61, fh: 34, x: 183.5, y: 125 };

const WHEEL = { cx: 214, cy: 116, r: 52 };
const HORIZON = 162;

function HamletSky({ time }) {
  // Arc the sun (day) or moon (night) across the sky from the current phase
  // progress: 0 at the horizon edge, peaking at the top mid-phase.
  const t = time.phaseProgress;
  const bodyX = 34 + t * 252;
  const bodyY = HORIZON - Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI) * 120;

  // Drive the run cycle + wheel from setInterval rather than CSS animation:
  // the embedded preview freezes CSS/rAF timelines, but setInterval still fires,
  // so the motion renders there as well as in normal browsers. ~110ms/frame is a
  // classic pixel run-cycle cadence (~9 fps).
  const running = time.phase === 'day';
  const [frame, setFrame] = useState(0);
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (!running) {
      setFrame(0);
      return undefined;
    }
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPRITE.frames);
      setAngle((a) => (a + 22) % 360);
    }, 110);
    return () => clearInterval(id);
  }, [running]);

  return (
    <svg
      className="hamlet-svg"
      viewBox="0 0 320 200"
      role="img"
      aria-label={
        time.phase === 'day'
          ? 'Hamlet running on his wheel in daylight'
          : 'Hamlet dozing in his wheel at night'
      }
    >
      <defs>
        <linearGradient id="hamlet-day" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fd3ff" />
          <stop offset="100%" stopColor="#e7f6ff" />
        </linearGradient>
        <linearGradient id="hamlet-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1130" />
          <stop offset="100%" stopColor="#222c52" />
        </linearGradient>
        <clipPath id="hamlet-run-clip">
          <rect x={SPRITE.x} y={SPRITE.y} width={SPRITE.fw} height={SPRITE.fh} />
        </clipPath>
      </defs>

      {/* Sky */}
      <rect className="hamlet-day-only" x="0" y="0" width="320" height={HORIZON} fill="url(#hamlet-day)" />
      <rect className="hamlet-night-only" x="0" y="0" width="320" height={HORIZON} fill="url(#hamlet-night)" />

      {/* Stars (night) */}
      <g className="hamlet-night-only hamlet-stars">
        {[
          [30, 28], [70, 50], [120, 22], [180, 44], [150, 70],
          [250, 30], [290, 60], [220, 18], [95, 78], [265, 90],
        ].map(([x, y], i) => (
          <rect
            key={`star-${i}`}
            x={x}
            y={y}
            width="2"
            height="2"
            fill="#fdf6d8"
            style={{ animationDelay: `${(i % 5) * 0.4}s` }}
          />
        ))}
      </g>

      {/* Sun / Moon */}
      <circle className="hamlet-day-only" cx={bodyX} cy={bodyY} r="16" fill="#ffd84d" />
      <g className="hamlet-night-only">
        <circle cx={bodyX} cy={bodyY} r="13" fill="#f4f1d0" />
        <circle cx={bodyX + 5} cy={bodyY - 4} r="11" fill="url(#hamlet-night)" opacity="0.9" />
      </g>

      {/* Ground / bedding */}
      <rect className="hamlet-day-only" x="0" y={HORIZON} width="320" height={200 - HORIZON} fill="#8fbf6a" />
      <rect className="hamlet-night-only" x="0" y={HORIZON} width="320" height={200 - HORIZON} fill="#3a2f4a" />

      {/* Wheel stand */}
      <rect x="150" y={HORIZON - 2} width="6" height={WHEEL.cy + WHEEL.r - HORIZON} fill="#9a7b53" />
      <rect x="274" y={HORIZON - 2} width="6" height={WHEEL.cy + WHEEL.r - HORIZON} fill="#9a7b53" />
      <rect x="148" y={HORIZON - 2} width="134" height="4" fill="#7d6240" />

      {/* Wheel rotor: rotated from JS so it spins by day, still by night.
          Counter-clockwise, so the track runs backward under a right-facing runner. */}
      <g className="hamlet-wheel-rotor" transform={`rotate(${-angle} ${WHEEL.cx} ${WHEEL.cy})`}>
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r} fill="none" stroke="#caa06e" strokeWidth="5" />
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r - 9} fill="none" stroke="#e3c391" strokeWidth="2" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <line
              key={`spoke-${i}`}
              x1={WHEEL.cx + Math.cos(a) * 8}
              y1={WHEEL.cy + Math.sin(a) * 8}
              x2={WHEEL.cx + Math.cos(a) * (WHEEL.r - 6)}
              y2={WHEEL.cy + Math.sin(a) * (WHEEL.r - 6)}
              stroke="#b98e5e"
              strokeWidth="2"
            />
          );
        })}
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r="4" fill="#9a7b53" />
      </g>

      {/* Hamlet himself: a 6-frame pixel run cycle. The clip window shows one
          frame; the image steps across the strip (see .hamlet-run-sprite CSS). */}
      <g clipPath="url(#hamlet-run-clip)">
        <image
          className="hamlet-run-sprite"
          href="/sprites/hamlet-run.png"
          x={SPRITE.x - frame * SPRITE.fw}
          y={SPRITE.y}
          width={SPRITE.fw * SPRITE.frames}
          height={SPRITE.fh}
          preserveAspectRatio="none"
          style={{ imageRendering: 'pixelated' }}
        />
      </g>

      {/* Zzz while he dozes in the wheel at night */}
      <g className="hamlet-night-only hamlet-zzz">
        <text x={WHEEL.cx + 26} y={WHEEL.cy - 44} className="hamlet-z hamlet-z1">z</text>
        <text x={WHEEL.cx + 34} y={WHEEL.cy - 52} className="hamlet-z hamlet-z2">z</text>
        <text x={WHEEL.cx + 43} y={WHEEL.cy - 60} className="hamlet-z hamlet-z3">Z</text>
      </g>
    </svg>
  );
}

export default function HamletScene() {
  const [now, setNow] = useState(() => Date.now());
  const [summary, setSummary] = useState(() => emptyCareSummary());
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'offline'
  const [pendingAction, setPendingAction] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const time = useMemo(() => getHamletTime(new Date(now)), [now]);
  const mood = useMemo(() => deriveHamletMood(summary, now), [summary, now]);

  // A slow heartbeat keeps the Pacific clock, phase, and "x ago" labels fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const flashNotice = useCallback((message) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch('/api/hamlet/state', { headers: { accept: 'application/json' } });
      if (!response.ok) {
        setStatus('offline');
        return;
      }
      const data = await response.json();
      if (!data?.ok) {
        setStatus('offline');
        return;
      }
      setSummary({
        lastFedAt: data.lastFedAt ?? null,
        lastWateredAt: data.lastWateredAt ?? null,
        lastPettedAt: data.lastPettedAt ?? null,
        counts: {
          feed: data.counts?.feed ?? 0,
          water: data.counts?.water ?? 0,
          pet: data.counts?.pet ?? 0,
        },
        total: data.total ?? 0,
      });
      setStatus('ready');
    } catch {
      setStatus('offline');
    }
  }, []);

  // Fetch the shared state on mount, then poll so visitors see fresh care.
  useEffect(() => {
    loadState();
    const id = setInterval(loadState, 45000);
    return () => clearInterval(id);
  }, [loadState]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const care = useCallback(
    async (action) => {
      if (status === 'offline' || pendingAction) return;
      setPendingAction(action);
      try {
        const response = await fetch('/api/hamlet/care', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (response.status === 429) {
          flashNotice('Hamlet needs a breather — try again in a bit.');
          return;
        }
        if (!response.ok) {
          setStatus('offline');
          return;
        }
        const data = await response.json();
        if (!data?.ok) {
          setStatus('offline');
          return;
        }
        setSummary({
          lastFedAt: data.lastFedAt ?? null,
          lastWateredAt: data.lastWateredAt ?? null,
          lastPettedAt: data.lastPettedAt ?? null,
          counts: {
            feed: data.counts?.feed ?? 0,
            water: data.counts?.water ?? 0,
            pet: data.counts?.pet ?? 0,
          },
          total: data.total ?? 0,
        });
        setStatus('ready');
        flashNotice(`You ${CARE_META[action].verb} Hamlet. 💛`);
      } catch {
        setStatus('offline');
      } finally {
        setPendingAction(null);
      }
    },
    [status, pendingAction, flashNotice],
  );

  const phaseLabel =
    time.phase === 'day'
      ? '☀️ Daytime in California — Hamlet is running his wheel.'
      : '🌙 Nighttime in California — Hamlet is dozing in his wheel.';

  return (
    <div className="hamlet-scene" data-phase={time.phase}>
      <style>{HAMLET_STYLES}</style>

      <header className="hamlet-head">
        <h1 className="hamlet-title">Hamlet&rsquo;s Wheel</h1>
        <p className="hamlet-sub">
          A communal pixel hamster powering the corner of the internet. He lives on Pacific time:{' '}
          <strong>{formatPacificClock(time.clock)} PT</strong>.
        </p>
      </header>

      <div className="hamlet-stage" data-phase={time.phase}>
        <HamletSky time={time} />
        <p className="hamlet-phase">{phaseLabel}</p>
      </div>

      <div className="hamlet-panel">
        <div className="hamlet-mood">
          <span className="hamlet-mood-emoji" aria-hidden="true">{MOOD_EMOJI[mood.mood]}</span>
          <span>{mood.label}</span>
        </div>

        <div className="hamlet-actions" role="group" aria-label="Care for Hamlet">
          {CARE_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              className="hamlet-btn"
              onClick={() => care(action)}
              disabled={status === 'offline' || pendingAction !== null}
              aria-busy={pendingAction === action}
            >
              <span aria-hidden="true">{CARE_META[action].emoji}</span>
              {CARE_META[action].label}
            </button>
          ))}
        </div>

        {notice && <p className="hamlet-notice" role="status">{notice}</p>}

        <dl className="hamlet-readout">
          {CARE_ACTIONS.map((action) => {
            const meta = CARE_META[action];
            const lastAt = summary[meta.lastKey];
            const count = summary.counts[action];
            return (
              <div key={action} className="hamlet-readout-row">
                <dt>
                  <span aria-hidden="true">{meta.emoji}</span> Last {meta.verb}
                </dt>
                <dd>
                  {status === 'loading' ? (
                    <span className="hamlet-muted">checking…</span>
                  ) : (
                    <>
                      {formatRelativeTime(lastAt ?? null, now)}
                      {status === 'ready' && (
                        <span className="hamlet-count"> · {count.toLocaleString()}×</span>
                      )}
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {status === 'offline' && (
          <p className="hamlet-offline">
            Global care tracking is offline in this environment, so the buttons are resting.
            Hamlet still keeps his schedule. Care goes live on the deployed site.
          </p>
        )}
      </div>
    </div>
  );
}

const HAMLET_STYLES = `
.hamlet-scene {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1rem 3rem;
  color: var(--text-primary);
}
.hamlet-head { text-align: center; margin-bottom: 1.25rem; }
.hamlet-title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.hamlet-sub { margin: 0.5rem 0 0; color: var(--text-muted); font-size: 0.95rem; }
.hamlet-stage {
  position: relative;
  border: 1px solid var(--grid-line);
  border-radius: 0.9rem;
  overflow: hidden;
  box-shadow: 0 1px 10px color-mix(in srgb, var(--text-primary) 8%, transparent);
}
.hamlet-svg { display: block; width: 100%; height: auto; }
.hamlet-phase {
  margin: 0;
  padding: 0.55rem 0.75rem;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
  border-top: 1px solid var(--grid-line);
  background: var(--surface-elevated);
}
.hamlet-scene[data-phase="day"] .hamlet-night-only { display: none; }
.hamlet-scene[data-phase="night"] .hamlet-day-only { display: none; }
.hamlet-scene[data-phase="day"] .hamlet-zzz { display: none; }

/* The run cycle and wheel are stepped from JS (see HamletSky), so they animate
   even in the embedded preview, which freezes CSS/rAF timelines. */
.hamlet-run-sprite { image-rendering: pixelated; }
.hamlet-scene[data-phase="night"] .hamlet-run-sprite { opacity: 0.88; }

.hamlet-stars rect { animation: hamlet-twinkle 2.4s ease-in-out infinite; }
@keyframes hamlet-twinkle { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

.hamlet-z {
  fill: #cdd6ff;
  font: 700 9px ui-monospace, monospace;
  opacity: 0;
}
.hamlet-scene[data-phase="night"] .hamlet-z1 { animation: hamlet-float 2.7s ease-in-out infinite; }
.hamlet-scene[data-phase="night"] .hamlet-z2 { animation: hamlet-float 2.7s ease-in-out 0.5s infinite; }
.hamlet-scene[data-phase="night"] .hamlet-z3 { animation: hamlet-float 2.7s ease-in-out 1s infinite; }
@keyframes hamlet-float {
  0% { opacity: 0; transform: translateY(2px); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-7px); }
}

.hamlet-panel {
  margin-top: 1.25rem;
  border: 1px solid var(--grid-line);
  border-radius: 0.9rem;
  background: var(--sim-bg);
  padding: 1.1rem 1.25rem 1.25rem;
}
.hamlet-mood {
  display: flex; align-items: center; gap: 0.55rem;
  font-size: 1.05rem; font-weight: 600; margin-bottom: 0.9rem;
}
.hamlet-mood-emoji { font-size: 1.4rem; }
.hamlet-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.hamlet-btn {
  flex: 1 1 7rem;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
  padding: 0.6rem 0.9rem;
  font-size: 0.95rem; font-weight: 600;
  color: #fff;
  background: var(--accent-blue);
  border: none; border-radius: 0.6rem;
  cursor: pointer;
  transition: transform 0.08s ease, opacity 0.15s ease, filter 0.15s ease;
}
.hamlet-btn span { font-size: 1.15rem; }
.hamlet-btn:hover:not(:disabled) { filter: brightness(1.06); }
.hamlet-btn:active:not(:disabled) { transform: translateY(1px); }
.hamlet-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hamlet-notice {
  margin: 0.85rem 0 0; padding: 0.5rem 0.7rem;
  font-size: 0.88rem; font-weight: 600;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: var(--text-primary);
}
.hamlet-readout {
  margin: 1rem 0 0; padding: 0;
  border-top: 1px solid var(--grid-line);
}
.hamlet-readout-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--grid-line) 60%, transparent);
}
.hamlet-readout dt { margin: 0; color: var(--text-muted); font-size: 0.92rem; }
.hamlet-readout dd { margin: 0; font-weight: 600; font-size: 0.92rem; text-align: right; }
.hamlet-count { color: var(--text-muted); font-weight: 500; }
.hamlet-muted { color: var(--text-muted); font-style: italic; }
.hamlet-offline {
  margin: 0.9rem 0 0; font-size: 0.85rem; line-height: 1.5;
  color: var(--text-muted);
}
@media (prefers-reduced-motion: reduce) {
  .hamlet-stars rect, .hamlet-z { animation: none !important; }
  .hamlet-z { opacity: 0.85; }
}
`;
