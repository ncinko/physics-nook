/**
 * LabQuest Mini over WebHID.
 *
 * WebHID rather than WebUSB because every Vernier interface enumerates as a
 * USB HID class device, and on Windows a HID device can be claimed from the
 * browser with no driver replacement and no disruption to an existing Logger
 * Pro or Graphical Analysis install. WebUSB would need the device rebound to
 * WinUSB, which breaks those apps.
 *
 * Everything decidable lives in `ngioSession.ts`. This file is the part that
 * cannot be unit tested: opening the device, moving bytes, and running the
 * clocks.
 */

import {
  VERNIER_VENDOR_ID,
  describeVernierDevice,
  findVernierDevice,
  webHidFilters,
} from '../deviceIds.ts';
import {
  FRAMING_CANDIDATES,
  NGIO_CMD_ID,
  encodeCommand,
  probeFramingResponse,
  type NgioFraming,
} from '../ngioPackets.ts';
import {
  DEFAULT_PERIOD_SECONDS,
  describePhase,
  startSession,
  step,
  type SessionState,
} from '../ngioSession.ts';
import { conditionSample, type MotionSample } from '../motionStream.ts';
import { findSensor, DEFAULT_SENSOR_CONTEXT } from '../sensorIds.ts';
import { createTrafficLog, type HidCollectionSummary } from '../diagnostics.ts';
import { createEmitter, type MotionSource, type SourceStatus, type StartOptions } from './types.ts';

// WebHID is not in TypeScript's DOM library — it is a WICG spec Chrome and
// Edge ship and other engines do not. These are the parts we use.
interface HidReportItem {
  reportCount?: number;
  reportSize?: number;
}

interface HidReportInfo {
  reportId: number;
  items?: HidReportItem[];
}

interface HidCollectionInfo {
  usagePage: number;
  usage: number;
  inputReports?: HidReportInfo[];
  outputReports?: HidReportInfo[];
}

interface HidInputReportEvent extends Event {
  data: DataView;
  reportId: number;
}

interface HidDevice extends EventTarget {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  collections: HidCollectionInfo[];
  open: () => Promise<void>;
  close: () => Promise<void>;
  sendReport: (reportId: number, data: Uint8Array) => Promise<void>;
}

interface HidApi extends EventTarget {
  requestDevice: (options: { filters: { vendorId: number }[] }) => Promise<HidDevice[]>;
  getDevices: () => Promise<HidDevice[]>;
}

const hidApi = (): HidApi | null => {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { hid?: HidApi }).hid ?? null;
};

/** How long to wait for a reply before declaring the current step stuck. */
const RESPONSE_TIMEOUT_MS = 1500;

/** How long each framing candidate gets to prove itself. */
const FRAMING_PROBE_MS = 300;

const reportBytes = (reports: HidReportInfo[] | undefined): number | null => {
  const first = reports?.[0];
  if (!first?.items) return null;
  const bits = first.items.reduce(
    (total, item) => total + (item.reportCount ?? 0) * (item.reportSize ?? 0),
    0,
  );
  return bits > 0 ? Math.ceil(bits / 8) : null;
};

const summariseCollections = (device: HidDevice): HidCollectionSummary[] =>
  device.collections.map((collection) => ({
    usagePage: collection.usagePage,
    usage: collection.usage,
    inputReportBytes: reportBytes(collection.inputReports),
    outputReportBytes: reportBytes(collection.outputReports),
  }));

