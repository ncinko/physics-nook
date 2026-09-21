import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Button, ControlBar, Select, Slider, Toggle } from '../shared/InlineControls.tsx';
import { Readout } from '../shared/Readout.tsx';
import { cssColorToRgb, getCssColor, onThemeChange, type Rgb } from '../shared/themeColors.ts';
import {
  COLUMN_PX,
  DEFAULT_FFT_SIZE,
  DEFAULT_MAX_DECIBELS,
  DEFAULT_MIN_DECIBELS,
  COMPACT_PLOT_ASPECT,
  DEFAULT_PLOT_ASPECT,
  FFT_SIZES,
  HISTORY_COLUMNS,
  HOP_SECONDS,
  MIN_FREQUENCY_HZ,
  PLOT_COLUMNS,
  PLOT_ROWS,
  PLOT_WIDTH_PX,
  binBandwidth,
  buildFrequencyTicks,
  buildRowBinPlan,
  buildSpectrogramRamp,
  buildTimeTicks,
  byteToDecibels,
  confirmedPeaks,
  createSpectrogramHistory,
  estimateFundamental,
  findSpectralPeaks,
  peaksAtHistoryColumn,
  formatDecibels,
  formatFrequencyLabel,
  formatNote,
  frequencyToRow,
  getSpectrogramLayout,
  noteFromFrequency,
  placeLabels,
  rampColorAt,
  renormalizeByte,
  rowToFrequency,
  sampleRow,
  stabilizePeaks,
  usableMaxFrequency,
  windowSeconds,
  type FftSize,
  type FrequencyScale,
  type FundamentalEstimate,
  type PeakTrack,
  type RowBinPlan,
  type SpectralPeak,
  type SpectrogramHistory,
} from '../../lib/waves/spectrogram.ts';
import { SYNTH_EXAMPLES, exampleById } from '../../lib/waves/spectrogramExamples.ts';
import {
  availableClips,
  clipUrl,
  initialSourceState,
  shouldReleaseMicrophone,
  sourceReducer,
  sourceStatusMessage,
  type RecordedClip,
} from '../../lib/waves/spectrogramSources.ts';
import {
  closeSpectrogramGraph,
  createSpectrogramGraph,
  loadClip,
  microphoneSupport,
  playBuffer,
  releaseMicrophone,
  requestMicrophone,
  resumeGraph,
  startExample,
  streamSampleRate,
  watchTrack,
  type ActiveSource,
  type SpectrogramGraph,
} from './spectrogramAudio.ts';

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

interface Probe {
  /** 0 at the left edge of the history, PLOT_COLUMNS - 1 at "now". */
  column: number;
  /** 0 at the top of the plot. */
  row: number;
  pinned: boolean;
}

/** How often the peak analysis runs. Sixty times a second is wasted work. */
const ANALYSIS_INTERVAL_MS = 100;
/** The same spacing in history columns, for replaying it over a frozen view. */
const ANALYSIS_STRIDE_COLUMNS = Math.round(ANALYSIS_INTERVAL_MS / 1000 / HOP_SECONDS);
/** A live region updated at frame rate is a screen-reader denial of service. */
const LIVE_REGION_INTERVAL_MS = 800;

const PROBE_INSTRUCTIONS =
  'Turn on measurements, then use the arrow keys to move a cursor and read the frequency, ' +
  'time and level under it. Enter pins the cursor, Escape clears it. While the display is ' +
  'frozen it can be dragged, or walked with the arrow keys, back through earlier sound.';

const SUBSCRIPT_ONE = 'ƒ₁';

const describePeaks = (peaks: SpectralPeak[]): string => {
  if (peaks.length === 0) return 'No clear tone detected.';
  const [loudest, ...rest] = peaks;
  const note = noteFromFrequency(loudest.frequencyHz);
  const others = rest
    .slice(0, 2)
    .map((peak) => `${Math.round(peak.frequencyHz)}`)
    .join(' and ');
  return (
    `Loudest component ${Math.round(loudest.frequencyHz)} hertz` +
    `${note ? `, ${note.name}` : ''}.` +
    `${others ? ` Also at ${others} hertz.` : ''}`
  );
};

const CLIP_PREFIX = 'clip:';

