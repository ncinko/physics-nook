import type { ReactNode } from 'react';
import { Cable, CheckCircle2, Loader2, Mouse, TriangleAlert } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import type { MotionSourceId, SourceStatus } from '../../lib/vernier/sources/types';

// Connecting a LabQuest, whatever sensor is on it: the connect button, the
// status line, and — once connected — whatever live reading proves the sensor
// sees the world. `VernierConnectPanel` fills that slot with a distance;
// the photogate lab fills it with the two beams.

export interface ConnectableDevice {
  status: SourceStatus;
  sourceId: MotionSourceId | null;
  supportsUsb: boolean;
  selectSource: (id: MotionSourceId) => Promise<void>;
  disconnect: () => Promise<void>;
}

interface DeviceConnectPanelProps {
  device: ConnectableDevice;
  /** Offers the simulated source, labelled `simulatedLabel`. Off for readers. */
  allowSimulated?: boolean;
  simulatedLabel?: string;
  /** Shown under the status line while connected. */
  children?: ReactNode;
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

export default function DeviceConnectPanel({
  device,
  allowSimulated = false,
  simulatedLabel = 'Simulated',
  children,
  className = '',
}: DeviceConnectPanelProps) {
  const { status, sourceId, supportsUsb } = device;
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

        {allowSimulated && (
          <Button variant="secondary" onClick={() => void device.selectSource('simulated')}>
            <Mouse aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            {simulatedLabel}
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

      {connected && children && (
        <div className="mt-3 border-t border-[var(--grid-line)] pt-3">{children}</div>
      )}
    </div>
  );
}
