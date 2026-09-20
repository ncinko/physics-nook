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
  FFT_SIZES,
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
  formatDecibels,
  formatFrequencyLabel,
  formatNote,
  frequencyToRow,
  getSpectrogramLayout,
  harmonicSeries,
  noteFromFrequency,
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
/** A live region updated at frame rate is a screen-reader denial of service. */
const LIVE_REGION_INTERVAL_MS = 800;

const PROBE_INSTRUCTIONS =
  'Turn on measurements, then use the arrow keys to move a cursor and read the frequency, ' +
  'time and level under it. Enter pins the cursor, Escape clears it.';

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

export default function SpectrogramLab() {
  const [source, dispatch] = useReducer(sourceReducer, initialSourceState);
  const [scale, setScale] = useState<FrequencyScale>('log');
  const [fftSize, setFftSize] = useState<FftSize>(DEFAULT_FFT_SIZE);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showNoteNames, setShowNoteNames] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [floorDb, setFloorDb] = useState(DEFAULT_MIN_DECIBELS);
  const [exampleId, setExampleId] = useState(SYNTH_EXAMPLES[0].id);
  const [sampleRate, setSampleRate] = useState(48000);
  const [containerWidth, setContainerWidth] = useState(960);
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

  const frameRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
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

  /** The one way the probe moves: ref first for auto-repeat, then state. */
  const commitProbe = useCallback((next: Probe | null) => {
    probeRef.current = next;
    setProbe(next);
  }, []);

  const maxHz = usableMaxFrequency(sampleRate);
  const layout = useMemo(() => getSpectrogramLayout(containerWidth), [containerWidth]);
  const [viewWidth, viewHeight] = useMemo(() => {
    const parts = layout.viewBox.split(' ').map(Number);
    return [parts[2], parts[3]];
  }, [layout]);

  const micSupport = useMemo(() => microphoneSupport(), []);
  const clips = availableClips(source);
  const isLive = source.kind === 'microphone';
  const isSounding = source.kind !== 'idle';

  frozenRef.current = frozen;
  reducedMotionRef.current = reducedMotion;

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
    for (let index = 0; index < history.length; index += 1) {
      const column = PLOT_COLUMNS - history.length + index;
      if (column < 0) continue;
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
    historyRef.current = createSpectrogramHistory(PLOT_COLUMNS, binCount);
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

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;

    // Measured three ways on purpose. ResizeObserver is the right tool, but it
    // is the only thing deciding whether the layout is compact, and an
    // environment that does not deliver its initial observation would leave the
    // lab stuck at desktop metrics on a phone. The explicit first measurement
    // and the resize listener cost nothing and remove that single point of
    // failure.
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setContainerWidth(width);
    };

    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);

    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
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
    const secondsAgo = (PLOT_COLUMNS - 1 - point.column) * HOP_SECONDS;

    let decibels: number | null = null;
    if (history && plan && history.length > 0) {
      const index = history.length - (PLOT_COLUMNS - point.column);
      if (index >= 0 && index < history.length) {
        const range = history.rangeAt(index);
        const raw = sampleRow(history.frameAt(index), plan, Math.round(point.row));
        decibels = byteToDecibels(raw, range.minDb, range.maxDb);
      }
    }
    return { frequencyHz, secondsAgo, decibels };
  }, [maxHz, scale]);

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
    // A finger covers the point it is measuring, so touch pins on tap instead
    // of tracking the drag.
    if (!showMeasurements || event.pointerType === 'touch') return;
    if (probeRef.current?.pinned) return;
    const next = probeFromPointer(event);
    if (next) commitProbe(next);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!showMeasurements) return;
    const next = probeFromPointer(event);
    if (next) commitProbe(next);
  };

  const handlePointerLeave = () => {
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
    () => buildFrequencyTicks({ minHz: MIN_FREQUENCY_HZ, maxHz, scale, rows: PLOT_ROWS,
      minRowGap: layout.compact ? 30 : 22 }),
    [maxHz, scale, layout.compact],
  );
  const timeTicks = useMemo(
    () => buildTimeTicks({ columns: PLOT_COLUMNS, hopSeconds: HOP_SECONDS,
      spacingSeconds: layout.compact ? 2 : 1 }),
    [layout.compact],
  );

  const rowFor = useCallback(
    (hz: number) => frequencyToRow(hz, MIN_FREQUENCY_HZ, maxHz, scale, PLOT_ROWS),
    [maxHz, scale],
  );

  /** Push labels apart so two close harmonics do not overprint. */
  const peakLabels = useMemo(() => {
    const minGap = layout.fontSize * 2.2;
    const placed: { hz: number; row: number; labelY: number }[] = [];
    for (const peak of [...peaks].sort((a, b) => a.frequencyHz - b.frequencyHz)) {
      const row = rowFor(peak.frequencyHz);
      let labelY = row;
      const previous = placed[placed.length - 1];
      if (previous && previous.labelY - labelY < minGap) labelY = previous.labelY - minGap;
      placed.push({ hz: peak.frequencyHz, row, labelY: clamp(labelY, 0, PLOT_ROWS) });
    }
    return placed;
  }, [peaks, rowFor, layout.fontSize]);

  const harmonics = useMemo(() => {
    if (!fundamental || fundamental.confidence < 0.5) return [];
    return harmonicSeries(fundamental.frequencyHz, maxHz, 10);
  }, [fundamental, maxHz]);

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

  const toPlotX = (column: number) => layout.plot.x + column * COLUMN_PX;
  const toPlotY = (row: number) => layout.plot.y + row;

  return (
    <div ref={frameRef} className="flex flex-col gap-4 px-4 py-5 sm:px-6">
      {/* Sources ------------------------------------------------------- */}
      <ControlBar align="start">
        <Button onClick={useMicrophone} disabled={insecure || source.micPermission === 'prompting'}>
          {isLive ? 'Microphone on' : 'Use microphone'}
        </Button>

        <Select
          label="Example"
          value={exampleId}
          onChange={(value) => {
            setExampleId(value);
            void playExample(value);
          }}
          options={SYNTH_EXAMPLES.map((example) => ({ value: example.id, label: example.label }))}
        />
        <Button variant="secondary" onClick={() => void playExample(exampleId)}>
          Play example
        </Button>

        {clips.length > 0 && (
          <Select
            label="Recording"
            value=""
            onChange={(value) => {
              const clip = clips.find((candidate) => candidate.id === value);
              if (clip) void playClip(clip);
            }}
            options={[
              { value: '', label: clipLoading ? 'Loading...' : 'Choose a recording' },
              ...clips.map((clip) => ({ value: clip.id, label: clip.label })),
            ]}
          />
        )}

        {isSounding && (
          <Button variant="secondary" onClick={stopEverything}>
            Stop
          </Button>
        )}

        {isLive && (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-red)]">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent-red)]" />
            Microphone is on
          </span>
        )}
      </ControlBar>

      {isLive && (
        <ControlBar align="start">
          <Slider
            label="Mic boost"
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
              className="inline-block h-2 w-28 overflow-hidden rounded-full bg-[var(--surface-elevated)] ring-1 ring-[var(--grid-line)]"
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
        </ControlBar>
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
      <div className="relative w-full" style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}>
        <div
          ref={plotRef}
          role="img"
          aria-label={`${canvasLabel} ${PROBE_INSTRUCTIONS}`}
          tabIndex={0}
          className="absolute overflow-hidden rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sim-bg)]"
          style={{
            left: `${(layout.plot.x / viewWidth) * 100}%`,
            top: `${(layout.plot.y / viewHeight) * 100}%`,
            width: `${(layout.plot.w / viewWidth) * 100}%`,
            height: `${(layout.plot.h / viewHeight) * 100}%`,
            // Only the plot: applying this to the island would trap the page
            // scroll on a phone.
            touchAction: showMeasurements ? 'none' : 'auto',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
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

              {/* Harmonic markers, only when the estimate is worth trusting */}
              {!layout.compact && harmonics.map((hz, index) => (
                <g key={`h-${index}`}>
                  <circle
                    cx={layout.plot.x + layout.plot.w - 5}
                    cy={toPlotY(rowFor(hz))}
                    r={4}
                    fill="none"
                    stroke="var(--accent-purple)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={layout.plot.x + layout.plot.w - 14}
                    y={toPlotY(rowFor(hz))}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={layout.fontSize - 1}
                    fill="var(--accent-purple)"
                  >
                    {index === 0 ? 'f' : `${index + 1}f`}
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
                    y1={toPlotY(probe.row)}
                    y2={toPlotY(probe.row)}
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
                    cy={toPlotY(probe.row)}
                    r={3.5}
                    fill="var(--accent-green)"
                  />
                </g>
              )}

              {/* Level legend */}
              {layout.showLegendGutter && (
                <g>
                  <rect
                    x={layout.plot.x + layout.plot.w + 58}
                    y={layout.plot.y + 12}
                    width={10}
                    height={layout.plot.h - 24}
                    fill="url(#spectrogram-legend)"
                    stroke="var(--grid-line)"
                    strokeWidth={0.5}
                  />
                  <text
                    x={layout.plot.x + layout.plot.w + 56}
                    y={layout.plot.y + 12}
                    textAnchor="end"
                    fontSize={layout.fontSize - 1}
                    fill="var(--text-muted)"
                  >
                    {DEFAULT_MAX_DECIBELS} dB
                  </text>
                  <text
                    x={layout.plot.x + layout.plot.w + 56}
                    y={layout.plot.y + layout.plot.h - 14}
                    textAnchor="end"
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
          <Readout variant="inline">
            <Readout.Group label="Loudest">
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

            {fundamental && fundamental.confidence >= 0.5 && (
              <Readout.Group label="Fundamental">
                <Readout.Value
                  label={SUBSCRIPT_ONE}
                  value={formatFrequencyLabel(fundamental.frequencyHz)}
                  unit="Hz"
                />
              </Readout.Group>
            )}

            <Readout.Group label="Cursor">
              {probeReading ? (
                <>
                  <Readout.Value label="f" value={Math.round(probeReading.frequencyHz)} unit="Hz" />
                  <Readout.Value label="t" value={`-${probeReading.secondsAgo.toFixed(2)}`} unit="s" />
                  <Readout.Value
                    label="L"
                    value={probeReading.decibels === null ? '--' : formatDecibels(probeReading.decibels)}
                  />
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
