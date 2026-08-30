import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button } from '../../shared/InlineControls';
import { markerPath, trackColor, trackShape } from './trackColors';
import {
  toPixel,
  type Calibration,
  type CoordinateFrame,
  type PixelPoint,
  type Track,
} from '../../../lib/kinematics/videoAnalysis';

/**
 * The video and everything drawn on top of it.
 *
 * This component owns exactly one contract that must not leak: turning a
 * pointer position into a location in *intrinsic video pixels*. The SVG overlay
 * is absolutely positioned over the video's own box and its viewBox is the
 * video's natural size, so the two cannot drift apart — not on resize, not in
 * fullscreen, and not when a phone clip carries rotation metadata. The
 * conversion then goes through the overlay's own bounding rectangle, which
 * already accounts for zoom and pan, so a bookkeeping error in the transform
 * can never corrupt stored data.
 */

export type StageMode = 'mark' | 'calibrate' | 'origin' | 'axis';

interface VideoStageProps {
  attachVideo: (element: HTMLVideoElement | null) => void;
  objectUrl: string | null;
  videoWidth: number;
  videoHeight: number;
  mode: StageMode;
  calibration: Calibration;
  onCalibrationChange: (next: Calibration) => void;
  frame: CoordinateFrame | null;
  tracks: Track[];
  activeTrackId: number;
  highlightedPointId: number | null;
  /** Recentre on this point after an auto-advance, when zoomed in. */
  followTarget: PixelPoint | null;
  followEnabled: boolean;
  seeking: boolean;
  onMark: (pixel: PixelPoint) => void;
  onStep: (delta: number) => void;
  stepSize: number;
}

type DragKind =
  | { kind: 'handle'; handle: 'scaleFrom' | 'scaleTo' | 'origin' }
  | { kind: 'axis'; anchor: PixelPoint }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const HANDLE_HIT_CSS_PX = 14;
const CLICK_SLOP_CSS_PX = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Pointer capture is best-effort: some browsers throw for a pointer they no
// longer consider active, and losing the whole handler to that would break
// marking outright.
const capturePointer = (element: Element, pointerId: number) => {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Dragging still works from the element's own move events.
  }
};

const releasePointer = (element: Element, pointerId: number) => {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Already released.
  }
};

