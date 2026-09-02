import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, ControlBar, Select, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { fixed } from '../../utils/format';
import { fitPolynomial, predictPolynomial, type FitPoint } from '../../lib/math/leastSquares';
import {
  QUANTITY_LABELS,
  QUANTITY_UNITS,
  columnLabel,
  deriveSeries,
  frameFromCalibration,
  frameIndexForTime,
  sampleSigma,
  sampleValue,
  serializeTracks,
  upsertPoint,
  type Calibration,
  type ColumnKey,
  type DerivedSample,
  type ExportLayout,
  type PixelPoint,
  type QuantityKey,
  type Track,
  type TrackedPoint,
} from '../../lib/kinematics/videoAnalysis';
import {
  TUTORIAL_FPS,
  TUTORIAL_VIDEO_NAME,
  TUTORIAL_VIDEO_SRC,
  clampTutorialIndex,
  type TutorialProgress,
  type TutorialStep,
} from '../../lib/kinematics/videoTutorial';
import { useVideoFrames } from './videoAnalysis/useVideoFrames';
import { VideoStage, type StageMode } from './videoAnalysis/VideoStage';
import { TransportBar } from './videoAnalysis/TransportBar';
import { ModeControls } from './videoAnalysis/ModeControls';
import { TrackTable } from './videoAnalysis/TrackTable';
import { AnalysisPlot, type PlotPoint, type PlotSeries } from './videoAnalysis/AnalysisPlot';
import { FitPanel } from './videoAnalysis/FitPanel';
import { TutorialCoach } from './videoAnalysis/TutorialCoach';
import { savePlotImage, type PlotExportMeta } from './videoAnalysis/exportPlot';
import type { FitSummaryInput } from '../../lib/kinematics/fitSummary';
import { trackColor, trackShape } from './videoAnalysis/trackColors';
import './videoAnalysis/videoAnalysisLab.css';

/**
 * Measure real motion from a phone video: mark the moving object frame by
 * frame, set a distance scale and a frame rate, and read position and velocity
 * back out — with linear and quadratic fits over the result.
 *
 * Acceleration is reached only through that fit. There is deliberately no
 * point-by-point acceleration column: the second difference of hand-clicked
 * positions is mostly click noise, and offering it invites students to read
 * that noise instead of fitting the whole data set.
 *
 * The controls are organised around the stage mode — whichever of Mark, Scale,
 * Origin, or Axis is selected decides both what a click on the video does and
 * which settings are on screen.
 *
 * The video never leaves the browser: the site is a static build with no
 * server, and the file is read through an object URL straight off disk.
 */

const EMPTY_CALIBRATION: Calibration = {
  scaleFrom: { px: 0, py: 0 },
  scaleTo: { px: 0, py: 0 },
  scaleLengthMeters: 1,
  origin: { px: 0, py: 0 },
  axisAngleDeg: 0,
  positionUncertaintyPx: 3,
};

const ALL_COLUMNS: ColumnKey[] = ['frame', 'time', 'x', 'y', 'vx', 'vy', 'speed', 'px', 'py'];
const DEFAULT_COLUMNS: ColumnKey[] = ['frame', 'time', 'x', 'y'];
const PLOTTABLE: QuantityKey[] = ['x', 'y', 'vx', 'vy', 'speed'];
const LARGE_FILE_BYTES = 300 * 1024 * 1024;

const axisTitle = (quantity: QuantityKey) =>
  `${QUANTITY_LABELS[quantity]} (${QUANTITY_UNITS[quantity]})`;

