/**
 * The diagnostics dump.
 *
 * This exists because the NGIO framing is a hypothesis (see `ngioPackets.ts`)
 * and there is no way to settle it without a device on the other end of the
 * cable. When a connection fails, this turns "it did not work" into a transcript
 * someone can read: what enumerated, what was sent, what came back, and at
 * which step it stopped.
 *
 * Pure formatting over plain data, so it is testable and so the panel that
 * renders it stays dumb.
 */

import { describeVernierDevice } from './deviceIds.ts';
import { toHex, type NgioFraming } from './ngioPackets.ts';

export type TrafficDirection = 'tx' | 'rx';

export interface TrafficEntry {
  /** Milliseconds since the log was created. */
  at: number;
  direction: TrafficDirection;
  bytes: Uint8Array;
}

export interface TrafficLog {
  push: (direction: TrafficDirection, bytes: Uint8Array) => void;
  entries: () => TrafficEntry[];
  clear: () => void;
}

/**
 * Keeps the most recent `limit` frames. Bounded because a 20 Hz stream would
 * otherwise fill memory during a long session, and because the useful part of
 * a failed handshake is always the last few frames.
 */
export const createTrafficLog = (limit = 60, now: () => number = () => Date.now()): TrafficLog => {
  const started = now();
  let entries: TrafficEntry[] = [];

  return {
    push: (direction, bytes) => {
      entries.push({ at: now() - started, direction, bytes: bytes.slice() });
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
    },
    entries: () => entries.slice(),
    clear: () => {
      entries = [];
    },
  };
};

export interface HidCollectionSummary {
  usagePage: number;
  usage: number;
  inputReportBytes: number | null;
  outputReportBytes: number | null;
}

export interface DiagnosticsSnapshot {
  sourceId: string;
  sourceLabel: string;
  deviceName: string | null;
  vendorId: number | null;
  productId: number | null;
  collections: HidCollectionSummary[];
  framing: NgioFraming | null;
  phase: string;
  sensorId: number | null;
  sensorName: string | null;
  error: string | null;
  traffic: TrafficEntry[];
  notes: string[];
}

const hex4 = (value: number | null): string =>
  value === null ? 'unknown' : `0x${value.toString(16).padStart(4, '0')}`;

/**
 * Trims trailing zero padding for display. A 64-byte report whose last 55
 * bytes are zeros tells you nothing, and the padding buries the part that
 * matters.
 */
const significantBytes = (bytes: Uint8Array): Uint8Array => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return bytes.subarray(0, Math.max(end, 1));
};

export const formatDiagnostics = (snapshot: DiagnosticsSnapshot): string => {
  const lines: string[] = [];

  lines.push('Physics Nook — Vernier device diagnostics');
  lines.push(new Date().toISOString());
  lines.push('');
  lines.push(`Source:   ${snapshot.sourceLabel} (${snapshot.sourceId})`);
  lines.push(
    `Device:   ${snapshot.deviceName ?? 'none'} ${
      snapshot.vendorId === null && snapshot.productId === null
        ? ''
        : `[${hex4(snapshot.vendorId)}:${hex4(snapshot.productId)}]`
    }`.trimEnd(),
  );

  if (snapshot.vendorId !== null && snapshot.productId !== null) {
    lines.push(`Known as: ${describeVernierDevice(snapshot.vendorId, snapshot.productId)}`);
  }

  lines.push(
    `Framing:  ${
      snapshot.framing
        ? `sync 0x${snapshot.framing.syncByte.toString(16)}, report ${snapshot.framing.reportId}`
        : 'not established'
    }`,
  );
  lines.push(`Phase:    ${snapshot.phase}`);
  lines.push(
    `Sensor:   ${snapshot.sensorName ?? 'unknown'}${
      snapshot.sensorId === null ? '' : ` (ID ${snapshot.sensorId})`
    }`,
  );

  if (snapshot.error) {
    lines.push(`Error:    ${snapshot.error}`);
  }

  if (snapshot.collections.length > 0) {
    lines.push('');
    lines.push('HID collections');
    snapshot.collections.forEach((collection, index) => {
      lines.push(
        `  [${index}] usagePage ${hex4(collection.usagePage)} usage ${hex4(collection.usage)} ` +
          `in ${collection.inputReportBytes ?? '?'}B out ${collection.outputReportBytes ?? '?'}B`,
      );
    });
  }

  if (snapshot.traffic.length > 0) {
    lines.push('');
    lines.push(`Traffic (last ${snapshot.traffic.length} frames, trailing zeros trimmed)`);
    snapshot.traffic.forEach((entry) => {
      const stamp = `${(entry.at / 1000).toFixed(3)}s`.padStart(9);
      const arrow = entry.direction === 'tx' ? '-->' : '<--';
      lines.push(`  ${stamp} ${arrow} ${toHex(significantBytes(entry.bytes))}`);
    });
  }

  if (snapshot.notes.length > 0) {
    lines.push('');
    lines.push('Notes');
    snapshot.notes.forEach((note) => lines.push(`  - ${note}`));
  }

  return lines.join('\n');
};