export function VideoStage({
  attachVideo,
  objectUrl,
  videoWidth,
  videoHeight,
  mode,
  calibration,
  onCalibrationChange,
  frame,
  tracks,
  activeTrackId,
  highlightedPointId,
  followTarget,
  followEnabled,
  seeking,
  onMark,
  onStep,
  stepSize,
}: VideoStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragKind | null>(null);
  const downAtRef = useRef<{ x: number; y: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const spaceRef = useRef(false);

  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [axisPreview, setAxisPreview] = useState<{ from: PixelPoint; to: PixelPoint } | null>(null);

  const aspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;

  // Size the video to an aspect-fit box measured in JS rather than letting CSS
  // letterbox it: a letterboxed element's box no longer matches the painted
  // frame, and the overlay would sit slightly wrong.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const available = wrap.clientWidth;
      if (available <= 0) return;
      // Portrait phone video is the common case, so the height cap matters more
      // than the width one — without it a portrait clip pushes every control
      // below the fold.
      const maxHeight = Math.max(240, Math.min(window.innerHeight * 0.62, 620));
      const width = Math.min(available, maxHeight * aspect);
      setBox({ width, height: width / aspect });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [aspect]);

  /** Video pixels per CSS pixel — used to keep overlay marks a constant size. */
  const pixelScale = box.width > 0 && videoWidth > 0 ? videoWidth / box.width / zoom : 1;

  const toVideoPixel = useCallback(
    (clientX: number, clientY: number): PixelPoint | null => {
      const svg = svgRef.current;
      if (!svg || videoWidth <= 0 || videoHeight <= 0) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        px: ((clientX - rect.left) / rect.width) * videoWidth,
        py: ((clientY - rect.top) / rect.height) * videoHeight,
      };
    },
    [videoWidth, videoHeight],
  );

  const insideFrame = (pixel: PixelPoint) =>
    pixel.px >= 0 && pixel.px <= videoWidth && pixel.py >= 0 && pixel.py <= videoHeight;

  const axisHandle = useMemo<PixelPoint | null>(() => {
    if (!frame || mode !== 'axis') return null;
    return toPixel(frame, { x: 140 * pixelScale * frame.metersPerPixel, y: 0 });
  }, [frame, mode, pixelScale]);

  // The ruler is only drawn while setting a scale, and the axis arrows only
  // while tilting axes, so that a student marking points sees the video and
  // their own points and nothing else.
  const showRuler = mode === 'calibrate';
  const showAxes = mode === 'axis' || mode === 'origin';

  const hitTestHandle = (pixel: PixelPoint): DragKind | null => {
    const threshold = HANDLE_HIT_CSS_PX * pixelScale;
    // Only handles that are currently drawn can be grabbed — an invisible drag
    // target is worse than none.
    const candidates: Array<{ handle: 'scaleFrom' | 'scaleTo' | 'origin'; at: PixelPoint }> = [
      ...(showRuler
        ? ([
            { handle: 'scaleFrom', at: calibration.scaleFrom },
            { handle: 'scaleTo', at: calibration.scaleTo },
          ] as const)
        : []),
      { handle: 'origin', at: calibration.origin },
    ];
    let bestHandle: 'scaleFrom' | 'scaleTo' | 'origin' | null = null;
    let bestDistance = threshold;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.at.px - pixel.px, candidate.at.py - pixel.py);
      if (distance <= bestDistance) {
        bestHandle = candidate.handle;
        bestDistance = distance;
      }
    }
    return bestHandle ? { kind: 'handle', handle: bestHandle } : null;
  };

  const applyAxisDrag = (anchor: PixelPoint, pixel: PixelPoint, snap: boolean) => {
    const degrees = (Math.atan2(-(pixel.py - anchor.py), pixel.px - anchor.px) * 180) / Math.PI;
    const snapped = snap ? Math.round(degrees / 5) * 5 : degrees;
    setAxisPreview({ from: anchor, to: pixel });
    onCalibrationChange({ ...calibration, axisAngleDeg: Number(snapped.toFixed(2)) });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    stageRef.current?.focus();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      dragRef.current = null;
      return;
    }

    const pixel = toVideoPixel(event.clientX, event.clientY);
    if (!pixel) return;
    downAtRef.current = { x: event.clientX, y: event.clientY };
    capturePointer(event.currentTarget, event.pointerId);

    // Panning is a gesture rather than a mode, so it never costs the student a
    // trip back to the mode buttons.
    if (event.button === 1 || spaceRef.current) {
      dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    // Calibration handles stay live in every mode: nudging the scale line should
    // not require leaving mark mode.
    const handle = hitTestHandle(pixel);
    if (handle) {
      dragRef.current = handle;
      return;
    }

    if (mode === 'calibrate') {
      onCalibrationChange({ ...calibration, scaleFrom: pixel, scaleTo: pixel });
      dragRef.current = { kind: 'handle', handle: 'scaleTo' };
      return;
    }
    if (mode === 'origin') {
      onCalibrationChange({ ...calibration, origin: pixel });
      return;
    }
    if (mode === 'axis') {
      dragRef.current = { kind: 'axis', anchor: pixel };
      setAxisPreview({ from: pixel, to: pixel });
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0) {
        setZoom(clamp((pinch.zoom * distance) / pinch.distance, MIN_ZOOM, MAX_ZOOM));
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'pan') {
      setPan({
        x: drag.panX + (event.clientX - drag.startX),
        y: drag.panY + (event.clientY - drag.startY),
      });
      return;
    }

    const pixel = toVideoPixel(event.clientX, event.clientY);
    if (!pixel) return;
    if (drag.kind === 'axis') {
      applyAxisDrag(drag.anchor, pixel, event.shiftKey);
      return;
    }
    onCalibrationChange({ ...calibration, [drag.handle]: pixel });
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    const downAt = downAtRef.current;
    dragRef.current = null;
    downAtRef.current = null;
    setAxisPreview(null);
    releasePointer(event.currentTarget, event.pointerId);

    if (drag || !downAt || mode !== 'mark') return;
    // A click, not a drag that happened to start in mark mode.
    if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_SLOP_CSS_PX) return;
    // Marking a frame you cannot see is wrong, so clicks mid-seek are dropped
    // rather than queued.
    if (seeking) return;
    const pixel = toVideoPixel(event.clientX, event.clientY);
    if (pixel && insideFrame(pixel)) onMark(pixel);
  };

  // React's onWheel is passive, so preventDefault there does nothing and the
  // page scrolls out from under the zoom. A native non-passive listener is the
  // only way to hold the page still.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && document.activeElement !== stage && !stage.contains(document.activeElement)) {
        // Only hijack the wheel once the stage has been interacted with, so a
        // reader scrolling past the tool is not trapped inside it.
        return;
      }
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      setZoom((previous) => {
        const next = clamp(previous * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, MAX_ZOOM);
        setPan((currentPan) => ({
          x: cursorX - ((cursorX - currentPan.x) * next) / previous,
          y: cursorY - ((cursorY - currentPan.y) * next) / previous,
        }));
        return next;
      });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      spaceRef.current = true;
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onStep(event.shiftKey ? stepSize : 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onStep(event.shiftKey ? -stepSize : -1);
    }
  };

  // Keep the freshly marked point on screen after an auto-advance; without this
  // tracking a small object at high zoom is unusable.
  useEffect(() => {
    if (!followEnabled || !followTarget || zoom <= 1 || box.width <= 0) return;
    const scaleX = (box.width / videoWidth) * zoom;
    const scaleY = (box.height / videoHeight) * zoom;
    setPan((previous) => {
      const screenX = previous.x + followTarget.px * scaleX;
      const screenY = previous.y + followTarget.py * scaleY;
      const marginX = box.width * 0.2;
      const marginY = box.height * 0.2;
      const outside =
        screenX < marginX ||
        screenX > box.width - marginX ||
        screenY < marginY ||
        screenY > box.height - marginY;
      if (!outside) return previous;
      return {
        x: box.width / 2 - followTarget.px * scaleX,
        y: box.height / 2 - followTarget.py * scaleY,
      };
    });
  }, [followTarget, followEnabled, zoom, box.width, box.height, videoWidth, videoHeight]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const markerRadius = 6 * pixelScale;
  const originCross = 16 * pixelScale;
  const axisLength = 90 * pixelScale;
  const axisEnd = frame
    ? toPixel(frame, { x: axisLength * frame.metersPerPixel, y: 0 })
    : null;
  const axisUpEnd = frame
    ? toPixel(frame, { x: 0, y: axisLength * frame.metersPerPixel })
    : null;

  const cursorClass =
    mode === 'mark' ? 'cursor-crosshair' : mode === 'origin' ? 'cursor-cell' : 'cursor-crosshair';

  return (
    <div className="flex flex-col gap-2">
      <div ref={wrapRef} className="w-full">
        <div
          ref={stageRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            if (event.key === ' ') spaceRef.current = false;
          }}
          onBlur={() => {
            spaceRef.current = false;
          }}
          className="relative mx-auto overflow-hidden rounded-lg border border-theme-grid bg-[var(--surface-elevated)] outline-none focus-visible:border-theme-blue"
          style={{ width: box.width || undefined, height: box.height || undefined }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <div className="relative" style={{ width: box.width, height: box.height }}>
              <video
                ref={attachVideo}
                src={objectUrl ?? undefined}
                playsInline
                muted
                preload="auto"
                className="block h-full w-full select-none"
                style={{ width: box.width, height: box.height }}
              />
              <svg
                ref={svgRef}
                viewBox={`0 0 ${Math.max(1, videoWidth)} ${Math.max(1, videoHeight)}`}
                preserveAspectRatio="none"
                className={`absolute inset-0 h-full w-full ${cursorClass}`}
                style={{ touchAction: 'none' }}
                role="img"
                aria-label="Video frame with marked points, scale line, and coordinate axes"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* Marked points, oldest track first so the active one sits on top. */}
                {tracks.map((track) => {
                  const active = track.id === activeTrackId;
                  const color = trackColor(track.colorIndex);
                  const shape = trackShape(track.colorIndex);
                  return (
                    <g key={track.id} opacity={active ? 1 : 0.45}>
                      {track.points.length > 1 && (
                        <polyline
                          points={track.points.map((point) => `${point.pixel.px},${point.pixel.py}`).join(' ')}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          vectorEffect="non-scaling-stroke"
                          opacity={0.7}
                        />
                      )}
                      {track.points.map((point) => (
                        <path
                          key={point.id}
                          d={markerPath(shape, point.pixel.px, point.pixel.py, markerRadius)}
                          fill={point.id === highlightedPointId ? color : 'none'}
                          stroke={color}
                          strokeWidth={point.id === highlightedPointId ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  );
                })}

                {/* The ruler, drawn only while its mode is selected. */}
                {showRuler && (
                <g>
                  <line
                    x1={calibration.scaleFrom.px}
                    y1={calibration.scaleFrom.py}
                    x2={calibration.scaleTo.px}
                    y2={calibration.scaleTo.py}
                    stroke="var(--accent-purple)"
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  {[calibration.scaleFrom, calibration.scaleTo].map((end, index) => (
                    <circle
                      key={index}
                      cx={end.px}
                      cy={end.py}
                      r={7 * pixelScale}
                      fill="var(--surface-elevated)"
                      stroke="var(--accent-purple)"
                      strokeWidth={2.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
                )}

                {/* Origin and axis directions. */}
                <g stroke="var(--text-primary)" vectorEffect="non-scaling-stroke">
                  <line
                    x1={calibration.origin.px - originCross}
                    y1={calibration.origin.py}
                    x2={calibration.origin.px + originCross}
                    y2={calibration.origin.py}
                    strokeWidth={1}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={calibration.origin.px}
                    y1={calibration.origin.py - originCross}
                    x2={calibration.origin.px}
                    y2={calibration.origin.py + originCross}
                    strokeWidth={1}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  {showAxes && axisEnd && (
                    <line
                      x1={calibration.origin.px}
                      y1={calibration.origin.py}
                      x2={axisEnd.px}
                      y2={axisEnd.py}
                      stroke="var(--accent-red)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {showAxes && axisUpEnd && (
                    <line
                      x1={calibration.origin.px}
                      y1={calibration.origin.py}
                      x2={axisUpEnd.px}
                      y2={axisUpEnd.py}
                      stroke="var(--accent-green)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <circle
                    cx={calibration.origin.px}
                    cy={calibration.origin.py}
                    r={5 * pixelScale}
                    fill="var(--surface-elevated)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>

                {axisPreview && (
                  <line
                    x1={axisPreview.from.px}
                    y1={axisPreview.from.py}
                    x2={axisPreview.to.px}
                    y2={axisPreview.to.py}
                    stroke="var(--accent-red)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {axisHandle && (
                  <circle
                    cx={axisHandle.px}
                    cy={axisHandle.py}
                    r={6 * pixelScale}
                    fill="var(--accent-red)"
                    opacity={0.8}
                  />
                )}
              </svg>
            </div>
          </div>

          {seeking && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-[var(--surface-elevated)] px-2 py-1 text-xs font-medium text-[var(--text-muted)] shadow-sm">
              seeking…
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
        <Button
          variant="secondary"
          type="button"
          onClick={() => setZoom((value) => clamp(value / 1.3, MIN_ZOOM, MAX_ZOOM))}
          aria-label="Zoom out"
        >
          −
        </Button>
        <span className="min-w-[4ch] text-center font-mono tabular-nums">{zoom.toFixed(1)}×</span>
        <Button
          variant="secondary"
          type="button"
          onClick={() => setZoom((value) => clamp(value * 1.3, MIN_ZOOM, MAX_ZOOM))}
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button variant="secondary" type="button" onClick={resetView}>
          Reset view
        </Button>
        <span className="hidden sm:inline">
          Scroll to zoom, hold Space or drag with the middle button to pan.
        </span>
      </div>
    </div>
  );
}

export default VideoStage;
