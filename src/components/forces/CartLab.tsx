import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, ControlBar, Select, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { fixed } from '../../utils/format';
import { copyText } from '../../utils/clipboard';
import { predictPolynomial } from '../../lib/math/leastSquares';
import {
  CART_LAB_STORAGE_KEY,
  analyzeRun,
  cartFitGroups,
  cartFitProblem,
  cartPlotCaption,
  inRange,
  nextRunId,
  nextRunLabel,
  parseStoredRuns,
  plotFileName,
  serializeResults,
  serializeRuns,
  serializeStoredRuns,
  syntheticCartRun,
  type CartRow,
  type CartRun,
  type CartSample,
  type ExportLayout,
  type FitRange,
  type PlotQuantity,
} from '../../lib/forces/cartRun';
import { AnalysisPlot, type PlotPoint, type PlotSeries } from '../kinematics/videoAnalysis/AnalysisPlot';
import { downloadBlob, savePlotWithCaption } from '../kinematics/videoAnalysis/exportPlot';
import VernierConnectPanel from '../hardware/VernierConnectPanel';
import CalibratePanel from '../kinematics/motionGame/CalibratePanel';
import { RunsPanel } from './cartLab/RunsPanel';
import {
  DURATIONS_SECONDS,
  SAMPLE_RATES_HZ,
  useCartRecorder,
  type FinishedRecording,
} from './cartLab/useCartRecorder';

/**
 * Record a cart rolling down a ramp, fit a line to its velocity-time graph, and
 * read the acceleration off the slope: the LoggerPro half of the Dynamics Lab.
 *
 * What it leaves out is on purpose. Turning several runs into an acceleration
 * against sin θ graph is the student's own analysis, so there is no run
 * statistics and no second graph here, only per-run results to copy out.
 *
 * The fit window is the one thing a student has to judge: hand contact at the
 * start and a bounce or a lost echo at the end are not free acceleration. It
 * defaults to everything with a velocity, never to a guess at what to keep, and
 * is adjusted by dragging the handles on either graph or typing times.
 */

const DATA_COLOR = 'var(--accent-blue)';
const FIT_COLOR = 'var(--accent-purple)';
const UNDO_SECONDS = 8;
const NOTICE_MS = 2600;

/** The mouse-driven walker stands in for a detector when testing; it is not offered otherwise. */
const isSimulatedWalkerEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('walker');
};

interface DeletedRun {
  run: CartRun;
  index: number;
}

const samplePoints = (
  rows: readonly CartRow[],
  pick: (row: CartRow) => number | null,
  chosen: FitRange | null,
): PlotSeries[] => {
  const inside: PlotPoint[] = [];
  const outside: PlotPoint[] = [];
  rows.forEach((row) => {
    const y = pick(row);
    if (y === null) return;
    (inRange(row.t, chosen) ? inside : outside).push({ x: row.t, y, sigmaX: null, sigmaY: null });
  });
  return [
    { key: 'in', label: 'In fit window', color: DATA_COLOR, shape: 'circle', points: inside },
    ...(outside.length > 0
      ? [
          {
            key: 'out',
            label: 'Outside fit window',
            color: DATA_COLOR,
            shape: 'circle' as const,
            points: outside,
            faded: true,
          },
        ]
      : []),
  ];
};

/** A time field that lets a half-typed number sit there until it is committed. */
function TimeField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : value.toFixed(2));

  const commit = () => {
    if (draft !== null) {
      const parsed = Number.parseFloat(draft);
      if (Number.isFinite(parsed)) onCommit(parsed);
    }
    setDraft(null);
  };

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
        className="w-20 rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)] disabled:opacity-50"
      />
      <span className="text-[var(--text-muted)]">s</span>
    </label>
  );
}

