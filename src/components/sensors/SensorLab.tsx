import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Download, Trash2 } from 'lucide-react';
import {
  AnalysisPlot,
  type PlotPin,
  type PlotSeries,
} from '../kinematics/videoAnalysis/AnalysisPlot';
import { downloadBlob, savePlotWithCaption } from '../kinematics/videoAnalysis/exportPlot';
import { trackColor, trackShape } from '../kinematics/videoAnalysis/trackColors';
import { Button, Select, Toggle } from '../shared/InlineControls';
import Readout from '../shared/Readout';
import AnalysisStrip from './AnalysisStrip';
import AxisPopover from './AxisPopover';
import { copyText } from '../../utils/clipboard';
import { boundsOf, type AxisRange } from '../../lib/sensors/axis';
import {
  computeFit,
  findPeaks,
  integrate,
  sampleFit,
  seriesStats,
  type FitKind,
} from '../../lib/sensors/analysis';
import { serializeSensorRuns, type ExportLayout } from '../../lib/sensors/export';
import { isProbeSupported, runHardwareProbe } from '../../lib/sensors/hardwareProbe';
import {
  createRecorder,
  nextRunLabel,
  tareOffset,
  type Recorder,
  type TriggerMode,
} from '../../lib/sensors/recording';
import type { SensorSource, SensorSourceStatus } from '../../lib/sensors/source';
import { createSimulatedSource } from '../../lib/sensors/simulatedSource';
import type { SensorChannel, SensorRun, TimeRange } from '../../lib/sensors/types';

const STORAGE_KEY = 'physics-nook-sensor-lab-runs-v1';
const MAX_RUNS = 12;
const LIVE_WINDOW_S = 10;
const LIVE_REFRESH_MS = 100;
const PERIOD_S = 0.05;
const MAX_PLOT_POINTS = 700;
const MAX_LIVE_SAMPLES = 12000;

type Mode = 'explore' | 'analyze';

const loadRuns = (): SensorRun[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SensorRun[]) : [];
  } catch {
    return [];
  }
};

const saveRuns = (runs: SensorRun[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* storage full or blocked: runs simply do not persist */
  }
};

const decimate = <T,>(items: T[]): T[] => {
  if (items.length <= MAX_PLOT_POINTS) return items;
  const stride = Math.ceil(items.length / MAX_PLOT_POINTS);
  return items.filter((_, index) => index % stride === 0);
};

const fmt = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const DURATION_OPTIONS = [
  { value: 'manual', label: 'Until I stop' },
  { value: '2', label: '2 s' },
  { value: '5', label: '5 s' },
  { value: '10', label: '10 s' },
  { value: '30', label: '30 s' },
];

const TRIGGER_OPTIONS = [
  { value: 'immediate', label: 'Immediately' },
  { value: 'rising', label: 'Rising through level' },
  { value: 'falling', label: 'Falling through level' },
];

