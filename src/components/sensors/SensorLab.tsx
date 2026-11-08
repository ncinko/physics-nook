import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Download, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { AnalysisPlot, type PlotSeries } from '../kinematics/videoAnalysis/AnalysisPlot';
import { downloadBlob, savePlotWithCaption } from '../kinematics/videoAnalysis/exportPlot';
import { trackColor, trackShape } from '../kinematics/videoAnalysis/trackColors';
import { Button, ControlBar, Select, Toggle } from '../shared/InlineControls';
import Readout from '../shared/Readout';
import { copyText } from '../../utils/clipboard';
import { predictPolynomial } from '../../lib/math/leastSquares';
import { boundsOf, withBound, zoomRange, type AxisRange } from '../../lib/sensors/axis';
import { fitSeries, integrate, seriesStats, findPeaks } from '../../lib/sensors/analysis';
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

/**
 * Editable bounds for one axis: two number fields, zoom in/out about the
 * centre, and a button back to auto-scale. A half-typed number sits in a draft
 * until Enter or blur commits it, so typing "-" does not collapse the plot.
 */
function AxisFields({
  label,
  unit,
  range,
  manual,
  onChange,
}: {
  label: string;
  unit: string;
  range: AxisRange;
  manual: boolean;
  onChange: (range: AxisRange | null) => void;
}) {
  const [draft, setDraft] = useState<{ which: 'min' | 'max'; text: string } | null>(null);

  const commit = () => {
    if (draft) {
      const next = withBound(range, draft.which, draft.text);
      if (next) onChange(next);
    }
    setDraft(null);
  };

  const field = (which: 'min' | 'max') => (
    <input
      type="text"
      inputMode="decimal"
      aria-label={`${label} axis ${which}`}
      value={draft?.which === which ? draft.text : fmt(range[which], 3)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft({ which, text: event.target.value })}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
      className="w-20 rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]"
    />
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium">{label}</span>
      {field('min')}
      <span className="text-[var(--text-muted)]">to</span>
      {field('max')}
      <span className="text-[var(--text-muted)]">{unit}</span>
      <Button variant="secondary" aria-label={`Zoom in on ${label}`} onClick={() => onChange(zoomRange(range, 0.5))}>
        <ZoomIn aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button variant="secondary" aria-label={`Zoom out on ${label}`} onClick={() => onChange(zoomRange(range, 2))}>
        <ZoomOut aria-hidden="true" className="h-4 w-4" />
      </Button>
      {manual ? (
        <Button variant="secondary" onClick={() => onChange(null)}>
          Auto
        </Button>
      ) : null}
    </div>
  );
}