export default function CartLab() {
  const [runs, setRuns] = useState<CartRun[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [deleted, setDeleted] = useState<DeletedRun | null>(null);
  const [showResiduals, setShowResiduals] = useState(false);
  const [layout, setLayout] = useState<ExportLayout>('wide');
  const [calibrating, setCalibrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [allowSimulated] = useState(isSimulatedWalkerEnabled);

  const noticeTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const velocitySvgRef = useRef<SVGSVGElement | null>(null);
  const positionSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  // --- remembering runs ----------------------------------------------------

  // Read in an effect rather than during render, so the island paints the same
  // markup every time and a window with storage disabled is not an error.
  useEffect(() => {
    try {
      const stored = parseStoredRuns(window.localStorage.getItem(CART_LAB_STORAGE_KEY));
      setRuns(stored);
      setActiveId(stored.length > 0 ? stored[stored.length - 1].id : null);
    } catch {
      // Storage refused. The lab works for this session, which is the period it is for.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (runs.length === 0) window.localStorage.removeItem(CART_LAB_STORAGE_KEY);
      else window.localStorage.setItem(CART_LAB_STORAGE_KEY, serializeStoredRuns(runs));
    } catch {
      // Same as above.
    }
  }, [runs, loaded]);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  // --- runs ----------------------------------------------------------------

  const runsRef = useRef(runs);
  runsRef.current = runs;

  const addRun = useCallback((build: (id: number, label: string) => CartRun) => {
    const id = nextRunId(runsRef.current);
    const run = build(id, nextRunLabel(runsRef.current));
    setRuns((previous) => [...previous, run]);
    setActiveId(id);
  }, []);

  const handleFinished = useCallback(
    (recording: FinishedRecording) => {
      addRun((id, label) => ({ id, label, ...recording, fitRange: null }));
    },
    [addRun],
  );

  const recorder = useCartRecorder(handleFinished, calibrating);
  const { recording, live, rateHz } = recorder;

  const updateRun = useCallback((id: number, patch: Partial<CartRun>) => {
    setRuns((previous) => previous.map((run) => (run.id === id ? { ...run, ...patch } : run)));
  }, []);

  const deleteRun = (id: number) => {
    const index = runs.findIndex((run) => run.id === id);
    if (index < 0) return;
    const run = runs[index];
    const remaining = runs.filter((entry) => entry.id !== id);
    setRuns(remaining);
    if (activeId === id) {
      const neighbour = remaining[Math.min(index, remaining.length - 1)];
      setActiveId(neighbour ? neighbour.id : null);
    }
    setDeleted({ run, index });
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setDeleted(null), UNDO_SECONDS * 1000);
  };

  const undoDelete = () => {
    if (!deleted) return;
    const { run, index } = deleted;
    setRuns((previous) => {
      const next = [...previous];
      next.splice(Math.min(index, next.length), 0, run);
      return next;
    });
    setActiveId(run.id);
    setDeleted(null);
  };

  const clearAll = () => {
    setRuns([]);
    setActiveId(null);
    setDeleted(null);
  };

  const addSimulatedRun = () => {
    addRun((id, label) => syntheticCartRun(id, label, id, 1 / rateHz));
    flashNotice('Added a simulated run. It is made up, not a recording.');
  };

  // --- what the graphs show ------------------------------------------------

  const activeRun = runs.find((run) => run.id === activeId) ?? null;

  /** While recording the graphs follow the run in progress; otherwise the chosen run. */
  const viewRun: CartRun | null = useMemo(() => {
    if (recording) {
      const samples: CartSample[] = live;
      return {
        id: 0,
        label: 'Recording',
        samples,
        periodSeconds: 1 / rateHz,
        distanceScale: recorder.calibration.scale,
        fitRange: null,
      };
    }
    return activeRun;
  }, [recording, live, rateHz, recorder.calibration.scale, activeRun]);

  const analysis = useMemo(() => (viewRun ? analyzeRun(viewRun) : null), [viewRun]);
  const fitOk = analysis?.result.ok ? analysis.result.fit : null;
  const handles = !recording && analysis?.range ? analysis.range : null;

  const velocitySeries = useMemo(
    () => (analysis && viewRun ? samplePoints(analysis.rows, (row) => row.v, viewRun.fitRange) : []),
    [analysis, viewRun],
  );
  const positionSeries = useMemo(
    () => (analysis && viewRun ? samplePoints(analysis.rows, (row) => row.x, viewRun.fitRange) : []),
    [analysis, viewRun],
  );

  const fitCurve = useMemo(() => {
    if (recording || !fitOk || !analysis?.range) return null;
    const { min, max } = analysis.range;
    return [min, max].map((x) => ({ x, y: predictPolynomial(fitOk.coefficients, x) }));
  }, [recording, fitOk, analysis]);

  const residualPoints = useMemo(() => {
    if (recording || !showResiduals || !fitOk || !analysis) return null;
    return analysis.rows
      .filter((row) => row.v !== null && inRange(row.t, analysis.range))
      .map((row, index) => ({ x: row.t, y: fitOk.residuals[index] ?? 0 }));
  }, [recording, showResiduals, fitOk, analysis]);

  const setWindow = useCallback(
    (min: number, max: number) => {
      if (!activeRun) return;
      updateRun(activeRun.id, { fitRange: { min: Math.min(min, max), max: Math.max(min, max) } });
    },
    [activeRun, updateRun],
  );

  // --- exporting -----------------------------------------------------------

  const savePlot = async (quantity: PlotQuantity) => {
    const svg = (quantity === 'velocity' ? velocitySvgRef : positionSvgRef).current;
    if (!svg || !activeRun || !analysis) return;
    try {
      const name = await savePlotWithCaption(
        svg,
        cartPlotCaption(activeRun, analysis, quantity),
        plotFileName(activeRun, quantity),
      );
      flashNotice(`Saved ${name}`);
    } catch {
      flashNotice('This browser would not render the plot to an image.');
    }
  };

  const copyToSheet = async (text: string, what: string) => {
    if (!text) return;
    setManualCopyText(null);
    if (await copyText(text)) {
      flashNotice(`Copied ${what} — paste into a spreadsheet.`);
    } else {
      setManualCopyText(text);
    }
  };

  const downloadCsv = () => {
    const csv = serializeRuns(runs, { delimiter: ',', layout });
    if (!csv) return;
    // The BOM is for Excel, which otherwise mangles non-ASCII run names.
    downloadBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), 'cart-lab.csv');
    flashNotice('Saved cart-lab.csv');
  };

  // --- keyboard ------------------------------------------------------------

  const toggleRecording = () => {
    if (recording) recorder.stop();
    else if (recorder.connected && recorder.hasEcho && !recorder.preparing) void recorder.start();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target as HTMLElement;
    // A focused control already treats Space as its own; only the bare panel is ours.
    if (target.closest('input, textarea, select, button, summary, a')) return;
    event.preventDefault();
    toggleRecording();
  };

  // --- render --------------------------------------------------------------

  const { device, calibration } = recorder;
  const canCollect = recorder.connected && recorder.hasEcho;
  const range = analysis?.range ?? null;
  const fitProblem = analysis ? cartFitProblem(analysis.result) : null;
  const groups = analysis ? cartFitGroups(analysis.result) : [];
  const hasRun = activeRun !== null;

  return (
    <div
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="not-prose flex flex-col gap-4 bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] outline-none"
    >
      <VernierConnectPanel
        device={device}
        allowSimulated={allowSimulated}
        distanceScale={calibration.scale}
        onResetCalibration={calibration.reset}
      />

      {device.status.kind === 'streaming' || device.status.kind === 'ready' ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button variant="secondary" type="button" onClick={() => setCalibrating((open) => !open)}>
              {calibrating ? 'Done calibrating' : 'Calibrate detector'}
            </Button>
          </div>
          {calibrating && (
            <div className="rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4">
              <CalibratePanel
                device={device}
                calibration={calibration}
                onBack={() => setCalibrating(false)}
              />
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <ControlBar align="start">
          <Button
            type="button"
            className="btn-lg"
            onClick={toggleRecording}
            disabled={!recording && (!canCollect || recorder.preparing)}
          >
            {recording ? 'Stop' : recorder.preparing ? 'Starting…' : 'Collect'}
          </Button>
          <Select
            label="Rate"
            value={String(recorder.rateHz)}
            onChange={(value) => recorder.setRateHz(Number(value))}
            options={SAMPLE_RATES_HZ.map((hz) => ({ value: String(hz), label: `${hz} Hz` }))}
          />
          <Select
            label="Stop after"
            value={String(recorder.durationSeconds)}
            onChange={(value) => recorder.setDurationSeconds(Number(value))}
            options={DURATIONS_SECONDS.map((seconds) => ({
              value: String(seconds),
              label: `${seconds} s`,
            }))}
          />
          <Button variant="secondary" type="button" onClick={addSimulatedRun} disabled={recording || recorder.preparing}>
            Add a simulated run
          </Button>
          {notice && (
            <span role="status" className="text-sm font-medium text-[var(--accent-green)]">
              {notice}
            </span>
          )}
        </ControlBar>

        <p role="status" className="m-0 text-sm text-[var(--text-muted)]">
          {recorder.preparing
            ? 'Starting the detector…'
            : recording
              ? `Recording… ${fixed(recorder.elapsed, 1)} of ${recorder.durationSeconds} s. Release the cart, catch it, then press Stop.`
            : recorder.problem
              ? recorder.problem
              : !recorder.connected
                ? 'Connect a LabQuest to record, or add a simulated run to try the page.'
                : !recorder.hasEcho
                  ? 'The detector has no echo. Check that it is aimed along the track at the cart.'
                  : 'Ready. The detector only pings about once a second until you press Collect (or Space). Release the cart without pushing, and press Stop after you catch it.'}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-[var(--grid-line)] bg-[var(--surface-plot)] p-2">
          <AnalysisPlot
            exportRef={positionSvgRef}
            series={positionSeries}
            xLabel="Time (s)"
            yLabel="Position (m)"
            fitCurve={null}
            fitColor={FIT_COLOR}
            fitRange={handles}
            onFitRangeChange={setWindow}
            residuals={null}
            emptyMessage="Record or add a run to see position against time."
            summary={`Scatter plot of position against time with ${
              positionSeries.reduce((sum, entry) => sum + entry.points.length, 0)
            } points.`}
          />
        </div>
        <div className="min-w-0 rounded-lg border border-[var(--grid-line)] bg-[var(--surface-plot)] p-2">
          <AnalysisPlot
            exportRef={velocitySvgRef}
            series={velocitySeries}
            xLabel="Time (s)"
            yLabel="Velocity (m/s)"
            fitCurve={fitCurve}
            fitColor={FIT_COLOR}
            fitRange={handles}
            onFitRangeChange={setWindow}
            residuals={residualPoints}
            emptyMessage="Record or add a run to see velocity against time."
            summary={`Scatter plot of velocity against time with ${
              velocitySeries.reduce((sum, entry) => sum + entry.points.length, 0)
            } points${fitOk ? ', with a straight-line fit' : ''}.`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="type-label m-0 text-[var(--accent-blue)]">Fit window</h3>
        <ControlBar align="start">
          <TimeField
            label="From"
            value={range ? range.min : null}
            disabled={!hasRun || recording}
            onCommit={(seconds) => range && setWindow(seconds, range.max)}
          />
          <TimeField
            label="To"
            value={range ? range.max : null}
            disabled={!hasRun || recording}
            onCommit={(seconds) => range && setWindow(range.min, seconds)}
          />
          <Button
            variant="secondary"
            type="button"
            disabled={!hasRun || recording || activeRun?.fitRange === null}
            onClick={() => activeRun && updateRun(activeRun.id, { fitRange: null })}
          >
            Reset to full run
          </Button>
          <Toggle label="Residuals" checked={showResiduals} onChange={setShowResiduals} />
        </ControlBar>
        <p className="m-0 text-sm text-[var(--text-muted)]">
          Drag the dashed handles on either graph, or type times.  The acceleration is only meaningful if the velocity is actually a linear function of time.
        </p>

        {recording || !hasRun ? null : fitProblem ? (
          <p className="m-0 text-sm text-[var(--accent-red)]">{fitProblem}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Readout>
              {groups.map((group) => (
                <Readout.Group key={group.label} label={group.label}>
                  {group.values.map((value) => (
                    <Readout.Value
                      key={value.label}
                      label={value.label}
                      value={value.value}
                      unit={value.unit}
                    />
                  ))}
                </Readout.Group>
              ))}
            </Readout>
            <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
              The ± comes from how far the velocities scatter about the line. Neighbouring velocities
              share positions, so it runs a little small; the spread across your repeat runs is the
              better estimate.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="type-label m-0 text-[var(--accent-blue)]">Runs</h3>
        <RunsPanel
          runs={runs}
          activeId={activeId}
          onSelect={setActiveId}
          onRename={(id, label) => updateRun(id, { label })}
          onDelete={deleteRun}
          onClearAll={clearAll}
        />
        {deleted && (
          <p className="m-0 flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
            Deleted {deleted.run.label}.
            <Button variant="secondary" type="button" onClick={undoDelete}>
              Undo
            </Button>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="type-label m-0 text-[var(--accent-blue)]">Save and copy</h3>
        <ControlBar align="start">
          <Button type="button" disabled={!hasRun || recording} onClick={() => void savePlot('velocity')}>
            Save velocity plot
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!hasRun || recording}
            onClick={() => void savePlot('position')}
          >
            Save position plot
          </Button>
        </ControlBar>
        <ControlBar align="start">
          <Select
            label="Layout"
            value={layout}
            onChange={(value) => setLayout(value as ExportLayout)}
            options={[
              { value: 'wide', label: 'columns per run' },
              { value: 'long', label: 'one row per sample' },
            ]}
          />
          <Button
            type="button"
            disabled={!hasRun}
            onClick={() =>
              activeRun &&
              void copyToSheet(
                serializeRuns([activeRun], { delimiter: '\t', layout }),
                `${activeRun.label}`,
              )
            }
          >
            Copy this run
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={runs.length === 0}
            onClick={() =>
              void copyToSheet(serializeRuns(runs, { delimiter: '\t', layout }), 'all runs')
            }
          >
            Copy all runs
          </Button>
          <Button variant="secondary" type="button" disabled={runs.length === 0} onClick={downloadCsv}>
            Download CSV
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={runs.length === 0}
            onClick={() =>
              void copyToSheet(serializeResults(runs, '\t'), 'the results table')
            }
          >
            Copy results table
          </Button>
        </ControlBar>

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
              className="w-full rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] p-2 font-mono text-xs text-[var(--text-primary)]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