export const createWebHidSource = (): MotionSource => {
  const samples = createEmitter<MotionSample>();
  const statuses = createEmitter<SourceStatus>();
  const traffic = createTrafficLog(80);

  let device: HidDevice | null = null;
  let framing: NgioFraming | null = null;
  let session: SessionState | null = null;
  let lastGood: MotionSample | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let onReport: ((event: HidInputReportEvent) => void) | null = null;
  const notes: string[] = [];
  let status: SourceStatus = {
    kind: hidApi() ? 'idle' : 'unsupported',
    message: hidApi()
      ? 'Not connected'
      : 'This browser has no WebHID. Chrome or Edge is required to read a LabQuest.',
    sensorName: null,
  };

  const setStatus = (next: SourceStatus) => {
    status = next;
    statuses.emit(next);
  };

  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const write = async (bytes: Uint8Array) => {
    if (!device || !framing) return;
    traffic.push('tx', bytes);
    await device.sendReport(framing.reportId, bytes);
  };

  const fail = (message: string) => {
    clearWatchdog();
    setStatus({ kind: 'error', message, sensorName: session?.sensorName ?? null });
  };

  /** Restarts the reply watchdog whenever a command goes out. */
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (!session) return;
      const result = step(session, { type: 'timeout' });
      session = result.state;
      fail(result.state.error ?? 'The interface stopped responding.');
    }, RESPONSE_TIMEOUT_MS);
  };

  /** Feeds one inbound report through the session and publishes any samples. */
  const handleSessionReport = (bytes: Uint8Array) => {
    if (!session) return;

    const result = step(session, { type: 'report', bytes });
    const previousPhase = session.phase;
    session = result.state;

    result.writes.forEach((packet) => {
      void write(packet);
    });

    if (result.writes.length > 0) armWatchdog();

    if (session.phase === 'failed') {
      fail(session.error ?? 'The interface rejected the connection.');
      return;
    }

    if (session.phase === 'streaming') {
      // Streaming reports arrive continuously; the watchdog now guards against
      // the stream drying up rather than against a slow reply.
      armWatchdog();

      if (previousPhase !== 'streaming') {
        setStatus({
          kind: 'streaming',
          message: describePhase(session),
          sensorName: session.sensorName,
        });
      }

      const sensor = findSensor(session.sensorId);
      result.samples.forEach((raw) => {
        const distance = sensor
          ? sensor.toPhysical(raw.raw, DEFAULT_SENSOR_CONTEXT)
          : Number.NaN;
        const sample = conditionSample(lastGood, { t: raw.t, distance });
        if (sample.quality === 'ok') lastGood = sample;
        samples.emit(sample);
      });
      return;
    }

    if (previousPhase !== session.phase) {
      setStatus({
        kind: 'connecting',
        message: describePhase(session),
        sensorName: session.sensorName,
      });
    }
  };

  /**
   * Sends GET_STATUS under each candidate framing and keeps the first that
   * produces a decodable reply. Without a device we cannot know which framing
   * the LabQuest Mini uses; with one, this settles it in about a second.
   */
  const probeFraming = async (target: HidDevice): Promise<NgioFraming | null> => {
    for (const candidate of FRAMING_CANDIDATES) {
      const packet = encodeCommand({
        command: NGIO_CMD_ID.GET_STATUS,
        rollingCounter: 0,
        framing: candidate,
      });

      const answered = await new Promise<boolean>((resolve) => {
        const listener = (event: Event) => {
          const report = event as HidInputReportEvent;
          const bytes = new Uint8Array(report.data.buffer, report.data.byteOffset, report.data.byteLength);
          traffic.push('rx', bytes);
          if (probeFramingResponse(bytes, candidate)) {
            target.removeEventListener('inputreport', listener);
            clearTimeout(timer);
            resolve(true);
          }
        };

        const timer = setTimeout(() => {
          target.removeEventListener('inputreport', listener);
          resolve(false);
        }, FRAMING_PROBE_MS);

        target.addEventListener('inputreport', listener);
        traffic.push('tx', packet);
        target.sendReport(candidate.reportId, packet).catch(() => {
          // A rejected write just means this candidate is wrong; let the
          // timeout move on to the next one.
        });
      });

      if (answered) {
        notes.push(
          `Framing settled empirically: sync 0x${candidate.syncByte.toString(16)}, report ${candidate.reportId}.`,
        );
        return candidate;
      }
    }

    return null;
  };

  return {
    id: 'webhid',
    label: 'LabQuest over USB',
    isReal: true,
    isSupported: () => hidApi() !== null,

    connect: async () => {
      const hid = hidApi();
      if (!hid) {
        setStatus({
          kind: 'unsupported',
          message: 'This browser has no WebHID. Chrome or Edge is required to read a LabQuest.',
          sensorName: null,
        });
        return;
      }

      setStatus({ kind: 'connecting', message: 'Choose your interface', sensorName: null });

      // Reuse a previously granted device so a reconnect skips the picker.
      const granted = await hid.getDevices().catch(() => [] as HidDevice[]);
      const remembered = granted.find(
        (candidate) => candidate.vendorId === VERNIER_VENDOR_ID,
      );
      const chosen =
        remembered ?? (await hid.requestDevice({ filters: webHidFilters() }).catch(() => []))[0];

      if (!chosen) {
        setStatus({
          kind: 'idle',
          message: 'No interface selected.',
          sensorName: null,
        });
        return;
      }

      device = chosen;
      const known = findVernierDevice(chosen.productId);

      if (!known || known.family !== 'ngio' || !known.collectsData) {
        fail(
          `${describeVernierDevice(chosen.vendorId, chosen.productId)} is not an interface this page can read. ` +
            'Connect a LabQuest Mini, LabQuest 2, or LabQuest 3.',
        );
        return;
      }

      if (!chosen.opened) {
        try {
          await chosen.open();
        } catch (error) {
          fail(
            'Could not open the interface. Close Logger Pro or Graphical Analysis if either is holding it, then try again.',
          );
          notes.push(`open() threw: ${String(error)}`);
          return;
        }
      }

      setStatus({ kind: 'connecting', message: 'Checking how the interface talks', sensorName: null });

      framing = await probeFraming(chosen);

      if (!framing) {
        fail(
          'The interface is connected but did not answer. Copy the diagnostics below and send them on — ' +
            'this is the protocol detail that needs a real device to pin down.',
        );
        notes.push(
          `No framing candidate produced a decodable reply. Tried: ${FRAMING_CANDIDATES.map(
            (candidate) => `0x${candidate.syncByte.toString(16)}/report ${candidate.reportId}`,
          ).join(', ')}.`,
        );
        return;
      }

      onReport = (event) => {
        const bytes = new Uint8Array(
          event.data.buffer,
          event.data.byteOffset,
          event.data.byteLength,
        );
        traffic.push('rx', bytes);
        handleSessionReport(bytes);
      };
      chosen.addEventListener('inputreport', onReport as EventListener);

      setStatus({ kind: 'ready', message: 'Interface ready', sensorName: null });
    },

    start: async ({ periodSeconds = DEFAULT_PERIOD_SECONDS }: StartOptions = {}) => {
      if (!device || !framing) {
        fail('Connect the interface first.');
        return;
      }

      lastGood = null;
      const opened = startSession({ framing, periodSeconds });
      session = opened.state;
      setStatus({ kind: 'connecting', message: describePhase(session), sensorName: null });

      for (const packet of opened.writes) {
        await write(packet);
      }
      armWatchdog();
    },

    stop: async () => {
      clearWatchdog();
      if (!session) return;

      const result = step(session, { type: 'stop' });
      session = result.state;
      for (const packet of result.writes) {
        await write(packet);
      }
      setStatus({ kind: 'ready', message: 'Stopped', sensorName: session.sensorName });
    },

    disconnect: async () => {
      clearWatchdog();
      if (device && onReport) {
        device.removeEventListener('inputreport', onReport as EventListener);
      }
      if (device?.opened) {
        await device.close().catch(() => {});
      }
      device = null;
      session = null;
      framing = null;
      lastGood = null;
      samples.clear();
      setStatus({ kind: 'idle', message: 'Disconnected', sensorName: null });
      statuses.clear();
    },

    subscribe: samples.subscribe,
    onStatus: statuses.subscribe,

    diagnostics: () => ({
      sourceId: 'webhid',
      sourceLabel: 'LabQuest over USB (WebHID)',
      deviceName: device?.productName ?? null,
      vendorId: device?.vendorId ?? null,
      productId: device?.productId ?? null,
      collections: device ? summariseCollections(device) : [],
      framing,
      phase: session ? session.phase : status.kind,
      sensorId: session?.sensorId ?? null,
      sensorName: session?.sensorName ?? null,
      error: status.kind === 'error' ? status.message : (session?.error ?? null),
      traffic: traffic.entries(),
      notes,
    }),
  };
};
