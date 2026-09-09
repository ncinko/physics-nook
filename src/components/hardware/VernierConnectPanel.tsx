import { Cable, CheckCircle2, Loader2, Mouse, TriangleAlert } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import { fixed } from '../../utils/format';
import type { VernierMotionApi } from './useVernierMotion';

// Connecting a LabQuest Mini and confirming it reads the world correctly.
//
// Beyond the connect button there is only the live reading, which is enough to
// tell whether the detector is aimed at you: hold still and watch the number.
// `diagnosticsText()` on the hook still assembles the USB transcript that
// settled the NGIO framing against real hardware — nothing on the page calls
// it, but the next protocol surprise will, so the surface it needs is kept.

interface VernierConnectPanelProps {
  device: VernierMotionApi;
  /**
   * Offers the simulated walker as a source. Off for readers: the activity is
   * about walking in front of a detector, and a mouse-driven run is a different
   * exercise wearing the same clothes. See `isPracticeEnabled`.
   */
  allowPractice?: boolean;
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

export default function VernierConnectPanel({
  device,
  allowPractice = false,
  className = '',
}: VernierConnectPanelProps) {
  const { status, latest, sourceId, supportsUsb } = device;
  const connected = status.kind === 'ready' || status.kind === 'streaming';

  return (
    <div
      className={`not-prose rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void device.selectSource('webusb')}
          disabled={!supportsUsb || status.kind === 'connecting'}
        >
          <Cable aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
          Connect a LabQuest
        </Button>

        {allowPractice && (
          <Button variant="secondary" onClick={() => void device.selectSource('practice')}>
            <Mouse aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            Simulated walker
          </Button>
        )}

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

      {!supportsUsb && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Reading a LabQuest from a web page needs WebUSB, which Chrome and Edge ship and Firefox
          and Safari do not. Open this page in Chrome or Edge to connect an interface.
        </p>
      )}

      {connected && (
        <p className="mt-3 border-t border-[var(--grid-line)] pt-3 text-sm text-[var(--text-primary)]">
          Live reading:{' '}
          <span className="font-mono">
            {latest && latest.quality === 'ok' ? `${fixed(latest.distance, 3)} m` : 'no echo'}
          </span>
        </p>
      )}
    </div>
  );
}