export default function SpectrogramLab() {
  const [source, dispatch] = useReducer(sourceReducer, initialSourceState);
  const [scale, setScale] = useState<FrequencyScale>('log');
  const [fftSize, setFftSize] = useState<FftSize>(DEFAULT_FFT_SIZE);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showNoteNames, setShowNoteNames] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [floorDb, setFloorDb] = useState(DEFAULT_MIN_DECIBELS);
  // One picker for both kinds of sound; recordings carry a prefix so their ids
  // can never collide with an example's.
  const [selectedSound, setSelectedSound] = useState('');
  const [sampleRate, setSampleRate] = useState(48000);
  const [plotBox, setPlotBox] = useState({ width: 960, height: 400 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [peaks, setPeaks] = useState<SpectralPeak[]>([]);
  const [fundamental, setFundamental] = useState<FundamentalEstimate | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [probeMessage, setProbeMessage] = useState('');
  const [clipLoading, setClipLoading] = useState<string | null>(null);
  const [rampVersion, setRampVersion] = useState(0);
  const [micGainDb, setMicGainDb] = useState(12);
  const [inputLevelDb, setInputLevelDb] = useState<number | null>(null);
  const [micSilent, setMicSilent] = useState(false);
  /** Columns the frozen view has been dragged back from the newest one. */
  const [panColumns, setPanColumns] = useState(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const plotBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<SpectrogramGraph | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeSourceRef = useRef<ActiveSource | null>(null);
  const clipCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  const historyRef = useRef<SpectrogramHistory | null>(null);
  const planRef = useRef<RowBinPlan | null>(null);
  const rampRef = useRef<Uint8Array | null>(null);
  const backgroundRef = useRef<Rgb>([255, 255, 255]);
  // Explicitly backed by an ArrayBuffer: getByteFrequencyData will not accept
  // the SharedArrayBuffer-capable default.
  const spectrumRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(DEFAULT_FFT_SIZE / 2));
  const waveformRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(DEFAULT_FFT_SIZE));
  const stopTrackWatchRef = useRef<(() => void) | null>(null);
  const scratchRef = useRef<ImageData | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastColumnTimeRef = useRef(0);
  const lastAnalysisRef = useRef(0);
  const lastLiveRef = useRef(0);
  const tracksRef = useRef<PeakTrack[]>([]);
  const frozenRef = useRef(frozen);
  const reducedMotionRef = useRef(reducedMotion);
  const previousSourceRef = useRef(source);
  // Keyboard auto-repeat fires many events between renders, and a handler
  // closed over `probe` would step every one of them from the same stale
  // position - holding an arrow key would crawl instead of moving. This ref
  // is the position the keyboard reads and writes; state is for rendering.
  const probeRef = useRef<Probe | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startPan: number; moved: boolean } | null>(null);
  // Read by redrawAll. Keeping the pan out of its dependencies matters: as a
  // dependency it changed the callback's identity on every pointermove, and
  // the three effects that hold redrawAll would each fire, repainting the
  // whole display three times per frame of a drag.
  const panRef = useRef(0);

  /** The one way the probe moves: ref first for auto-repeat, then state. */
  const commitProbe = useCallback((next: Probe | null) => {
    probeRef.current = next;
    setProbe(next);
  }, []);

  const maxHz = usableMaxFrequency(sampleRate);
  const layout = useMemo(
    () => getSpectrogramLayout(plotBox.width, plotBox.height),
    [plotBox.width, plotBox.height],
  );

  const micSupport = useMemo(() => microphoneSupport(), []);
  const clips = availableClips(source);
  // A recording that failed to load drops out of the list; fall back to the
  // placeholder rather than leave the picker pointing at nothing.
  const pickerValue = selectedSound.startsWith(CLIP_PREFIX)
    && !clips.some((clip) => `${CLIP_PREFIX}${clip.id}` === selectedSound)
    ? ''
    : selectedSound;
  const isLive = source.kind === 'microphone';
  const isSounding = source.kind !== 'idle';

  frozenRef.current = frozen;
  reducedMotionRef.current = reducedMotion;
  panRef.current = panColumns;

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  const paintColumns = useCallback(
    (
      image: ImageData,
      startColumn: number,
      columnCount: number,
      frame: Uint8Array,
      fromMin: number,
      fromMax: number,
    ) => {
      const plan = planRef.current;
      const ramp = rampRef.current;
      if (!plan || !ramp) return;

      const pixels = image.data;
      const stride = image.width;
      const startPx = startColumn * COLUMN_PX;
      const widthPx = columnCount * COLUMN_PX;

      for (let row = 0; row < PLOT_ROWS; row += 1) {
        const raw = sampleRow(frame, plan, row);
        const byte = renormalizeByte(raw, fromMin, fromMax, floorDb, DEFAULT_MAX_DECIBELS);
        const offset = clamp(Math.round(byte), 0, 255) * 3;
        const r = ramp[offset];
        const g = ramp[offset + 1];
        const b = ramp[offset + 2];

        for (let column = 0; column < widthPx; column += 1) {
          const index = (row * stride + startPx + column) * 4;
          pixels[index] = r;
          pixels[index + 1] = g;
          pixels[index + 2] = b;
          pixels[index + 3] = 255;
        }
      }
    },
    [floorDb],
  );

  const fillBackground = useCallback((image: ImageData) => {
    const [r, g, b] = backgroundRef.current;
    const pixels = image.data;
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }, []);

  /**
   * Repaint every retained column.
   *
   * Because the raw frames are kept rather than only their pixels, switching
   * the axis or the theme genuinely re-projects the history instead of
   * stretching a bitmap. Costs a few milliseconds, and only ever runs on a
   * deliberate change.
   */
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const history = historyRef.current;
    const scratch = scratchRef.current;
    if (!canvas || !context || !history || !scratch) return;

    fillBackground(scratch);
    // The newest column shown is `panRef` back from the newest retained.
    const newest = history.length - 1 - panRef.current;
    for (let column = 0; column < PLOT_COLUMNS; column += 1) {
      const index = newest - (PLOT_COLUMNS - 1 - column);
      if (index < 0 || index >= history.length) continue;
      const range = history.rangeAt(index);
      paintColumns(scratch, column, 1, history.frameAt(index), range.minDb, range.maxDb);
    }
    context.putImageData(scratch, 0, 0);
  }, [fillBackground, paintColumns]);

  // -------------------------------------------------------------------------
  // Buffers that depend on the analyser's shape
  // -------------------------------------------------------------------------

  useEffect(() => {
    const binCount = fftSize / 2;
    spectrumRef.current = new Uint8Array(new ArrayBuffer(binCount));
    waveformRef.current = new Uint8Array(new ArrayBuffer(fftSize));
    historyRef.current = createSpectrogramHistory(HISTORY_COLUMNS, binCount);
    tracksRef.current = [];
    if (graphRef.current) graphRef.current.analyser.fftSize = fftSize;
  }, [fftSize]);

  useEffect(() => {
    planRef.current = buildRowBinPlan({
      rows: PLOT_ROWS,
      binCount: fftSize / 2,
      sampleRate,
      fftSize,
      minHz: MIN_FREQUENCY_HZ,
      maxHz,
      scale,
    });
    redrawAll();
  }, [fftSize, sampleRate, maxHz, scale, redrawAll]);

  useEffect(() => {
    if (graphRef.current) graphRef.current.analyser.minDecibels = floorDb;
    redrawAll();
  }, [floorDb, redrawAll]);

  // -------------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.width = PLOT_WIDTH_PX;
    canvas.height = PLOT_ROWS;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    scratchRef.current = context.createImageData(PLOT_WIDTH_PX, PLOT_ROWS);

    const applyTheme = () => {
      const background = cssColorToRgb(getCssColor('--surface-plot', '#ffffff'), [255, 255, 255]);
      backgroundRef.current = background;
      rampRef.current = buildSpectrogramRamp({
        background,
        cool: cssColorToRgb(getCssColor('--accent-blue', '#3b82f6'), [59, 130, 246]),
        warm: cssColorToRgb(getCssColor('--accent-red', '#ef4444'), [239, 68, 68]),
        ink: cssColorToRgb(getCssColor('--text-primary', '#111827'), [17, 24, 39]),
      });
      setRampVersion((version) => version + 1);
      redrawAll();
    };

    applyTheme();
    return onThemeChange(applyTheme);
  }, [redrawAll]);

  // -------------------------------------------------------------------------
  // Container width and reduced motion
  // -------------------------------------------------------------------------

  /**
   * The overlay's geometry is this measurement, so it cannot be allowed to go
   * stale. ResizeObserver is the right tool but it is not the only one used:
   * an environment that never delivers a callback would leave the gridlines
   * drawn for the wrong size, which is worse than a little redundancy.
   */
  const measurePlotBox = useCallback(() => {
    const element = plotBoxRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setPlotBox((current) =>
      Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
        ? current
        : { width: rect.width, height: rect.height },
    );
  }, []);

  useEffect(() => {
    const element = plotBoxRef.current;
    if (!element) return undefined;

    measurePlotBox();
    window.addEventListener('resize', measurePlotBox);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePlotBox) : null;
    observer?.observe(element);

    return () => {
      window.removeEventListener('resize', measurePlotBox);
      observer?.disconnect();
    };
  }, [measurePlotBox]);

  // Entering or leaving fullscreen changes the plot's height without
  // necessarily firing a window resize, so re-measure once the new layout has
  // settled rather than waiting to be told.
  useEffect(() => {
    const id = window.setTimeout(measurePlotBox, 0);
    const frame = window.requestAnimationFrame(measurePlotBox);
    return () => {
      window.clearTimeout(id);
      window.cancelAnimationFrame(frame);
    };
  }, [isFullscreen, measurePlotBox]);

  // Fullscreen is where the plot stops being aspect-locked and fills the
  // window, so the island has to know about it. Both routes are covered: the
  // real Fullscreen API, and the class SimulationBlock falls back to.
  useEffect(() => {
    const shell = frameRef.current?.closest('[data-simulation-block]');
    if (!shell) return undefined;

    const sync = () =>
      setIsFullscreen(
        document.fullscreenElement === shell || shell.classList.contains('is-fallback-fullscreen'),
      );

    document.addEventListener('fullscreenchange', sync);
    const observer = new MutationObserver(sync);
    observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
    sync();

    return () => {
      document.removeEventListener('fullscreenchange', sync);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReducedMotion(query.matches);
      // Switched on mid-session: stop the scrolling now rather than waiting to
      // be asked. On mount there is nothing playing yet, so nothing to freeze.
      if (query.matches) setFrozen(true);
    };
    setReducedMotion(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // -------------------------------------------------------------------------
  // The render loop
  // -------------------------------------------------------------------------

  // Leaving Freeze snaps back to the live edge; there is nothing sensible a
  // scrolling display can do with a pan offset.
  useEffect(() => {
    if (!frozen) setPanColumns(0);
  }, [frozen]);

  // The one place a pan is painted.
  useEffect(() => {
    redrawAll();
  }, [panColumns, redrawAll]);

  // Frozen, the measurements describe whatever sits at the right edge, so
  // sliding the picture re-measures it. The live loop is not writing then
  // (it skips frozen frames), so nothing else is competing for these.
  useEffect(() => {
    if (!frozen) return;
    const history = historyRef.current;
    if (!history) return;
    const stable = peaksAtHistoryColumn(history, history.length - 1 - panColumns, {
      sampleRate,
      fftSize,
      maxHz,
      maxPeaks: 6,
      strideColumns: ANALYSIS_STRIDE_COLUMNS,
    });
    setPeaks(stable);
    setFundamental(estimateFundamental(stable));
  }, [frozen, panColumns, sampleRate, fftSize, maxHz]);

  useEffect(() => {
    if (!isSounding) return undefined;

    const step = () => {
      const graph = graphRef.current;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      const history = historyRef.current;
      const scratch = scratchRef.current;

      if (graph && canvas && context && history && scratch && !frozenRef.current) {
        const frame = spectrumRef.current;
        graph.analyser.getByteFrequencyData(frame);

        const now = graph.context.currentTime;
        const elapsed = now - lastColumnTimeRef.current;
        // Catching up by at most a few columns means a dropped frame shows as
        // a small stutter rather than wiping a quarter of the display.
        const maxHops = reducedMotionRef.current ? 1 : 4;
        const hops = clamp(Math.round(elapsed / HOP_SECONDS), 1, maxHops);

        for (let hop = 0; hop < hops; hop += 1) {
          history.push(frame, now - (hops - 1 - hop) * HOP_SECONDS, floorDb, DEFAULT_MAX_DECIBELS);
        }
        lastColumnTimeRef.current = now;

        const shift = hops * COLUMN_PX;
        context.drawImage(
          canvas,
          shift, 0, PLOT_WIDTH_PX - shift, PLOT_ROWS,
          0, 0, PLOT_WIDTH_PX - shift, PLOT_ROWS,
        );
        paintColumns(scratch, 0, hops, frame, floorDb, DEFAULT_MAX_DECIBELS);
        context.putImageData(scratch, PLOT_WIDTH_PX - shift, 0, 0, 0, shift, PLOT_ROWS);

        const stamp = performance.now();
        if (stamp - lastAnalysisRef.current >= ANALYSIS_INTERVAL_MS) {
          lastAnalysisRef.current = stamp;

          // Time-domain RMS, so "is any sound arriving at all?" has an answer
          // that does not depend on seeing something in the picture.
          const wave = waveformRef.current;
          graph.analyser.getByteTimeDomainData(wave);
          let sum = 0;
          for (let i = 0; i < wave.length; i += 1) {
            const deviation = (wave[i] - 128) / 128;
            sum += deviation * deviation;
          }
          const rms = Math.sqrt(sum / wave.length);
          setInputLevelDb(rms > 1e-6 ? 20 * Math.log10(rms) : null);

          const raw = findSpectralPeaks(frame, { sampleRate, fftSize, maxHz, maxPeaks: 6 });
          tracksRef.current = stabilizePeaks(tracksRef.current, raw);
          const stable = confirmedPeaks(tracksRef.current);
          setPeaks(stable);
          setFundamental(estimateFundamental(stable));

          if (stamp - lastLiveRef.current >= LIVE_REGION_INTERVAL_MS) {
            lastLiveRef.current = stamp;
            setLiveMessage(describePeaks(stable));
          }
        }
      }

      rafRef.current = window.requestAnimationFrame(step);
    };

    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isSounding, fftSize, sampleRate, maxHz, floorDb, paintColumns]);

  // -------------------------------------------------------------------------
  // Audio sources
  // -------------------------------------------------------------------------

  const ensureGraph = useCallback(async (preferredSampleRate?: number): Promise<SpectrogramGraph | null> => {
    if (!graphRef.current) {
      const graph = createSpectrogramGraph({
        fftSize,
        minDecibels: floorDb,
        maxDecibels: DEFAULT_MAX_DECIBELS,
        sampleRate: preferredSampleRate,
      });
      if (!graph) return null;
      graphRef.current = graph;
      setSampleRate(graph.context.sampleRate);
    }
    await resumeGraph(graphRef.current);
    lastColumnTimeRef.current = graphRef.current.context.currentTime;
    return graphRef.current;
  }, [fftSize, floorDb]);

  const stopActiveSource = useCallback(() => {
    activeSourceRef.current?.stop();
    activeSourceRef.current = null;
  }, []);

  // The privacy contract, enforced in one place: every transition out of the
  // microphone stops the tracks, which is what turns the recording indicator
  // off. Disconnecting the node alone would leave it lit.
  useEffect(() => {
    const previous = previousSourceRef.current;
    previousSourceRef.current = source;
    if (shouldReleaseMicrophone(previous, source)) {
      stopTrackWatchRef.current?.();
      stopTrackWatchRef.current = null;
      micNodeRef.current?.disconnect();
      micNodeRef.current = null;
      releaseMicrophone(micStreamRef.current);
      micStreamRef.current = null;
      setMicSilent(false);
    }
    if (source.kind === 'idle') setInputLevelDb(null);
    if (graphRef.current) {
      // Never route the microphone to the speakers. That is an instant howl.
      graphRef.current.monitor.gain.value = source.kind === 'microphone' ? 0 : 1;
    }
  }, [source]);

  // Microphones vary enormously, and a laptop's built-in one with the browser's
  // processing turned off can sit far below the display floor. The boost is
  // applied only to the microphone; the example sounds already arrive at a
  // known level and would only clip.
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.input.gain.value =
      source.kind === 'microphone' ? 10 ** (micGainDb / 20) : 1;
  }, [micGainDb, source.kind]);

  const resetDisplay = useCallback(() => {
    historyRef.current?.clear();
    tracksRef.current = [];
    setPeaks([]);
    setFundamental(null);
    commitProbe(null);
    setFrozen(false);
    setPanColumns(0);
    redrawAll();
  }, [commitProbe, redrawAll]);

  const useMicrophone = useCallback(async () => {
    stopActiveSource();
    dispatch({ type: 'request-mic' });

    // The stream comes first, and the AudioContext is built around its sample
    // rate. Creating the context first and attaching the microphone to it
    // afterwards is the classic way to end up with a connected-but-permanently
    // silent MediaStreamAudioSourceNode when the capture device runs at a
    // different rate from the output device.
    const result = await requestMicrophone();
    if (!result.ok) {
      dispatch({ type: 'mic-failed', reason: result.reason });
      return;
    }

    const graph = await ensureGraph(streamSampleRate(result.stream));
    if (!graph) {
      releaseMicrophone(result.stream);
      dispatch({ type: 'mic-failed', reason: 'unsupported' });
      return;
    }

    micStreamRef.current = result.stream;
    micNodeRef.current = graph.context.createMediaStreamSource(result.stream);
    micNodeRef.current.connect(graph.input);

    stopTrackWatchRef.current?.();
    stopTrackWatchRef.current = watchTrack(result.stream, ({ live, silent }) => {
      setMicSilent(!live || silent);
    });

    resetDisplay();
    dispatch({ type: 'mic-granted' });
  }, [ensureGraph, resetDisplay, stopActiveSource]);

  const playExample = useCallback(async (id: string) => {
    const example = exampleById(id);
    if (!example) return;
    stopActiveSource();
    const graph = await ensureGraph();
    if (!graph) return;
    resetDisplay();
    dispatch({ type: 'select-example', id });
    activeSourceRef.current = startExample(graph, example.spec, example.durationSeconds, () => {
      dispatch({ type: 'source-ended', id });
    });
  }, [ensureGraph, resetDisplay, stopActiveSource]);

  const playClip = useCallback(async (clip: RecordedClip) => {
    stopActiveSource();
    const graph = await ensureGraph();
    if (!graph) return;

    let buffer = clipCacheRef.current.get(clip.id) ?? null;
    if (!buffer) {
      setClipLoading(clip.id);
      buffer = await loadClip(graph.context, clipUrl(clip));
      setClipLoading(null);
      if (!buffer) {
        dispatch({ type: 'clip-failed', id: clip.id });
        return;
      }
      clipCacheRef.current.set(clip.id, buffer);
    }

    resetDisplay();
    dispatch({ type: 'select-clip', id: clip.id });
    activeSourceRef.current = playBuffer(graph, buffer, () => {
      dispatch({ type: 'source-ended', id: clip.id });
    });
  }, [ensureGraph, resetDisplay, stopActiveSource]);

  const playSound = useCallback((value: string) => {
    if (value.startsWith(CLIP_PREFIX)) {
      const clip = clips.find((candidate) => `${CLIP_PREFIX}${candidate.id}` === value);
      if (clip) void playClip(clip);
    } else if (value) {
      void playExample(value);
    }
  }, [clips, playClip, playExample]);

  const stopEverything = useCallback(() => {
    stopActiveSource();
    dispatch({ type: 'stop' });
  }, [stopActiveSource]);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    activeSourceRef.current?.stop();
    stopTrackWatchRef.current?.();
    micNodeRef.current?.disconnect();
    releaseMicrophone(micStreamRef.current);
    micStreamRef.current = null;
    closeSpectrogramGraph(graphRef.current);
    graphRef.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Probe
  // -------------------------------------------------------------------------

  const readProbe = useCallback((point: Probe) => {
    const history = historyRef.current;
    const plan = planRef.current;
    const frequencyHz = rowToFrequency(point.row, MIN_FREQUENCY_HZ, maxHz, scale, PLOT_ROWS);
    const secondsAgo = (PLOT_COLUMNS - 1 - point.column + panColumns) * HOP_SECONDS;

    let decibels: number | null = null;
    if (history && plan && history.length > 0) {
      const index = history.length - 1 - panColumns - (PLOT_COLUMNS - 1 - point.column);
      if (index >= 0 && index < history.length) {
        const range = history.rangeAt(index);
        const raw = sampleRow(history.frameAt(index), plan, Math.round(point.row));
        decibels = byteToDecibels(raw, range.minDb, range.maxDb);
      }
    }
    return { frequencyHz, secondsAgo, decibels };
  }, [maxHz, scale, panColumns]);

  const probeReading = probe ? readProbe(probe) : null;

  const probeFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>): Probe | null => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    const x = clamp((event.clientX - box.left) / box.width, 0, 1);
    const y = clamp((event.clientY - box.top) / box.height, 0, 1);
    return {
      column: clamp(Math.round(x * (PLOT_COLUMNS - 1)), 0, PLOT_COLUMNS - 1),
      row: clamp(y * (PLOT_ROWS - 1), 0, PLOT_ROWS - 1),
      pinned: event.pointerType === 'touch',
    };
  }, []);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.startX;
      if (Math.abs(dx) > 3) drag.moved = true;
      // Dragging right reaches backwards, the way a filmstrip would move.
      setPanColumns(clamp(Math.round(drag.startPan + dx * columnsPerPixel), 0, maxPan));
      return;
    }
    // A finger covers the point it is measuring, so touch pins on tap instead
    // of tracking the drag.
    if (!showMeasurements || event.pointerType === 'touch') return;
    if (probeRef.current?.pinned) return;
    const next = probeFromPointer(event);
    if (next) commitProbe(next);
  };

  // Far enough back that the oldest retained column reaches the right edge,
  // where the measurements read from. A sound shorter than the display can
  // still be slid across it; the empty time before it just shows as blank.
  const maxPan = Math.max(0, (historyRef.current?.length ?? 0) - 1);
  /** Display columns per CSS pixel, for turning a drag into a pan. */
  const columnsPerPixel = PLOT_COLUMNS / Math.max(layout.plot.w, 1);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (frozen) {
      // Frozen, the drag belongs to the picture. A press that turns out not to
      // move still sets the cursor on pointerup, so a plain click keeps working.
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startPan: panColumns,
        moved: false,
      };
      // Capture keeps the drag alive past the edge of the plot, but it throws
      // if the pointer has already gone, and losing it is not worth failing
      // the gesture over.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Drag still works, it just stops at the edge.
      }
      return;
    }
    if (!showMeasurements) return;
    const next = probeFromPointer(event);
    if (next) commitProbe(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Already released with the pointer.
    }
    if (!drag.moved && showMeasurements) {
      const next = probeFromPointer(event);
      if (next) commitProbe({ ...next, pinned: true });
    }
  };

  const handlePointerLeave = () => {
    if (dragRef.current) return;
    if (!probeRef.current?.pinned) commitProbe(null);
  };

  const announceProbe = useCallback((point: Probe) => {
    const reading = readProbe(point);
    const note = noteFromFrequency(reading.frequencyHz);
    const level = reading.decibels === null ? 'no data' : formatDecibels(reading.decibels);
    setProbeMessage(
      `${Math.round(reading.frequencyHz)} hertz${note ? `, ${note.name}` : ''}, ` +
      `${reading.secondsAgo.toFixed(1)} seconds ago, ${level}.`,
    );
  }, [readProbe]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!showMeasurements) return;
    const current: Probe = probeRef.current
      ?? { column: PLOT_COLUMNS - 1, row: PLOT_ROWS / 2, pinned: true };
    const octaveRows = (PLOT_ROWS - 1) / Math.log2(maxHz / MIN_FREQUENCY_HZ);
    const semitoneRows = scale === 'log' ? octaveRows / 12 : 4;
    const columnsPerTenth = Math.round(0.1 / HOP_SECONDS);
    let next: Probe | null = null;

    switch (event.key) {
      case 'ArrowUp':
        next = { ...current, row: current.row - (event.shiftKey ? semitoneRows * 12 : semitoneRows) };
        break;
      case 'ArrowDown':
        next = { ...current, row: current.row + (event.shiftKey ? semitoneRows * 12 : semitoneRows) };
        break;
      case 'ArrowLeft':
        next = { ...current, column: current.column - (event.shiftKey ? columnsPerTenth * 10 : columnsPerTenth) };
        break;
      case 'ArrowRight':
        next = { ...current, column: current.column + (event.shiftKey ? columnsPerTenth * 10 : columnsPerTenth) };
        break;
      case 'Home':
        next = { ...current, row: PLOT_ROWS - 1 };
        break;
      case 'End':
        next = { ...current, row: 0 };
        break;
      case 'PageUp':
        next = { ...current, column: 0 };
        break;
      case 'PageDown':
        next = { ...current, column: PLOT_COLUMNS - 1 };
        break;
      case 'Enter':
      case 'p':
        next = { ...current, pinned: !current.pinned };
        break;
      case 'Escape':
        commitProbe(null);
        setProbeMessage('Cursor cleared.');
        return;
      default:
        return;
    }

    // Only swallow the keys we actually handle, so the page still scrolls.
    event.preventDefault();

    // Walking the cursor off either edge of a frozen display drags the view
    // instead of stopping dead, so the keyboard reaches the same history the
    // mouse can drag to.
    if (frozen) {
      let pan = panRef.current;
      if (next.column < 0) pan += -next.column;
      else if (next.column > PLOT_COLUMNS - 1) pan -= next.column - (PLOT_COLUMNS - 1);
      pan = clamp(pan, 0, maxPan);
      if (pan !== panRef.current) setPanColumns(pan);
    }

    const clamped: Probe = {
      column: clamp(Math.round(next.column), 0, PLOT_COLUMNS - 1),
      row: clamp(next.row, 0, PLOT_ROWS - 1),
      pinned: next.pinned,
    };
    commitProbe(clamped);
    announceProbe(clamped);
  };

  // -------------------------------------------------------------------------
  // Overlay geometry
  // -------------------------------------------------------------------------

  const frequencyTicks = useMemo(
    () => buildFrequencyTicks({ minHz: MIN_FREQUENCY_HZ, maxHz, scale, rows: layout.plot.h,
      minRowGap: layout.compact ? 26 : 20 }),
    [maxHz, scale, layout.plot.h, layout.compact],
  );
  const timeTicks = useMemo(
    () => buildTimeTicks({ columns: PLOT_COLUMNS, hopSeconds: HOP_SECONDS,
      spacingSeconds: layout.compact ? 2 : 1, offsetSeconds: panColumns * HOP_SECONDS }),
    [layout.compact, panColumns],
  );

  /** Frequency to a y offset inside the plot, in pixels. */
  const rowFor = useCallback(
    (hz: number) => frequencyToRow(hz, MIN_FREQUENCY_HZ, maxHz, scale, layout.plot.h),
    [maxHz, scale, layout.plot.h],
  );

  /**
   * A label sits at its frequency unless it would collide. The gap is one line
   * of text plus a little air - the old 2.2x font size reserved room for two
   * lines that were never there, which bent leader lines that had no need to
   * bend.
   */
  const peakLabels = useMemo(() => {
    const rows = peaks.map((peak) => rowFor(peak.frequencyHz));
    const placed = placeLabels(rows, layout.fontSize * 1.35, 0, layout.plot.h);
    return peaks.map((peak, index) => ({
      hz: peak.frequencyHz,
      row: rows[index],
      labelY: placed[index],
    }));
  }, [peaks, rowFor, layout.fontSize, layout.plot.h]);

  const legendStops = useMemo(() => {
    const ramp = rampRef.current;
    if (!ramp) return [];
    return Array.from({ length: 9 }, (_, index) => {
      const byte = Math.round((index / 8) * 255);
      const [r, g, b] = rampColorAt(ramp, byte);
      return { offset: `${(index / 8) * 100}%`, color: `rgb(${r}, ${g}, ${b})` };
    });
    // The ramp itself lives in a ref because the render loop reads it every
    // frame; `rampVersion` is what tells React the colors changed.
  }, [rampVersion]);

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  const canvasLabel =
    `Spectrogram. Frequency runs from ${Math.round(MIN_FREQUENCY_HZ)} hertz at the bottom to ` +
    `${formatFrequencyLabel(maxHz)} hertz at the top on a ${scale === 'log' ? 'logarithmic' : 'linear'} scale. ` +
    `Time scrolls right to left over the last ${(PLOT_COLUMNS * HOP_SECONDS).toFixed(0)} seconds.`;

  const statusMessage = sourceStatusMessage(source);
  const insecure = micSupport !== 'ok';

  const windowOptions = FFT_SIZES.map((size) => ({
    value: String(size),
    label: `${size} - ${binBandwidth(sampleRate, size).toFixed(1)} Hz bins, ${(windowSeconds(size, sampleRate) * 1000).toFixed(0)} ms`,
  }));

  // -60 dBFS is a quiet room, -6 is close to clipping.
  const inputMeterPercent =
    inputLevelDb === null ? 0 : clamp(((inputLevelDb + 60) / 54) * 100, 0, 100);

  // The canvas stretches to the plot rect, so a column or a canvas row is
  // placed by its fraction of the way across or down, never by raw pixels.
  const toPlotX = (column: number) =>
    layout.plot.x + (column / (PLOT_COLUMNS - 1)) * layout.plot.w;
  const toPlotY = (offset: number) => layout.plot.y + offset;
  const rowToPlotY = (row: number) =>
    layout.plot.y + (row / (PLOT_ROWS - 1)) * layout.plot.h;

  return (
    <div
      ref={frameRef}
      className={`flex flex-col gap-4 px-4 sm:px-6 ${isFullscreen ? 'h-full py-3' : 'py-5'}`}
    >
      {/* Sources ------------------------------------------------------- */}
      {/* Shares the top line with the Exit Fullscreen button, so it keeps
          clear of the corner rather than reserving a band beneath it. */}
      <ControlBar align="start" className={isFullscreen ? 'pr-28' : ''}>
        {isLive ? (
          /* Live, the row belongs to the microphone: the example picker would
             only be a way to interrupt it, and Stop already does that. */
          <>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-red)]">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent-red)]" />
              Microphone is on
            </span>
            <Button variant="secondary" onClick={stopEverything}>
              Stop
            </Button>
            <Slider
              label="Boost"
              unit="dB"
              min={0}
              max={36}
              step={3}
              value={micGainDb}
              onChange={setMicGainDb}
              ariaLabel="Microphone boost in decibels"
            />
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="font-medium">Input</span>
              <span
                aria-hidden="true"
                className="inline-block h-2 w-24 overflow-hidden rounded-full bg-[var(--surface-elevated)] ring-1 ring-[var(--grid-line)]"
              >
                <span
                  className="block h-full bg-[var(--accent-green)] transition-[width] duration-100"
                  style={{ width: `${inputMeterPercent}%` }}
                />
              </span>
              <span className="min-w-[7ch] font-mono tabular-nums text-[var(--text-muted)]">
                {inputLevelDb === null ? 'silent' : formatDecibels(inputLevelDb)}
              </span>
            </span>
          </>
        ) : (
          <>
            <Button onClick={useMicrophone} disabled={insecure || source.micPermission === 'prompting'}>
              Use microphone
            </Button>

            <Select
              ariaLabel="Example sound"
              value={pickerValue}
              onChange={(value) => {
                setSelectedSound(value);
                playSound(value);
              }}
              options={[
                { value: '', label: 'Choose an example' },
                ...SYNTH_EXAMPLES.map((example) => ({ value: example.id, label: example.label })),
                ...clips.map((clip) => ({
                  value: `${CLIP_PREFIX}${clip.id}`,
                  label: clipLoading === clip.id ? `${clip.label} (loading...)` : clip.label,
                })),
              ]}
            />
            <Button
              variant="secondary"
              onClick={() => playSound(pickerValue)}
              disabled={pickerValue === ''}
            >
              Play
            </Button>

            {isSounding && (
              <Button variant="secondary" onClick={stopEverything}>
                Stop
              </Button>
            )}
          </>
        )}
      </ControlBar>

      {statusMessage && (
        <p role="status" className="type-supporting m-0 max-w-prose">
          {statusMessage}
        </p>
      )}
      {insecure && !statusMessage && (
        <p role="status" className="type-supporting m-0 max-w-prose">
          The microphone needs a secure (https) connection. The example sounds work here.
        </p>
      )}

      {isLive && (micSilent || inputLevelDb === null) && (
        <p role="status" className="type-supporting m-0 max-w-prose">
          {micSilent
            ? 'The microphone is connected but is not sending any audio. Windows may have it muted, or another app may have taken exclusive control of it. Check the input device in your sound settings.'
            : 'No sound is reaching the page yet. Try speaking or whistling, raise the mic boost, or check that the right input device is selected in your browser and system settings.'}
        </p>
      )}

      {statusMessage && (
        <p role="status" className="type-supporting m-0 max-w-prose">
          {statusMessage}
        </p>
      )}
      {insecure && !statusMessage && (
        <p role="status" className="type-supporting m-0 max-w-prose">
          The microphone needs a secure (https) connection. The example sounds work here.
        </p>
      )}

      {/* Plot ----------------------------------------------------------- */}
      <div
        ref={plotBoxRef}
        className="relative w-full"
        style={
          isFullscreen
            // Fullscreen is a request for room: take whatever height is left
            // rather than staying locked to one shape.
            ? { flex: '1 1 auto', minHeight: '10rem' }
            : { aspectRatio: String(layout.compact ? COMPACT_PLOT_ASPECT : DEFAULT_PLOT_ASPECT) }
        }
      >
        <div
          ref={plotRef}
          role="img"
          aria-label={`${canvasLabel} ${PROBE_INSTRUCTIONS}`}
          tabIndex={0}
          className="absolute overflow-hidden rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sim-bg)]"
          style={{
            left: `${layout.plot.x}px`,
            top: `${layout.plot.y}px`,
            width: `${layout.plot.w}px`,
            height: `${layout.plot.h}px`,
            // Only the plot: applying this to the island would trap the page
            // scroll on a phone.
            touchAction: showMeasurements || frozen ? 'none' : 'auto',
            cursor: frozen ? (dragRef.current ? 'grabbing' : 'grab') : 'default',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
        >
          <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
        </div>

        {!isSounding && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="type-supporting m-0 rounded-[var(--radius-control)] bg-[var(--surface-elevated)] px-3 py-2 text-center">
              Turn on the microphone, or play an example sound.
            </p>
          </div>
        )}

        <svg
          viewBox={layout.viewBox}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {showMeasurements && (
            <>
              <defs>
                <linearGradient id="spectrogram-legend" x1="0" y1="1" x2="0" y2="0">
                  {legendStops.map((stop) => (
                    <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
                  ))}
                </linearGradient>
              </defs>

              {/* Frequency gridlines and labels */}
              {frequencyTicks.map((tick) => (
                <g key={`f-${tick.hz}`}>
                  <line
                    x1={layout.plot.x}
                    x2={layout.plot.x + layout.plot.w}
                    y1={toPlotY(tick.row)}
                    y2={toPlotY(tick.row)}
                    stroke="var(--grid-line)"
                    strokeWidth={1}
                    opacity={tick.emphasis === 'major' ? 0.35 : 0.18}
                  />
                  <text
                    x={layout.plot.x - 6}
                    y={toPlotY(tick.row)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={layout.fontSize}
                    fill="var(--text-muted)"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Time ticks */}
              {timeTicks.map((tick) => (
                <g key={`t-${tick.secondsAgo}`}>
                  <line
                    x1={toPlotX(tick.column)}
                    x2={toPlotX(tick.column)}
                    y1={layout.plot.y}
                    y2={layout.plot.y + layout.plot.h}
                    stroke="var(--grid-line)"
                    strokeWidth={1}
                    strokeDasharray="3 5"
                    opacity={0.22}
                  />
                  <text
                    x={toPlotX(tick.column)}
                    y={layout.plot.y + layout.plot.h + layout.fontSize + 4}
                    textAnchor={tick.secondsAgo === 0 ? 'end' : 'middle'}
                    fontSize={layout.fontSize}
                    fill={tick.secondsAgo === 0 ? 'var(--text-primary)' : 'var(--text-muted)'}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}


              {/* Peak labels */}
              {peakLabels.map((peak) => {
                const note = noteFromFrequency(peak.hz);
                return (
                  <g key={`p-${peak.hz.toFixed(1)}`}>
                    <line
                      x1={layout.plot.x + layout.plot.w}
                      x2={layout.plot.x + layout.plot.w + 6}
                      y1={toPlotY(peak.row)}
                      y2={toPlotY(peak.labelY)}
                      stroke="var(--text-muted)"
                      strokeWidth={1}
                      opacity={0.6}
                    />
                    <text
                      x={layout.plot.x + layout.plot.w + 9}
                      y={toPlotY(peak.labelY)}
                      dominantBaseline="middle"
                      fontSize={layout.fontSize}
                      fill="var(--text-primary)"
                    >
                      {formatFrequencyLabel(peak.hz)}
                      {showNoteNames && note ? ` ${formatNote(note)}` : ''}
                    </text>
                  </g>
                );
              })}

              {/* Cursor probe */}
              {probe && (
                <g>
                  <line
                    x1={layout.plot.x}
                    x2={layout.plot.x + layout.plot.w}
                    y1={rowToPlotY(probe.row)}
                    y2={rowToPlotY(probe.row)}
                    stroke="var(--accent-green)"
                    strokeWidth={1}
                  />
                  <line
                    x1={toPlotX(probe.column)}
                    x2={toPlotX(probe.column)}
                    y1={layout.plot.y}
                    y2={layout.plot.y + layout.plot.h}
                    stroke="var(--accent-green)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={toPlotX(probe.column)}
                    cy={rowToPlotY(probe.row)}
                    r={3.5}
                    fill="var(--accent-green)"
                  />
                </g>
              )}

              {/* Level legend */}
              {layout.showLegendGutter && (
                <g>
                  <rect
                    x={layout.legendX}
                    y={layout.plot.y + 12}
                    width={10}
                    height={layout.plot.h - 24}
                    fill="url(#spectrogram-legend)"
                    stroke="var(--grid-line)"
                    strokeWidth={0.5}
                  />
                  <text
                    x={layout.legendX + 14}
                    y={layout.plot.y + 12}
                    textAnchor="start"
                    fontSize={layout.fontSize - 1}
                    fill="var(--text-muted)"
                  >
                    {DEFAULT_MAX_DECIBELS} dB
                  </text>
                  <text
                    x={layout.legendX + 14}
                    y={layout.plot.y + layout.plot.h - 14}
                    textAnchor="start"
                    fontSize={layout.fontSize - 1}
                    fill="var(--text-muted)"
                  >
                    {floorDb} dB
                  </text>
                </g>
              )}
            </>
          )}
        </svg>
      </div>

      {/* Display controls ----------------------------------------------- */}
      <ControlBar align="start">
        <Toggle label="Measurements" checked={showMeasurements} onChange={setShowMeasurements} />
        {showMeasurements && (
          <Toggle label="Note names" checked={showNoteNames} onChange={setShowNoteNames} />
        )}
        <Select
          label="Frequency"
          value={scale}
          onChange={(value) => setScale(value as FrequencyScale)}
          options={[
            { value: 'log', label: 'Logarithmic' },
            { value: 'linear', label: 'Linear' },
          ]}
        />
        <Select
          label="Window"
          value={String(fftSize)}
          onChange={(value) => setFftSize(Number(value) as FftSize)}
          options={windowOptions}
        />
        <Slider
          label="Floor"
          unit="dB"
          min={-110}
          max={-50}
          step={5}
          value={floorDb}
          onChange={setFloorDb}
          ariaLabel="Display noise floor in decibels"
        />
        <Button
          variant={reducedMotion ? 'primary' : 'secondary'}
          aria-pressed={frozen}
          onClick={() => setFrozen((current) => !current)}
        >
          {frozen ? 'Resume' : 'Freeze'}
        </Button>
      </ControlBar>

      {/* Readouts -------------------------------------------------------- */}
      {showMeasurements && (
        <div className="rounded-[var(--radius-control)] border border-theme-grid bg-[var(--bg-primary)] px-3 py-2">
          {/* Fixed-width sections and tabular digits, so a changing value never
              shoves its neighbours along. Fundamental keeps its slot even when
              there is no confident estimate. */}
          <Readout variant="inline" className="tabular-nums">
            <Readout.Group label="Loudest" className="w-[27ch] max-w-full">
              {peaks.length === 0 ? (
                <span className="text-[var(--text-muted)]">no clear peak</span>
              ) : (
                <Readout.Value
                  label="f"
                  value={formatFrequencyLabel(peaks[0].frequencyHz)}
                  unit={(() => {
                    const note = noteFromFrequency(peaks[0].frequencyHz);
                    return note ? `Hz · ${formatNote(note)}` : 'Hz';
                  })()}
                />
              )}
            </Readout.Group>

            <Readout.Group label="Fundamental" className="w-[23ch] max-w-full">
              {fundamental && fundamental.confidence >= 0.5 ? (
                <Readout.Value
                  label={SUBSCRIPT_ONE}
                  value={formatFrequencyLabel(fundamental.frequencyHz)}
                  unit="Hz"
                />
              ) : (
                <span className="text-[var(--text-muted)]">--</span>
              )}
            </Readout.Group>

            <Readout.Group label="Cursor" className="min-w-0 flex-1">
              {probeReading ? (
                <>
                  <span className="inline-block w-[11ch]">
                    <Readout.Value label="f" value={Math.round(probeReading.frequencyHz)} unit="Hz" />
                  </span>
                  <span className="inline-block w-[11ch]">
                    <Readout.Value label="t" value={`-${probeReading.secondsAgo.toFixed(2)}`} unit="s" />
                  </span>
                  <span className="inline-block w-[11ch]">
                    <Readout.Value
                      label="L"
                      value={probeReading.decibels === null ? '--' : formatDecibels(probeReading.decibels)}
                    />
                  </span>
                </>
              ) : (
                <span className="text-[var(--text-muted)]">
                  point at the display, or focus it and use the arrow keys
                </span>
              )}
              {probe?.pinned && (
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => commitProbe(null)}
                >
                  clear
                </button>
              )}
            </Readout.Group>
          </Readout>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {probeMessage}
      </p>
    </div>
  );
}