export function VideoAnalysisLab() {
  const video = useVideoFrames();

  const [calibration, setCalibration] = useState<Calibration>(EMPTY_CALIBRATION);
  const [tracks, setTracks] = useState<Track[]>([
    { id: 1, label: 'Object A', colorIndex: 0, points: [] },
  ]);
  const [activeTrackId, setActiveTrackId] = useState(1);
  const [mode, setMode] = useState<StageMode>('calibrate');
  const [stepSize, setStepSize] = useState(1);
  const [followEnabled, setFollowEnabled] = useState(true);
  const [highlightedPointId, setHighlightedPointId] = useState<number | null>(null);
  const [lastMarked, setLastMarked] = useState<PixelPoint | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  const [plotX, setPlotX] = useState<'time' | 'x' | 'y'>('time');
  const [ySelection, setYSelection] = useState<QuantityKey[]>(['y']);
  const [fitTrackId, setFitTrackId] = useState(1);
  const [fitQuantity, setFitQuantity] = useState<QuantityKey>('y');
  const [fitModel, setFitModel] = useState<'none' | 'linear' | 'quadratic'>('none');
  const [fitRange, setFitRange] = useState<{ min: number; max: number } | null>(null);
  const [showResiduals, setShowResiduals] = useState(false);

  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [layout, setLayout] = useState<ExportLayout>('wide');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<'track' | 'all' | null>(null);
  const [tableOpen, setTableOpen] = useState(true);

  // The guided tour: `null` when it is not running, otherwise the step index.
  const [tutorialIndex, setTutorialIndex] = useState<number | null>(null);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const [tutorialError, setTutorialError] = useState<string | null>(null);
  /**
   * The calibration the lab placed by itself when the clip's size arrived.
   * Kept so the tour can tell a ruler the student has actually dragged from the
   * one that was sitting there when they arrived, without the stage having to
   * report anything back.
   */
  const [autoCalibration, setAutoCalibration] = useState<Calibration | null>(null);

  const nextIdRef = useRef(1);
  const noticeTimerRef = useRef<number | null>(null);
  const calibratedForRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const plotSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  // Place a usable starting calibration once the video's real size is known —
  // a ruler across the lower third and an origin near the bottom left.
  const { videoWidth, videoHeight, objectUrl } = video;
  useEffect(() => {
    const width = videoWidth;
    const height = videoHeight;
    if (!width || !height) return;
    const key = `${objectUrl}-${width}x${height}`;
    if (calibratedForRef.current === key) return;
    calibratedForRef.current = key;
    const placed: Calibration = {
      scaleFrom: { px: width * 0.3, py: height * 0.85 },
      scaleTo: { px: width * 0.7, py: height * 0.85 },
      scaleLengthMeters: 1,
      origin: { px: width * 0.12, py: height * 0.88 },
      axisAngleDeg: 0,
      positionUncertaintyPx: 3,
    };
    setCalibration(placed);
    setAutoCalibration(placed);
  }, [objectUrl, videoHeight, videoWidth]);

  const frame = useMemo(() => frameFromCalibration(calibration), [calibration]);

  const derived = useMemo(
    () =>
      tracks.map((track) => ({
        track,
        samples: frame
          ? deriveSeries(track.points, frame, calibration.positionUncertaintyPx, video.fps)
          : ([] as DerivedSample[]),
      })),
    [tracks, frame, calibration.positionUncertaintyPx, video.fps],
  );

  const activeEntry = derived.find((entry) => entry.track.id === activeTrackId) ?? derived[0];
  const activeTrack = activeEntry?.track;
  const totalPoints = tracks.reduce((sum, track) => sum + track.points.length, 0);

  const handleFile = useCallback(
    (file: File) => {
      setTracks([{ id: 1, label: 'Object A', colorIndex: 0, points: [] }]);
      setActiveTrackId(1);
      setFitTrackId(1);
      setFitRange(null);
      setHighlightedPointId(null);
      setLastMarked(null);
      setMode('calibrate');
      setAutoCalibration(null);
      calibratedForRef.current = null;
      setSizeWarning(
        file.size > LARGE_FILE_BYTES
          ? `That clip is ${(file.size / 1024 / 1024).toFixed(0)} MB. Seeking will be slow — a trimmed few seconds works much better.`
          : null,
      );
      video.loadFile(file);
    },
    [video],
  );

  /** Opening any video by hand ends the tour: it was about a different clip. */
  const openFile = useCallback(
    (file: File) => {
      setTutorialIndex(null);
      setTutorialError(null);
      handleFile(file);
    },
    [handleFile],
  );

  /**
   * Fetch the bundled sample clip and hand it to the same code path a
   * hand-picked file takes. The lab reads video through an object URL off a
   * `File`, so wrapping the response in one keeps the tour on exactly the
   * machinery a student's own clip will use — no second, untested route.
   */
  const startTutorial = useCallback(async () => {
    setTutorialLoading(true);
    setTutorialError(null);
    try {
      const response = await fetch(TUTORIAL_VIDEO_SRC);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      handleFile(new File([blob], TUTORIAL_VIDEO_NAME, { type: 'video/mp4' }));
      // The clip is a known 30.000 fps cut, so the tour can promise round
      // numbers rather than wait on the probe and hope.
      video.setFps(TUTORIAL_FPS);
      setTutorialIndex(0);
    } catch {
      setTutorialError(
        'Could not load the sample clip. Check your connection, or pick a video of your own and follow the written steps below.',
      );
    } finally {
      setTutorialLoading(false);
    }
  }, [handleFile, video]);

  const applyTutorialStep = useCallback(
    (step: TutorialStep) => {
      if (step.setMode) setMode(step.setMode);
      if (step.setStepFrames !== undefined) setStepSize(step.setStepFrames);
      if (step.seekToFrame !== undefined) void video.seekToFrame(step.seekToFrame);
    },
    [video],
  );

  const handleMark = useCallback(
    async (pixel: PixelPoint) => {
      const settled = video.current;
      if (!settled) return;
      const point: TrackedPoint = {
        id: (nextIdRef.current += 1),
        time: settled.time,
        exactTime: settled.exact,
        pixel,
      };
      setTracks((previous) =>
        previous.map((track) =>
          track.id === activeTrackId
            ? { ...track, points: upsertPoint(track.points, point, video.fps) }
            : track,
        ),
      );
      setHighlightedPointId(point.id);
      setLastMarked(pixel);
      setAnnouncement(`Point added at t = ${fixed(settled.time, 3)} s`);
      // Record first, advance second: the last click of a clip must never be
      // swallowed by running out of frames.
      if (video.atEnd) setAnnouncement('End of clip — no further frames to advance to.');
      else await video.stepFrames(stepSize);
    },
    [activeTrackId, stepSize, video],
  );

  const undoLastPoint = useCallback(async () => {
    if (!activeTrack || activeTrack.points.length === 0) return;
    const last = activeTrack.points[activeTrack.points.length - 1];
    setTracks((previous) =>
      previous.map((track) =>
        track.id === activeTrackId ? { ...track, points: track.points.slice(0, -1) } : track,
      ),
    );
    setHighlightedPointId(null);
    setAnnouncement('Removed the last point.');
    await video.seekToFrame(frameIndexForTime(last.time, video.fps));
  }, [activeTrack, activeTrackId, video]);

  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void undoLastPoint();
    }
  };

  const selectRow = async (index: number) => {
    const sample = activeEntry?.samples[index];
    const point = activeTrack?.points[index];
    if (!sample || !point) return;
    setHighlightedPointId(point.id);
    await video.seekToFrame(sample.frame);
  };

  const deleteRow = (index: number) => {
    const point = activeTrack?.points[index];
    if (!point) return;
    setTracks((previous) =>
      previous.map((track) =>
        track.id === activeTrackId
          ? { ...track, points: track.points.filter((entry) => entry.id !== point.id) }
          : track,
      ),
    );
    if (highlightedPointId === point.id) setHighlightedPointId(null);
  };

  const addTrack = () => {
    const id = (nextIdRef.current += 1);
    const colorIndex = tracks.length;
    setTracks((previous) => [
      ...previous,
      { id, label: `Object ${String.fromCharCode(65 + colorIndex)}`, colorIndex, points: [] },
    ]);
    setActiveTrackId(id);
  };

  const removeActiveTrack = () => {
    if (tracks.length <= 1) return;
    const remaining = tracks.filter((track) => track.id !== activeTrackId);
    setTracks(remaining);
    setActiveTrackId(remaining[0].id);
    if (fitTrackId === activeTrackId) setFitTrackId(remaining[0].id);
  };

  const plotSeries: PlotSeries[] = useMemo(() => {
    const out: PlotSeries[] = [];
    let index = 0;
    derived.forEach((entry) => {
      ySelection.forEach((quantity) => {
        const points = entry.samples
          .map((sample): PlotPoint | null => {
            const x = sampleValue(sample, plotX);
            const y = sampleValue(sample, quantity);
            if (x === null || y === null) return null;
            return {
              x,
              y,
              sigmaX: plotX === 'time' ? 0 : sampleSigma(sample, plotX),
              sigmaY: sampleSigma(sample, quantity),
            };
          })
          .filter((point): point is PlotPoint => point !== null);
        out.push({
          key: `${entry.track.id}-${quantity}`,
          label:
            derived.length > 1
              ? `${entry.track.label} · ${QUANTITY_LABELS[quantity]}`
              : QUANTITY_LABELS[quantity],
          color: trackColor(index),
          shape: trackShape(index),
          points,
        });
        index += 1;
      });
    });
    return out;
  }, [derived, plotX, ySelection]);

  const fitPoints = useMemo<FitPoint[]>(() => {
    const entry = derived.find((candidate) => candidate.track.id === fitTrackId);
    if (!entry) return [];
    return entry.samples
      .map((sample): FitPoint | null => {
        const x = sampleValue(sample, plotX);
        const y = sampleValue(sample, fitQuantity);
        if (x === null || y === null) return null;
        const sigma = sampleSigma(sample, fitQuantity);
        return { x, y, sigma: sigma !== null && sigma > 0 ? sigma : undefined };
      })
      .filter((point): point is FitPoint => point !== null);
  }, [derived, fitQuantity, fitTrackId, plotX]);

  const dataRange = useMemo(() => {
    if (fitPoints.length === 0) return null;
    const xs = fitPoints.map((point) => point.x);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  }, [fitPoints]);

  const effectiveRange = fitRange ?? dataRange;
  const rangedPoints = useMemo(
    () =>
      effectiveRange
        ? fitPoints.filter(
            (point) => point.x >= effectiveRange.min - 1e-9 && point.x <= effectiveRange.max + 1e-9,
          )
        : fitPoints,
    [effectiveRange, fitPoints],
  );

  const fitResult = useMemo(() => {
    if (fitModel === 'none') return null;
    return fitPolynomial(rangedPoints, fitModel === 'linear' ? 1 : 2);
  }, [fitModel, rangedPoints]);

  const fitCurve = useMemo(() => {
    if (!fitResult?.ok || !effectiveRange) return null;
    const span = effectiveRange.max - effectiveRange.min;
    if (!(span > 0)) return null;
    return Array.from({ length: 120 }, (_, i) => {
      const x = effectiveRange.min + (i / 119) * span;
      return { x, y: predictPolynomial(fitResult.fit.coefficients, x) };
    });
  }, [effectiveRange, fitResult]);

  const residualPoints = useMemo(() => {
    if (!showResiduals || !fitResult?.ok) return null;
    return rangedPoints.map((point, i) => ({ x: point.x, y: fitResult.fit.residuals[i] ?? 0 }));
  }, [fitResult, rangedPoints, showResiduals]);

  // Built once and shared: the fit panel on screen and the caption printed
  // under the saved image must describe the same fit.
  const fitSummaryInput: FitSummaryInput = {
    result: fitResult,
    model: fitModel,
    xQuantity: plotX,
    yQuantity: fitQuantity,
    seriesLabel: tracks.find((track) => track.id === fitTrackId)?.label ?? 'the data',
  };

  /** `caltrain-tutorial.mp4` becomes `caltrain-tutorial-plot.png`. */
  const plotFileName = `${
    (video.fileName ?? 'video-analysis')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'video-analysis'
  }-plot.png`;

  const exportSeries = derived.map((entry) => ({
    label: entry.track.label,
    samples: entry.samples,
  }));

  const flashNotice = (message: string) => {
    setCopyNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 2600);
  };

  const copyViaTextarea = (text: string) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  };

  const copyTsv = async () => {
    // Built before any await, so the clipboard write still runs inside the
    // click's user activation.
    const text = serializeTracks(exportSeries, { delimiter: '\t', columns, layout });
    if (!text) return;
    const rows = text.split('\n').length - 1;
    setManualCopyText(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flashNotice(`Copied ${rows} rows — paste into a spreadsheet.`);
        return;
      }
    } catch {
      // Permissions policies differ, especially in fullscreen. Fall through.
    }
    if (copyViaTextarea(text)) {
      flashNotice(`Copied ${rows} rows — paste into a spreadsheet.`);
      return;
    }
    setManualCopyText(text);
  };

  const downloadCsv = () => {
    const csv = serializeTracks(exportSeries, { delimiter: ',', columns, layout });
    if (!csv) return;
    // The BOM is for Excel, which otherwise mangles non-ASCII track labels.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'video-analysis.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    flashNotice('Saved video-analysis.csv');
  };

  const savePlot = async () => {
    const svg = plotSvgRef.current;
    if (!svg) return;
    const meta: PlotExportMeta = {
      clipName: video.fileName,
      xLabel: axisTitle(plotX),
      yLabel: ySelection.map((quantity) => axisTitle(quantity)).join(', '),
      seriesLabels: plotSeries.map((entry) => entry.label),
      pointCount: totalPoints,
      fps: video.fps,
      metersPerPixel: frame ? frame.metersPerPixel : null,
      fitRange: effectiveRange,
      // A range only counts as a subset once the student has dragged one; the
      // default range is just the span of the data.
      fitRangeIsSubset: fitRange !== null,
    };
    try {
      const name = await savePlotImage(svg, meta, fitSummaryInput, plotFileName);
      flashNotice(`Saved ${name}`);
    } catch {
      flashNotice('This browser would not render the plot to an image.');
    }
  };

  const clearPoints = (scope: 'track' | 'all') => {
    setTracks((previous) =>
      previous.map((track) =>
        scope === 'all' || track.id === activeTrackId ? { ...track, points: [] } : track,
      ),
    );
    setHighlightedPointId(null);
    setConfirmClear(null);
    setFitRange(null);
  };

  const highlightedIndex =
    activeTrack && highlightedPointId !== null
      ? activeTrack.points.findIndex((point) => point.id === highlightedPointId)
      : -1;

  const showStage = video.status !== 'empty' && video.status !== 'error';

  // Whether the ruler and the origin have been moved is derived rather than
  // tracked: comparing against the calibration the lab placed for itself says
  // the same thing as a flag would, without a second copy of the truth that
  // could disagree with the first.
  const scaleMoved =
    autoCalibration !== null &&
    (calibration.scaleFrom.px !== autoCalibration.scaleFrom.px ||
      calibration.scaleFrom.py !== autoCalibration.scaleFrom.py ||
      calibration.scaleTo.px !== autoCalibration.scaleTo.px ||
      calibration.scaleTo.py !== autoCalibration.scaleTo.py);
  const originMoved =
    autoCalibration !== null &&
    (calibration.origin.px !== autoCalibration.origin.px ||
      calibration.origin.py !== autoCalibration.origin.py);

  const tutorialProgress: TutorialProgress = {
    mode,
    scaleMoved,
    scaleLengthMeters: calibration.scaleLengthMeters,
    originMoved,
    pointCount: activeTrack?.points.length ?? 0,
    plotY: ySelection,
    fitModel,
    fitQuantity,
  };

  // The tour only appears once the clip is genuinely playable; its first step
  // talks about a picture that has to be on screen to make sense.
  const tutorialRunning = tutorialIndex !== null && video.status === 'ready';

  const fileInput = (
    <input
      type="file"
      accept="video/*,.mov,.mp4,.m4v,.webm"
      className="sr-only"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) openFile(file);
        event.target.value = '';
      }}
    />
  );

  return (
    <div
      ref={rootRef}
      onKeyDown={handleRootKeyDown}
      className="video-analysis-root relative flex h-full min-h-[46rem] w-full flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)]"
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {tutorialRunning && (
        <TutorialCoach
          rootRef={rootRef}
          index={clampTutorialIndex(tutorialIndex ?? 0)}
          progress={tutorialProgress}
          onIndexChange={(next) => setTutorialIndex(clampTutorialIndex(next))}
          onEnterStep={applyTutorialStep}
          onExit={() => setTutorialIndex(null)}
        />
      )}

      {!showStage ? (
        <div
          onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) openFile(file);
          }}
          className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-theme-grid p-10 text-center"
        >
          <h3 className="m-0 text-lg font-semibold">Drop or select video</h3>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <label className="cursor-pointer">
              {fileInput}
              <span className="btn">Select file</span>
            </label>
            <Button
              variant="secondary"
              type="button"
              onClick={() => void startTutorial()}
              disabled={tutorialLoading}
            >
              {tutorialLoading ? 'Loading sample clip…' : 'Walk me through it'}
            </Button>
          </div>

          {video.errorMessage && (
            <p className="m-0 max-w-md text-sm leading-6 text-[var(--accent-red)]">
              {video.errorMessage}
            </p>
          )}
          {tutorialError && (
            <p className="m-0 max-w-md text-sm leading-6 text-[var(--accent-red)]">
              {tutorialError}
            </p>
          )}
          <p className="m-0 text-xs text-[var(--text-muted)]">
            Your video is analyzed in your browser locally.
          </p>
        </div>
      ) : (
        <>
          <Readout variant="cards">
            <Readout.Value label="clip" value={video.fileName ?? '—'} />
            <Readout.Value label="length" value={fixed(video.duration, 2)} unit="s" />
            <Readout.Value
              label="frame"
              value={`${video.currentFrame + 1} / ${video.frameCount}`}
            />
            <Readout.Value label="points" value={String(totalPoints)} />
            <Readout.Value
              label="scale"
              value={frame ? frame.metersPerPixel.toPrecision(3) : '—'}
              unit="m/px"
            />
          </Readout>

          {sizeWarning && (
            <p className="m-0 text-sm text-[var(--text-muted)]">{sizeWarning}</p>
          )}
          {!video.supportsFrameCallback && (
            <p className="m-0 rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-3 py-2 text-sm leading-6 text-[var(--text-muted)]">
              This browser can&rsquo;t report exact frame times, so set the frame rate below to match
              your camera. Timings will be off by a constant fraction of a frame, which shifts only
              the intercept of a fit.
            </p>
          )}

          <div className="video-analysis-grid">
            <div className="video-analysis-col-video flex min-w-0 flex-col gap-3">
              <VideoStage
                attachVideo={video.attachVideo}
                objectUrl={video.objectUrl}
                videoWidth={video.videoWidth}
                videoHeight={video.videoHeight}
                mode={mode}
                calibration={calibration}
                onCalibrationChange={setCalibration}
                frame={frame}
                tracks={tracks}
                activeTrackId={activeTrackId}
                highlightedPointId={highlightedPointId}
                followTarget={lastMarked}
                followEnabled={followEnabled}
                activity={video.seeking ? 'seeking' : video.isPlaying ? 'playing' : 'idle'}
                transport={
                  <TransportBar
                    isPlaying={video.isPlaying}
                    onTogglePlay={video.togglePlay}
                    onStepFrame={(delta) => void video.stepFrames(delta)}
                    currentFrame={video.currentFrame}
                    frameCount={video.frameCount}
                    onSeekToFrame={(index) => void video.seekToFrame(index)}
                    time={video.playheadTime}
                    duration={video.duration}
                    disabled={video.status !== 'ready'}
                  />
                }
                onMark={(pixel) => void handleMark(pixel)}
                onStep={(delta) => void video.stepFrames(delta)}
                stepSize={stepSize}
              />

              <ModeControls
                mode={mode}
                onModeChange={setMode}
                calibration={calibration}
                onCalibrationChange={setCalibration}
                metersPerPixel={frame ? frame.metersPerPixel : null}
                fps={video.fps}
                onFpsChange={video.setFps}
                frameRateEstimate={video.frameRateEstimate}
                onDetectFrameRate={() => void video.detectFrameRate()}
                followEnabled={followEnabled}
                onFollowChange={setFollowEnabled}
                stepSize={stepSize}
                onStepSizeChange={setStepSize}
                onUndoPoint={() => void undoLastPoint()}
                canUndo={(activeTrack?.points.length ?? 0) > 0}
                tracks={tracks}
                activeTrackId={activeTrackId}
                onActiveTrackChange={setActiveTrackId}
                onRenameActiveTrack={(label) =>
                  setTracks((previous) =>
                    previous.map((track) =>
                      track.id === activeTrackId ? { ...track, label } : track,
                    ),
                  )
                }
                onAddTrack={addTrack}
                onRemoveTrack={removeActiveTrack}
              />

              <ControlBar align="start">
                <label className="cursor-pointer">
                  {fileInput}
                  <span className="btn btn-secondary">Open a different video</span>
                </label>
                {tutorialIndex === null && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => void startTutorial()}
                    disabled={tutorialLoading}
                  >
                    {tutorialLoading ? 'Loading sample clip…' : 'Guided tutorial'}
                  </Button>
                )}
              </ControlBar>
            </div>

            <div className="video-analysis-col-graph flex min-w-0 flex-col gap-3">
              <div className="rounded-lg border border-theme-grid bg-[var(--surface-elevated)] p-2">
                <AnalysisPlot
                  exportRef={plotSvgRef}
                  series={plotSeries}
                  xLabel={axisTitle(plotX)}
                  yLabel={
                    ySelection.length === 1
                      ? axisTitle(ySelection[0])
                      : [...new Set(ySelection.map((q) => QUANTITY_UNITS[q]))].join(', ')
                  }
                  fitCurve={fitCurve}
                  fitColor="var(--accent-purple)"
                  fitRange={fitModel === 'none' ? null : effectiveRange}
                  onFitRangeChange={(min, max) => setFitRange({ min, max })}
                  residuals={residualPoints}
                  summary={`Scatter plot of ${ySelection
                    .map((q) => QUANTITY_LABELS[q])
                    .join(', ')} against ${QUANTITY_LABELS[plotX]} with ${
                    plotSeries[0]?.points.length ?? 0
                  } points${fitResult?.ok ? `, fitted with a ${fitModel}` : ''}.`}
                />
              </div>

              <div data-tour="plot-axes">
                <ControlBar align="start">
                  <Select
                    label="Horizontal"
                    value={plotX}
                    onChange={(value) => {
                      setPlotX(value as 'time' | 'x' | 'y');
                      setFitRange(null);
                    }}
                    options={[
                      { value: 'time', label: 'time' },
                      { value: 'x', label: 'x' },
                      { value: 'y', label: 'y' },
                    ]}
                  />
                  <span className="text-sm font-medium">Vertical</span>
                  {PLOTTABLE.map((quantity) => (
                    <Toggle
                      key={quantity}
                      label={QUANTITY_LABELS[quantity]}
                      checked={ySelection.includes(quantity)}
                      onChange={(checked) =>
                        setYSelection((previous) =>
                          checked
                            ? [...previous, quantity]
                            : previous.filter((entry) => entry !== quantity),
                        )
                      }
                    />
                  ))}
                </ControlBar>
              </div>
              {ySelection.length > 1 && (
                <p className="m-0 text-xs text-[var(--text-muted)]">
                  Several quantities share one vertical scale here. Showing one at a time keeps the
                  axis readable.
                </p>
              )}

              <div data-tour="fit-controls">
                <ControlBar align="start">
                  <Select
                    label="Fit"
                    value={fitModel}
                    onChange={(value) => setFitModel(value as 'none' | 'linear' | 'quadratic')}
                    options={[
                      { value: 'none', label: 'no fit' },
                      { value: 'linear', label: 'linear' },
                      { value: 'quadratic', label: 'quadratic' },
                    ]}
                  />
                  <Select
                    label="to"
                    value={fitQuantity}
                    onChange={(value) => setFitQuantity(value as QuantityKey)}
                    options={PLOTTABLE.map((quantity) => ({
                      value: quantity,
                      label: QUANTITY_LABELS[quantity],
                    }))}
                  />
                  {tracks.length > 1 && (
                    <Select
                      label="of"
                      value={String(fitTrackId)}
                      onChange={(value) => setFitTrackId(Number(value))}
                      options={tracks.map((track) => ({
                        value: String(track.id),
                        label: track.label,
                      }))}
                    />
                  )}
                  <Toggle label="Residuals" checked={showResiduals} onChange={setShowResiduals} />
                  {fitRange && (
                    <Button variant="secondary" type="button" onClick={() => setFitRange(null)}>
                      Fit all points
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => void savePlot()}
                    disabled={totalPoints === 0}
                  >
                    Save plot
                  </Button>
                </ControlBar>
              </div>

              <div data-tour="fit-panel">
                <FitPanel {...fitSummaryInput} />
              </div>
            </div>

            {/* The table is the tallest thing on the page and the least often
                needed while marking, so it folds away. Its placement is set in
                videoAnalysisLab.css: full width normally, tucked under the
                graph in fullscreen where vertical room is the scarce thing. */}
            <div className="video-analysis-col-data flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-base font-semibold">
                <button
                  type="button"
                  onClick={() => setTableOpen((open) => !open)}
                  aria-expanded={tableOpen}
                  aria-controls="video-analysis-data"
                  className="inline-flex items-center gap-2 rounded text-base font-semibold text-[var(--text-primary)] hover:text-[var(--accent-blue)]"
                >
                  <span aria-hidden="true" className="text-xs">
                    {tableOpen ? '▾' : '▸'}
                  </span>
                  {activeTrack?.label ?? 'Data'}
                </button>
                <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                  {activeEntry?.samples.length ?? 0} points
                  {tracks.length > 1 ? ' (the export includes every object)' : ''}
                </span>
              </h3>
              {copyNotice && (
                <span className="text-sm font-medium text-[var(--accent-green)]">{copyNotice}</span>
              )}
            </div>

            <div id="video-analysis-data" hidden={!tableOpen} className="flex flex-col gap-2">
              <TrackTable
                label={activeTrack?.label ?? 'Data'}
                color={trackColor(activeTrack?.colorIndex ?? 0)}
                samples={activeEntry?.samples ?? []}
                columns={columns}
                highlightedPointIndex={highlightedIndex >= 0 ? highlightedIndex : null}
                onSelectRow={(index) => void selectRow(index)}
                onDeleteRow={deleteRow}
              />

              <ControlBar align="start">
                <span className="text-sm font-medium">Columns</span>
                {ALL_COLUMNS.map((column) => (
                  <Toggle
                    key={column}
                    label={columnLabel(column)}
                    checked={columns.includes(column)}
                    onChange={(checked) =>
                      setColumns((previous) =>
                        checked
                          ? ALL_COLUMNS.filter(
                              (entry) => previous.includes(entry) || entry === column,
                            )
                          : previous.filter((entry) => entry !== column),
                      )
                    }
                  />
                ))}
              </ControlBar>
            </div>

            {/* Export stays reachable whether or not the table is folded away. */}
            <div data-tour="export">
              <ControlBar align="start">
                <Select
                  label="Layout"
                  value={layout}
                  onChange={(value) => setLayout(value as ExportLayout)}
                  options={[
                    { value: 'wide', label: 'one column group per object' },
                    { value: 'long', label: 'one row per point' },
                  ]}
                />
                <Button type="button" onClick={() => void copyTsv()}>
                  Copy for spreadsheet
                </Button>
                <Button variant="secondary" type="button" onClick={downloadCsv}>
                  Download CSV
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setConfirmClear(confirmClear === 'track' ? null : 'track')}
                >
                  {confirmClear === 'track' ? 'Tap again to clear' : 'Clear this object'}
                </Button>
                {confirmClear === 'track' && (
                  <Button type="button" onClick={() => clearPoints('track')}>
                    Yes, clear
                  </Button>
                )}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setConfirmClear(confirmClear === 'all' ? null : 'all')}
                >
                  {confirmClear === 'all' ? 'Tap again to clear' : 'Clear all'}
                </Button>
                {confirmClear === 'all' && (
                  <Button type="button" onClick={() => clearPoints('all')}>
                    Yes, clear everything
                  </Button>
                )}
              </ControlBar>
            </div>

            {manualCopyText && (
              <div className="flex flex-col gap-1">
                <p className="m-0 text-sm text-[var(--text-muted)]">
                  This browser blocked the clipboard. Select everything below and copy it by hand.
                </p>
                <textarea
                  readOnly
                  value={manualCopyText}
                  rows={6}
                  onFocus={(event) => event.target.select()}
                  className="w-full rounded-md border border-theme-grid bg-[var(--surface-elevated)] p-2 font-mono text-xs text-[var(--text-primary)]"
                />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default VideoAnalysisLab;
