/**
 * Hardware probe: one button press that connects a LabQuest, identifies every
 * port, streams a few seconds undecoded, and returns a text transcript.
 *
 * It exists because the analog measurement layout and calibration read were
 * never captured. The transcript — sensor IDs per port plus the raw bytes of
 * each measurement blob — is what the analog decoder will be written from.
 * Nothing here interprets analog bytes.
 */

import { formatDiagnostics } from '../vernier/diagnostics.ts';
import { NGIO_CHANNEL_ID } from '../vernier/ngioPackets.ts';
import { describeSensor } from '../vernier/sensorIds.ts';
import { createNgioUsbTransport } from '../vernier/sources/ngioUsbTransport.ts';

/** Measurement blobs to collect before stopping on our own. */
const BLOBS_WANTED = 12;
const PROBE_PERIOD_S = 0.25;
const PROBE_TIMEOUT_MS = 15000;

const PORT_NAMES: Record<number, string> = {
  [NGIO_CHANNEL_ID.ANALOG1]: 'CH 1',
  [NGIO_CHANNEL_ID.ANALOG2]: 'CH 2',
  [NGIO_CHANNEL_ID.DIGITAL1]: 'DIG 1',
  [NGIO_CHANNEL_ID.DIGITAL2]: 'DIG 2',
};

export const formatDetected = (ids: Record<number, number>): string[] => {
  const entries = Object.entries(ids);
  if (entries.length === 0) return ['Detected: nothing'];
  return entries.map(
    ([channel, id]) =>
      `Detected: ${PORT_NAMES[Number(channel)] ?? `channel ${channel}`} = sensor ID ${id} (${describeSensor(id)})`,
  );
};

export const isProbeSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'usb' in navigator;

/** Must be called from a click: WebUSB needs a user gesture to open its picker. */
export const runHardwareProbe = async (
  onProgress: (message: string) => void = () => {},
): Promise<string> => {
  let blobs = 0;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const transport = createNgioUsbTransport({
    profile: 'probe',
    streamingWatchdog: true,
    sourceLabel: 'Hardware probe',
    onStreamStart: () => onProgress('Streaming — collecting raw measurement bytes…'),
    onStreaming: (_result, session) => {
      // Only measurement blobs count; replies to polling commands do not.
      if (session.sampleCount > blobs) {
        blobs = session.sampleCount;
        if (blobs >= BLOBS_WANTED) finish();
      }
    },
  });

  transport.onStatus((status) => {
    onProgress(status.message);
    if (status.kind === 'error' || status.kind === 'unsupported') finish();
  });

  const timeout = setTimeout(finish, PROBE_TIMEOUT_MS);
  try {
    await transport.connect();
    await transport.start({ periodSeconds: PROBE_PERIOD_S });
    await finished;
  } finally {
    clearTimeout(timeout);
  }

  const session = transport.session();
  const snapshot = transport.diagnostics();
  const detected = formatDetected(session?.channelSensorIds ?? {});
  snapshot.notes.unshift(...detected, `Measurement blobs collected: ${blobs} of ${BLOBS_WANTED}.`);

  await transport.disconnect();
  return formatDiagnostics(snapshot);
};