export default function SensorLab() {
  const sourceRef = useRef<SensorSource | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<{ t: number[]; v: Record<string, number[]> }>({ t: [], v: {} });
  const latestRef = useRef<Record<string, number>>({});
  const offsetsRef = useRef<Record<string, number>>({});
  const plotRef = useRef<SVGSVGElement | null>(null);
  const exportMenuRef = useRef<HTMLDetailsElement | null>(null);
  /** Stream time at which the current recording began; null when not recording. */
  const recStartRef = useRef<number | null>(null);

  const [status, setStatus] = useState<SensorSourceStatus>({ kind: 'idle', message: 'Not connected' });
  const [channels, setChannels] = useState<SensorChannel[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [runs, setRuns] = useState<SensorRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState('manual');
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('immediate');
  const [triggerLevel, setTriggerLevel] = useState('1');
  const [overlay, setOverlay] = useState(false);
  const [mode, setMode] = useState<Mode>('explore');
  const [fitRange, setFitRange] = useState<TimeRange | null>(null);
  const [fitKind, setFitKind] = useState<FitKind>('none');
  const [pins, setPins] = useState<PlotPin[]>([]);
  const [openAxis, setOpenAxis] = useState<'x' | 'y' | null>(null);
  const [xRange, setXRange] = useState<AxisRange | null>(null);
  const [yRange, setYRange] = useState<AxisRange | null>(null);
  const [layout, setLayout] = useState<ExportLayout>('wide');
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [probing, setProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState('');
  const [probeText, setProbeText] = useState<string | null>(null);

  useEffect(() => {
    setRuns(loadRuns());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveRuns(runs);
  }, [runs, loaded]);

  useEffect(() => {
    // Ranges are in the channel units; a different channel starts on auto.
    setXRange(null);
    setYRange(null);
    setOpenAxis(null);
  }, [channelId]);

  useEffect(() => {
    // Pins are points on one particular view of one run.
    setPins([]);
  }, [activeRunId, overlay, channelId]);

  const closeAxis = useCallback(() => setOpenAxis(null), []);

  const channel = channels.find((entry) => entry.id === channelId) ?? channels[0] ?? null;
  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const connected = status.kind === 'ready' || status.kind === 'streaming';
  const canAnalyze = activeRun !== null && !overlay;
  const analyzing = mode === 'analyze' && canAnalyze;

  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    recStartRef.current = null;
    setRecording(false);
    setRuns((previous) => {
      const run = recorder.finish(nextRunLabel(previous), `run-${Date.now()}`, Date.now());
      if (run.t.length === 0) {
        setNotice('No samples were recorded. If a trigger was set, the signal never crossed its level.');
        return previous;
      }
      setNotice(null);
      setActiveRunId(run.id);
      setFitRange(null);
      return [...previous, run].slice(-MAX_RUNS);
    });
  }, []);

  const connectSimulated = async () => {
    await sourceRef.current?.disconnect();
    const source = createSimulatedSource();
    sourceRef.current = source;
    source.onStatus(setStatus);
    source.subscribeChannels((next) => {
      setChannels(next);
      setChannelId((current) => (next.some((entry) => entry.id === current) ? current : (next[0]?.id ?? '')));
    });
    source.subscribe((sample) => {
      const live = liveRef.current;
      live.t.push(sample.t);
      Object.entries(sample.channels).forEach(([id, raw]) => {
        const value = raw - (offsetsRef.current[id] ?? 0);
        latestRef.current[id] = value;
        (live.v[id] ??= []).push(value);
      });
      // While recording, keep everything since the run began so the live plot
      // can show it growing; otherwise only a sliding window.
      const isRecording = recStartRef.current !== null;
      while (
        live.t.length > 0 &&
        (isRecording ? live.t.length > MAX_LIVE_SAMPLES : sample.t - live.t[0] > LIVE_WINDOW_S)
      ) {
        live.t.shift();
        Object.values(live.v).forEach((series) => series.shift());
      }
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.push({
          t: sample.t,
          channels: Object.fromEntries(
            Object.keys(sample.channels).map((id) => [id, latestRef.current[id]]),
          ),
        });
        if (recorder.finished()) finishRecording();
      }
    });
    liveRef.current = { t: [], v: {} };
    await source.connect();
    await source.start(PERIOD_S);
  };

  const disconnect = async () => {
    if (recorderRef.current) finishRecording();
    await sourceRef.current?.disconnect();
    sourceRef.current = null;
    setChannels([]);
  };

  useEffect(() => () => void sourceRef.current?.disconnect(), []);

  // The stream is not routed through React state: the plot refreshes on a timer.
  useEffect(() => {
    if (!connected) return undefined;
    const id = window.setInterval(() => setTick((value) => value + 1), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [connected]);

  const startRecording = () => {
    if (!channel) return;
    const level = Number.parseFloat(triggerLevel);
    recorderRef.current = createRecorder({
      channels,
      trigger: {
        mode: Number.isFinite(level) ? triggerMode : 'immediate',
        channelId: channel.id,
        level: Number.isFinite(level) ? level : 0,
      },
      preTriggerSeconds: 0.5,
      durationSeconds: duration === 'manual' ? null : Number(duration),
    });
    const liveT = liveRef.current.t;
    recStartRef.current = liveT.length > 0 ? liveT[liveT.length - 1] : 0;
    // Collecting always returns to the quiet live view, so the run draws as it grows.
    setActiveRunId(null);
    setOverlay(false);
    setMode('explore');
    setFitRange(null);
    setPins([]);
    setOpenAxis(null);
    setRecording(true);
    setNotice(null);
  };

  const tare = () => {
    if (!channel) return;
    const recent = (liveRef.current.v[channel.id] ?? []).slice(-10);
    // Live values already have the old offset removed; add it back, then average.
    const previous = offsetsRef.current[channel.id] ?? 0;
    offsetsRef.current[channel.id] = previous + tareOffset(recent);
  };

  const showLive = () => {
    setActiveRunId(null);
    setOverlay(false);
    setFitRange(null);
    setFitKind('none');
  };
  const showRun = (id: string) => {
    setActiveRunId(id);
    setOverlay(false);
    setFitRange(null);
    setFitKind('none');
  };

  const channelIndex = (run: SensorRun, id: string) => run.channels.findIndex((c) => c.id === id);

  // --- plotting -------------------------------------------------------------
  const analysisY = useMemo(() => {
    if (!activeRun || !channel) return null;
    const index = channelIndex(activeRun, channel.id);
    return index === -1 ? null : activeRun.values[index];
  }, [activeRun, channel]);

  const windowRange: TimeRange | null = activeRun
    ? (fitRange ?? { min: 0, max: activeRun.t[activeRun.t.length - 1] ?? 1 })
    : null;

  const fitSummary = useMemo(
    () =>
      analyzing && activeRun && analysisY && windowRange && channel
        ? computeFit(fitKind, activeRun.t, analysisY, windowRange, { x: 't', y: channel.quantity })
        : null,
    // windowRange is derived from fitRange and activeRun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyzing, activeRun, analysisY, fitRange, fitKind, channel],
  );
  const fitCurve = fitSummary && windowRange ? sampleFit(fitSummary, windowRange) : null;

  const buildSeries = (): PlotSeries[] => {
    if (!channel) return [];
    if (!activeRun && !overlay) {
      const live = liveRef.current;
      const y = live.v[channel.id] ?? [];
      const origin = recStartRef.current;
      const points = live.t
        .map((t, i) => ({ x: origin === null ? t : t - origin, y: y[i], sigmaX: null, sigmaY: null }))
        .filter((point) => origin === null || point.x >= 0);
      return [
        {
          key: 'live',
          label: `${channel.name} (live)`,
          color: trackColor(0),
          shape: trackShape(0),
          points: decimate(points),
        },
      ];
    }
    const shown = overlay ? runs : activeRun ? [activeRun] : [];
    return shown.flatMap((run, order) => {
      const index = channelIndex(run, channel.id);
      if (index === -1) return [];
      return [
        {
          key: run.id,
          label: run.label,
          color: trackColor(overlay ? order : 0),
          shape: trackShape(overlay ? order : 0),
          points: decimate(run.t.map((x, i) => ({ x, y: run.values[index][i], sigmaX: null, sigmaY: null }))),
          faded: false,
        },
      ];
    });
  };
  // Not memoised: the live branch reads refs and must follow every tick render.
  const series = buildSeries();
  const plotPoints = series.flatMap((entry) => entry.points);
  const autoX = boundsOf(plotPoints.map((point) => point.x)) ?? { min: 0, max: 1 };
  const autoY = boundsOf(plotPoints.map((point) => point.y)) ?? { min: 0, max: 1 };
  const shownX = xRange ?? autoX;
  const shownY = yRange ?? autoY;

  const stats =
    analyzing && activeRun && analysisY ? seriesStats(activeRun.t, analysisY, windowRange) : null;
  const area =
    analyzing && activeRun && analysisY ? integrate(activeRun.t, analysisY, windowRange) : null;
  const peakCount = useMemo(() => {
    if (!analyzing || !activeRun || !analysisY) return 0;
    const span = Math.max(...analysisY) - Math.min(...analysisY);
    return span > 0 ? findPeaks(activeRun.t, analysisY, span * 0.25, windowRange).length : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, activeRun, analysisY, fitRange]);

  const xLabel = 'Time (s)';
  const yLabel = channel ? `${channel.quantity} (${channel.unit})` : 'Value';
  const viewingLive = activeRunId === null && !overlay;

  const formatHover = (point: PlotPin) =>
    `${overlay ? `${point.seriesLabel}: ` : ''}t = ${fmt(point.x)} s · ${channel?.quantity ?? 'value'} = ${fmt(point.y)} ${channel?.unit ?? ''}`.trim();

  // --- export ---------------------------------------------------------------
  const exportRuns = overlay || !activeRun ? runs : [activeRun];
  const closeExport = () => {
    if (exportMenuRef.current) exportMenuRef.current.open = false;
  };
  const download = () => {
    const text = serializeSensorRuns(exportRuns, { delimiter: ',', layout });
    downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), 'sensor-lab.csv');
    closeExport();
  };
  const copy = async () => {
    const ok = await copyText(serializeSensorRuns(exportRuns, { delimiter: '\t', layout }));
    setNotice(ok ? 'Copied. Paste into a spreadsheet.' : 'The browser blocked copying.');
    closeExport();
  };
  const savePlot = async () => {
    closeExport();
    if (!plotRef.current) return;
    try {
      await savePlotWithCaption(
        plotRef.current,
        {
          title: `Sensor Lab — ${activeRun?.label ?? 'live'}`,
          captionLines: [yLabel, ...(fitSummary ? [`${fitSummary.equation} (R² = ${fmt(fitSummary.rSquared, 4)})`] : [])],
        },
        'sensor-lab-plot.png',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the plot.');
    }
  };

  const supportsUsb = typeof navigator !== 'undefined' && 'usb' in navigator;
  const probe = async () => {
    setProbing(true);
    setProbeText(null);
    try {
      setProbeText(await runHardwareProbe(setProbeProgress));
    } catch (error) {
      setProbeText(`The probe failed: ${String(error)}`);
    } finally {
      setProbing(false);
    }
  };
  const channelOptions = channels.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.unit})` }));
  const latest = channel ? latestRef.current[channel.id] : undefined;

  return (
    <div className="not-prose flex flex-col gap-3 p-3 text-[var(--text-primary)] sm:p-4">
      <section
        aria-label="Connection"
        className="rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-3">
          {connected ? (
            <Button variant="secondary" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button onClick={() => void connectSimulated()}>
              <Cable aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
              Use simulated sensors
            </Button>
          )}
          <span role="status" className="type-supporting text-[var(--text-muted)]">
            {probing ? probeProgress : status.message}
          </span>
          {supportsUsb && isProbeSupported() && !connected ? (
            <details className="ml-auto text-sm">
              <summary className="cursor-pointer text-[var(--text-muted)]">Hardware tools</summary>
              <div className="mt-2 flex flex-col gap-2">
                <p className="type-supporting m-0 max-w-prose text-[var(--text-muted)]">
                  LabQuest analog sensors (force, force plate) are not connectable yet. Plug sensors into the
                  LabQuest and run the probe to capture what it sends.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void probe()} disabled={probing}>
                    {probing ? 'Probing…' : 'Probe LabQuest hardware'}
                  </Button>
                  {probeText ? (
                    <Button
                      variant="secondary"
                      onClick={async () =>
                        setNotice(
                          (await copyText(probeText)) ? 'Probe output copied.' : 'The browser blocked copying.',
                        )
                      }
                    >
                      Copy probe output
                    </Button>
                  ) : null}
                </div>
                {probeText ? (
                  <textarea
                    readOnly
                    aria-label="Probe output"
                    value={probeText}
                    rows={8}
                    className="w-full min-w-[20rem] rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] p-2 font-mono text-xs text-[var(--text-primary)]"
                  />
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
        {!supportsUsb ? (
          <p className="type-supporting mt-1 mb-0 text-[var(--text-muted)]">
            LabQuest connections need Chrome or Edge.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-2">
          {connected || runs.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="type-label m-0">
                  {overlay ? 'All runs' : (activeRun?.label ?? (recording ? 'Recording' : 'Live'))}
                </p>
                <div className="flex items-center gap-2">
                  {pins.length > 0 ? (
                    <Button variant="secondary" onClick={() => setPins([])}>
                      Clear pins ({pins.length})
                    </Button>
                  ) : null}
                  <div role="group" aria-label="Plot mode" className="inline-flex gap-1">
                    <Button
                      variant={analyzing ? 'secondary' : 'primary'}
                      aria-pressed={!analyzing}
                      onClick={() => setMode('explore')}
                    >
                      Explore
                    </Button>
                    <Button
                      variant={analyzing ? 'primary' : 'secondary'}
                      aria-pressed={analyzing}
                      disabled={!canAnalyze}
                      title={canAnalyze ? undefined : 'Select a single run to analyze it'}
                      onClick={() => setMode('analyze')}
                    >
                      Analyze
                    </Button>
                  </div>
                </div>
              </div>
              <div className="relative [&_svg]:mx-auto [&_svg]:max-h-[60vh]">
                <AnalysisPlot
                  series={series}
                  xLabel={xLabel}
                  yLabel={yLabel}
                  fitCurve={fitCurve}
                  fitColor="var(--accent-orange)"
                  fitRange={analyzing ? windowRange : null}
                  onFitRangeChange={(min, max) => setFitRange({ min, max })}
                  residuals={null}
                  summary={
                    fitSummary
                      ? `${fitSummary.equation}`
                      : activeRun
                        ? `${activeRun.label}, ${activeRun.t.length} samples`
                        : 'Live view'
                  }
                  exportRef={plotRef}
                  emptyMessage="Connect sensors to see a live graph."
                  xRange={xRange}
                  yRange={yRange}
                  hover
                  formatHover={formatHover}
                  pins={pins}
                  onPinsChange={viewingLive ? undefined : setPins}
                  onAxisLabelClick={(axis) => setOpenAxis((current) => (current === axis ? null : axis))}
                  xCustom={xRange !== null}
                  yCustom={yRange !== null}
                />
                {openAxis === 'x' ? (
                  <AxisPopover
                    axis="x"
                    label="Time"
                    unit="s"
                    range={shownX}
                    manual={xRange !== null}
                    onChange={setXRange}
                    onClose={closeAxis}
                    className="bottom-14 left-1/2 -translate-x-1/2"
                  />
                ) : null}
                {openAxis === 'y' ? (
                  <AxisPopover
                    axis="y"
                    label={channel?.quantity ?? 'Value'}
                    unit={channel?.unit ?? ''}
                    range={shownY}
                    manual={yRange !== null}
                    onChange={setYRange}
                    onClose={closeAxis}
                    className="left-20 top-1/2 -translate-y-1/2"
                  />
                ) : null}
              </div>
              {analyzing && activeRun && windowRange ? (
                <AnalysisStrip
                  runLabel={activeRun.label}
                  window={windowRange}
                  unit={channel?.unit ?? ''}
                  stats={stats}
                  area={area}
                  peaks={peakCount}
                  fitKind={fitKind}
                  onFitKind={setFitKind}
                  fit={fitSummary}
                />
              ) : (
                <p className="type-supporting m-0 text-[var(--text-muted)]">
                  Hover over the graph to read values and click a point to pin it. Click an axis label to set
                  its range.
                </p>
              )}
            </>
          ) : (
            <p className="type-supporting text-[var(--text-muted)]">
              Connect sensors above, then press Collect to record a run.
            </p>
          )}
          {notice ? (
            <p role="status" className="type-supporting text-[var(--text-muted)]">
              {notice}
            </p>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {connected && channel ? (
            <section aria-label="Collect" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Select label="Channel" value={channel.id} onChange={setChannelId} options={channelOptions} />
                <Button variant="secondary" onClick={tare} disabled={recording}>
                  Zero
                </Button>
              </div>
              <Readout variant="inline">
                <Readout.Value label={channel.quantity} value={fmt(latest)} unit={channel.unit} />
              </Readout>
              <div className="flex flex-wrap items-center gap-3">
                <Select label="Record for" value={duration} onChange={setDuration} options={DURATION_OPTIONS} />
                <Select
                  label="Start"
                  value={triggerMode}
                  onChange={(value) => setTriggerMode(value as TriggerMode)}
                  options={TRIGGER_OPTIONS}
                />
                {triggerMode !== 'immediate' ? (
                  <label className="inline-flex items-center gap-2 text-sm">
                    <span className="font-medium">Level</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={triggerLevel}
                      onChange={(event) => setTriggerLevel(event.target.value)}
                      className="w-20 rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] px-2 py-1 text-right font-mono tabular-nums"
                    />
                    <span className="text-[var(--text-muted)]">{channel.unit}</span>
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {recording ? (
                  <Button onClick={finishRecording}>Stop</Button>
                ) : (
                  <Button onClick={startRecording}>Collect</Button>
                )}
                {recording && recorderRef.current && !recorderRef.current.triggered() ? (
                  <span className="type-supporting text-[var(--text-muted)]">Waiting for trigger…</span>
                ) : null}
              </div>
            </section>
          ) : null}

          {connected || runs.length > 0 ? (
            <section aria-label="Runs" className="flex flex-col gap-2">
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                <li>
                  <Button
                    variant={viewingLive ? 'primary' : 'secondary'}
                    disabled={!connected}
                    aria-pressed={viewingLive}
                    onClick={showLive}
                  >
                    Live
                  </Button>
                </li>
                {runs.map((run) => (
                  <li key={run.id} className="inline-flex items-center gap-1">
                    <Button
                      variant={run.id === activeRunId ? 'primary' : 'secondary'}
                      onClick={() => showRun(run.id)}
                      aria-pressed={run.id === activeRunId}
                    >
                      {run.label}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Delete ${run.label}`}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                      onClick={() => {
                        setRuns((previous) => previous.filter((entry) => entry.id !== run.id));
                        if (run.id === activeRunId) setActiveRunId(null);
                      }}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {runs.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle label="Overlay all runs" checked={overlay} onChange={setOverlay} />
                  <details ref={exportMenuRef} className="relative">
                    <summary className="btn btn-secondary cursor-pointer list-none">
                      <Download aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                      Export
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-3 shadow-md">
                      <Select
                        ariaLabel="Export layout"
                        value={layout}
                        onChange={(value) => setLayout(value as ExportLayout)}
                        options={[
                          { value: 'wide', label: 'Columns per run' },
                          { value: 'long', label: 'One row per sample' },
                        ]}
                      />
                      <Button variant="secondary" onClick={download}>
                        Download CSV
                      </Button>
                      <Button variant="secondary" onClick={() => void copy()}>
                        Copy for spreadsheet
                      </Button>
                      <Button variant="secondary" onClick={() => void savePlot()}>
                        Save plot image
                      </Button>
                    </div>
                  </details>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
