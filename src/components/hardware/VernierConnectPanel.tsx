import { useEffect, useState } from 'react';
import { Cable, CheckCircle2, ClipboardCopy, Loader2, Mouse, TriangleAlert } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import { fixed } from '../../utils/format';
import type { VernierMotionApi } from './useVernierMotion';

// Connecting a LabQuest Mini and confirming it reads the world correctly.
//
// Two things here earn their keep beyond a connect button. The diagnostics
// dump is how the NGIO framing gets settled against real hardware — without a
// device in hand it is a hypothesis, and a transcript is what turns it into a
// fact. The calibration check is how a student finds out the readings are
// wrong before a bad number ends up in a lab report: hold something at a metre
// and see whether the panel agrees.

interface VernierConnectPanelProps {
  device: VernierMotionApi;
  className?: string;
}

const STATUS_TONE: Record<string, string> = {
  streaming: 'text-[var(--accent-green)]',
  ready: 'text-[var(--accent-green)]',
  connecting: 'text-[var(--text-muted)]',
  error: 'text-[var(--accent-red)]',
  unsupported: 'text-[var(--accent-red)]',
  idle: 'text-[var(--text-muted)]',
};

export default function VernierConnectPanel({ device, className = '' }: VernierConnectPanelProps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState('');
  const [copied, setCopied] = useState(false);
  const [calibrationNote, setCalibrationNote] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const { status, latest, sourceId, supportsHid, supportsUsb } = device;
  const connected = status.kind === 'ready' || status.kind === 'streaming';

  const refreshDiagnostics = () => {
    setDiagnostics(device.diagnosticsText());
    setShowDiagnostics(true);
  };

  const copyDiagnostics = async () => {
    const text = device.diagnosticsText();
    setDiagnostics(text);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard permission can be refused; the textarea below is the fallback.
      setShowDiagnostics(true);
    }
  };

  const checkCalibration = () => {
    if (!latest || latest.quality !== 'ok') {
      setCalibrationNote('No reading right now — is anything in front of the detector?');
      return;
    }
    const error = latest.distance - 1;
    setCalibrationNote(
      Math.abs(error) <= 0.03
        ? `Reads ${fixed(latest.distance, 3)} m against a 1.00 m target. That is within 3 cm — good.`
        : `Reads ${fixed(latest.distance, 3)} m against a 1.00 m target, off by ${fixed(Math.abs(error) * 100, 1)} cm. ` +
            'Check the detector is aimed at the reflector and that the sensitivity switch is on the walking figure.',
    );
  };

  return (
    <div
      className={`not-prose rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void device.selectSource('webhid')}
          disabled={!supportsHid || status.kind === 'connecting'}
        >
          <Cable aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
          Connect a LabQuest
        </Button>

        <Button variant="secondary" onClick={() => void device.selectSource('practice')}>
          <Mouse aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
          Practice without one
        </Button>

        {sourceId && (
          <Button variant="secondary" onClick={() => void device.disconnect()}>
            Disconnect
          </Button>
        )}
      </div>

      <p
        className={`mt-3 flex items-center gap-2 text-sm ${STATUS_TONE[status.kind] ?? 'text-[var(--text-muted)]'}`}
        role="status"
      >
        {status.kind === 'connecting' && (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        )}
        {status.kind === 'error' && <TriangleAlert aria-hidden="true" className="h-4 w-4" />}
        {connected && <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
        <span>{status.message}</span>
      </p>

      {!supportsHid && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Reading a LabQuest from a web page needs WebHID, which only Chrome and Edge ship. In
          Firefox or Safari the practice mode still works.
          {supportsUsb && (
            <>
              {' '}
              This browser does have WebUSB;{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void device.selectSource('webusb')}
              >
                try the WebUSB fallback
              </button>
              , though on Windows it conflicts with the Vernier drivers.
            </>
          )}
        </p>
      )}

      {connected && (
        <div className="mt-4 border-t border-[var(--grid-line)] pt-3">
          <p className="text-sm text-[var(--text-primary)]">
            Live reading:{' '}
            <span className="font-mono">
              {latest && latest.quality === 'ok' ? `${fixed(latest.distance, 3)} m` : 'no echo'}
            </span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={checkCalibration}>
              Check against 1.00 m
            </Button>
            <span className="text-xs text-[var(--text-muted)]">
              Hold a book or clipboard exactly one metre from the detector, then press.
            </span>
          </div>

          {calibrationNote && (
            <p className="mt-2 text-sm text-[var(--text-muted)]" role="status">
              {calibrationNote}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-[var(--grid-line)] pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="text-xs text-[var(--text-muted)] underline"
            onClick={() => (showDiagnostics ? setShowDiagnostics(false) : refreshDiagnostics())}
          >
            {showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}
          </button>

          <button
            type="button"
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] underline"
            onClick={() => void copyDiagnostics()}
          >
            <ClipboardCopy aria-hidden="true" className="h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy diagnostics'}
          </button>
        </div>

        {status.kind === 'error' && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            If the interface connected but never answered, the diagnostics above hold the raw USB
            traffic. That transcript is what pins down the last undocumented piece of the protocol.
          </p>
        )}

        {showDiagnostics && (
          <textarea
            className="mt-2 h-48 w-full resize-y rounded border border-[var(--grid-line)] bg-[var(--sim-bg)] p-2 font-mono text-[11px] leading-snug text-[var(--text-primary)]"
            readOnly
            value={diagnostics}
            aria-label="Vernier device diagnostics"
          />
        )}
      </div>
    </div>
  );
}