export default function SensorLab() {
  const sourceRef = useRef<SensorSource | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<{ t: number[]; v: Record<string, number[]> }>({ t: [], v: {} });
  const latestRef = useRef<Record<string, number>>({});
  const offsetsRef = useRef<Record<string, number>>({});
  const plotRef = useRef<SVGSVGElement | null>(null);
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
  const [fitRange, setFitRange] = useState<TimeRange | null>(null);
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
    // Ranges are in the channel's units; a different channel starts on auto.
    setXRange(null);
    setYRange(null);
  }, [channelId]);

  const channel = channels.find((entry) => entry.id === channelId) ?? channels[0] ?? null;
  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const connected = status.kind === 'ready' || status.kind === 'streaming';

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
    // Collecting always returns to the live view, so the run draws as it grows.
    setActiveRunId(null);
    setOverlay(false);
    setFitRange(null);
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

  const channelIndex = (run: SensorRun, id: string) => run.channels.findIndex((c) => c.id === id);

  // --- plotting -------------------------------------------------------------
  const analysisY = useMemo(() => {
    if (!activeRun || !channel) return null;
    const index = channelIndex(activeRun, channel.id);
    return index === -1 ? null : activeRun.values[index];
  }, [activeRun, channel]);

  const fit = useMemo(() => {
    if (!activeRun || !analysisY || !fitRange) return null;
    const result = fitSeries(activeRun.t, analysisY, 1, fitRange);
    return result.ok ? result.fit : null;
  }, [activeRun, analysisY, fitRange]);

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

  const fitCurve = useMemo(() => {
    if (!fit || !fitRange) return null;
    return [fitRange.min, fitRange.max].map((x) => ({ x, y: predictPolynomial(fit.coefficients, x) }));
  }, [fit, fitRange]);

  const stats = activeRun && analysisY ? seriesStats(activeRun.t, analysisY, fitRange) : null;
  const area = activeRun && analysisY ? integrate(activeRun.t, analysisY, fitRange) : null;
  const peaks = useMemo(() => {
    if (!activeRun || !analysisY) return [];
    const span = Math.max(...analysisY) - Math.min(...analysisY);
    return span > 0 ? findPeaks(activeRun.t, analysisY, span * 0.25, fitRange) : [];
  }, [activeRun, analysisY, fitRange]);

  const xLabel = 'Time (s)';
  const yLabel = channel ? `${channel.quantity} (${channel.unit})` : 'Value';

  // --- export ---------------------------------------------------------------
  const exportRuns = overlay || !activeRun ? runs : [activeRun];
  const download = () => {
    const text = serializeSensorRuns(exportRuns, { delimiter: ',', layout });
    downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), 'sensor-lab.csv');
  };
  const copy = async () => {
    const ok = await copyText(serializeSensorRuns(exportRuns, { delimiter: '\t', layout }));
    setNotice(ok ? 'Copied. Paste into a spreadsheet.' : 'The browser blocked copying.');
  };
  const savePlot = async () => {
    if (!plotRef.current) return;
    try {
      await savePlotWithCaption(
        plotRef.current,
        { title: `Sensor Lab — ${activeRun?.label ?? 'live'}`, captionLines: [yLabel] },
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
  const viewingLive = activeRunId === null && !overlay;

  return (
    <div className="not-prose flex flex-col gap-3 p-3 text-[var(--text-primary)] sm:p-4">
      <section
        aria-label="Connection"
        className="rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void connectSimulated()} disabled={connected}>
            <Cable aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            Use simulated sensors
          </Button>
          {connected ? (
            <Button variant="secondary" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : null}
          {supportsUsb && isProbeSupported() ? (
            <Button variant="secondary" onClick={() => void probe()} disabled={probing || connected}>
              {probing ? 'Probing…' : 'Probe LabQuest hardware'}
            </Button>
          ) : null}
          {probeText ? (
            <Button
              variant="secondary"
              onClick={async () =>
                setNotice((await copyText(probeText)) ? 'Probe output copied.' : 'The browser blocked copying.')
              }
            >
              Copy probe output
            </Button>
          ) : null}
          <span role="status" className="type-supporting text-[var(--text-muted)]">
            {probing ? probeProgress : status.message}
          </span>
        </div>
        <p hidden={connected} className="type-supporting mt-2 text-[var(--text-muted)]">
          {supportsUsb
            ? 'LabQuest analog sensors (force, force plate) are not connectable yet. Plug sensors into the LabQuest and run the probe to capture what it sends.'
            : 'LabQuest connections need Chrome or Edge.'}
        </p>
        {probeText ? (
          <textarea
            readOnly
            aria-label="Probe output"
            value={probeText}
            rows={8}
            className="mt-2 w-full rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] p-2 font-mono text-xs text-[var(--text-primary)]"
          />
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-2">
          {connected || runs.length > 0 ? (
            <>
              <div className="[&_svg]:mx-auto [&_svg]:max-h-[60vh]">
                <AnalysisPlot
                  series={series}
                  xLabel={xLabel}
                  yLabel={yLabel}
                  fitCurve={fitCurve}
                  fitColor="var(--accent-orange)"
                  fitRange={
                    activeRun ? (fitRange ?? { min: 0, max: activeRun.t[activeRun.t.length - 1] ?? 1 }) : null
                  }
                  onFitRangeChange={(min, max) => setFitRange({ min, max })}
                  residuals={null}
                  summary={
                    fit
                      ? `Linear fit: slope ${fmt(fit.coefficients[1], 4)} ${channel?.unit ?? ''}/s`
                      : activeRun
                        ? `${activeRun.label}, ${activeRun.t.length} samples`
                        : 'Live view'
                  }
                  exportRef={plotRef}
                  emptyMessage="Connect sensors to see a live graph."
                  xRange={xRange}
                  yRange={yRange}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <AxisFields
                  label="Time"
                  unit="s"
                  range={shownX}
                  manual={xRange !== null}
                  onChange={setXRange}
                />
                <AxisFields
                  label={channel?.quantity ?? 'Value'}
                  unit={channel?.unit ?? ''}
                  range={shownY}
                  manual={yRange !== null}
                  onChange={setYRange}
                />
                {xRange || yRange ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setXRange(null);
                      setYRange(null);
                    }}
                  >
                    Autoscale both
                  </Button>
                ) : null}
              </div>
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

          {activeRun && stats ? (
            <section aria-label="Analysis" className="flex flex-col gap-2">
              <p className="type-label">
                {activeRun.label}
                {fitRange ? `, t from ${fmt(fitRange.min, 2)} to ${fmt(fitRange.max, 2)} s` : ', whole run'}
              </p>
              <Readout variant="inline">
                <Readout.Value label="Max" value={fmt(stats.max)} unit={channel?.unit} />
                <Readout.Value label="Min" value={fmt(stats.min)} unit={channel?.unit} />
                <Readout.Value label="Mean" value={fmt(stats.mean)} unit={channel?.unit} />
                <Readout.Value label="Std dev" value={fmt(stats.std)} unit={channel?.unit} />
                <Readout.Value label="Area" value={fmt(area)} unit={channel ? `${channel.unit}·s` : ''} />
                {fit ? (
                  <Readout.Value
                    label="Slope"
                    value={fmt(fit.coefficients[1], 4)}
                    unit={channel ? `${channel.unit}/s` : ''}
                  />
                ) : null}
                <Readout.Value label="Peaks" value={String(peaks.length)} />
              </Readout>
              <p className="type-supporting text-[var(--text-muted)]">
                Drag the dashed handles to choose the interval.
              </p>
            </section>
          ) : null}

          {connected || runs.length > 0 ? (
            <section aria-label="Runs" className="flex flex-col gap-2">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Button
                    variant={viewingLive ? 'primary' : 'secondary'}
                    disabled={!connected}
                    aria-pressed={viewingLive}
                    onClick={() => {
                      setActiveRunId(null);
                      setOverlay(false);
                      setFitRange(null);
                    }}
                  >
                    Live
                  </Button>
                </li>
                {runs.map((run) => (
                  <li key={run.id} className="inline-flex items-center gap-1">
                    <Button
                      variant={run.id === activeRunId ? 'primary' : 'secondary'}
                      onClick={() => {
                        setActiveRunId(run.id);
                        setOverlay(false);
                        setFitRange(null);
                      }}
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
                <>
                  <Toggle label="Overlay all runs" checked={overlay} onChange={setOverlay} />
                  <ControlBar align="start" className="gap-x-2">
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
                      <Download aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                      CSV
                    </Button>
                    <Button variant="secondary" onClick={() => void copy()}>
                      Copy
                    </Button>
                    <Button variant="secondary" onClick={() => void savePlot()}>
                      Save plot
                    </Button>
                  </ControlBar>
                </>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
