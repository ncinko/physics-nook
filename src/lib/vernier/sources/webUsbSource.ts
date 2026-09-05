/**
 * The same NGIO protocol over WebUSB, as a fallback.
 *
 * WebHID is the path that should work: Vernier interfaces are HID class, and
 * a HID device can be claimed from Chrome with no driver changes. This exists
 * for the case where WebHID enumerates the interface but will not exchange
 * reports with it.
 *
 * The catch, and it is a real one: on Windows a device is only reachable
 * through WebUSB if it is bound to WinUSB. A machine with Logger Pro or
 * Graphical Analysis installed has Vernier's own driver bound instead, and
 * rebinding would break those applications. So this path is expected to work
 * on macOS, Linux and ChromeOS, and to fail on a typical Windows classroom
 * machine. The connect panel says so rather than offering it as an equal
 * choice.
 *
 * Only the transport differs — the codec and the session state machine are
 * shared with `webHidSource.ts`.
 */

import { VERNIER_VENDOR_ID, findVernierDevice, webUsbFilters } from '../deviceIds.ts';
import { NGIO_DEFAULT_REPORT_LENGTH, type NgioFraming, DEFAULT_FRAMING } from '../ngioPackets.ts';
import {
  DEFAULT_PERIOD_SECONDS,
  describePhase,
  startSession,
  step,
  type SessionState,
} from '../ngioSession.ts';
import { conditionSample, type MotionSample } from '../motionStream.ts';
import { DEFAULT_SENSOR_CONTEXT, findSensor } from '../sensorIds.ts';
import { createTrafficLog } from '../diagnostics.ts';
import { createEmitter, type MotionSource, type SourceStatus, type StartOptions } from './types.ts';

// WebUSB is likewise absent from TypeScript's DOM library.
interface UsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}

interface UsbAlternateInterface {
  endpoints: UsbEndpoint[];
}

interface UsbInterface {
  interfaceNumber: number;
  alternate: UsbAlternateInterface;
}

interface UsbConfiguration {
  interfaces: UsbInterface[];
}

interface UsbInTransferResult {
  data?: DataView;
  status: 'ok' | 'stall' | 'babble';
}

interface UsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: UsbConfiguration | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (value: number) => Promise<void>;
  claimInterface: (value: number) => Promise<void>;
  releaseInterface: (value: number) => Promise<void>;
  transferIn: (endpointNumber: number, length: number) => Promise<UsbInTransferResult>;
  transferOut: (endpointNumber: number, data: Uint8Array) => Promise<unknown>;
}

interface UsbApi {
  requestDevice: (options: { filters: { vendorId: number }[] }) => Promise<UsbDevice>;
  getDevices: () => Promise<UsbDevice[]>;
}

const usbApi = (): UsbApi | null => {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { usb?: UsbApi }).usb ?? null;
};

const RESPONSE_TIMEOUT_MS = 1500;

export const createWebUsbSource = (): MotionSource => {
  const samples = createEmitter<MotionSample>();
  const statuses = createEmitter<SourceStatus>();
  const traffic = createTrafficLog(80);

  let device: UsbDevice | null = null;
  let interfaceNumber = 0;
  let inEndpoint = 0;
  let outEndpoint = 0;
  let framing: NgioFraming = DEFAULT_FRAMING;
  let session: SessionState | null = null;
  let lastGood: MotionSample | null = null;
  let reading = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const notes: string[] = [
    'WebUSB fallback. On Windows this only works if the interface is bound to WinUSB, which conflicts with Logger Pro and Graphical Analysis.',
  ];
  let status: SourceStatus = {
    kind: usbApi() ? 'idle' : 'unsupported',
    message: usbApi() ? 'Not connected' : 'This browser has no WebUSB.',
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

  const fail = (message: string) => {
    clearWatchdog();
    reading = false;
    setStatus({ kind: 'error', message, sensorName: session?.sensorName ?? null });
  };

  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (!session) return;
      const result = step(session, { type: 'timeout' });
      session = result.state;
      fail(result.state.error ?? 'The interface stopped responding.');
    }, RESPONSE_TIMEOUT_MS);
  };

  const write = async (bytes: Uint8Array) => {
    if (!device) return;
    traffic.push('tx', bytes);
    await device.transferOut(outEndpoint, bytes);
  };

  const handleReport = (bytes: Uint8Array) => {
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
        const distance = sensor ? sensor.toPhysical(raw.raw, DEFAULT_SENSOR_CONTEXT) : Number.NaN;
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

  /** Bulk endpoints have no event; the read loop polls until told to stop. */
  const readLoop = async () => {
    while (reading && device) {
      try {
        const result = await device.transferIn(inEndpoint, NGIO_DEFAULT_REPORT_LENGTH);
        if (!reading) break;
        if (result.status !== 'ok' || !result.data) continue;

        const bytes = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset,
          result.data.byteLength,
        );
        traffic.push('rx', bytes);
        handleReport(bytes);
      } catch (error) {
        if (reading) {
          notes.push(`transferIn threw: ${String(error)}`);
          fail('Lost the USB connection to the interface.');
        }
        break;
      }
    }
  };

  return {
    id: 'webusb',
    label: 'LabQuest over USB (WebUSB fallback)',
    isReal: true,
    isSupported: () => usbApi() !== null,

    connect: async () => {
      const usb = usbApi();
      if (!usb) {
        setStatus({ kind: 'unsupported', message: 'This browser has no WebUSB.', sensorName: null });
        return;
      }

      setStatus({ kind: 'connecting', message: 'Choose your interface', sensorName: null });

      const granted = await usb.getDevices().catch(() => [] as UsbDevice[]);
      const remembered = granted.find((candidate) => candidate.vendorId === VERNIER_VENDOR_ID);
      const chosen =
        remembered ?? (await usb.requestDevice({ filters: webUsbFilters() }).catch(() => null));

      if (!chosen) {
        setStatus({ kind: 'idle', message: 'No interface selected.', sensorName: null });
        return;
      }

      device = chosen;
      const known = findVernierDevice(chosen.productId);

      if (!known || known.family !== 'ngio' || !known.collectsData) {
        fail('That is not an interface this page can read.');
        return;
      }

      try {
        if (!chosen.opened) await chosen.open();
        if (!chosen.configuration) await chosen.selectConfiguration(1);

        const usbInterface = chosen.configuration?.interfaces[0];
        if (!usbInterface) {
          fail('The interface exposes no USB interface to claim.');
          return;
        }

        interfaceNumber = usbInterface.interfaceNumber;
        await chosen.claimInterface(interfaceNumber);

        const endpoints = usbInterface.alternate.endpoints;
        inEndpoint = endpoints.find((endpoint) => endpoint.direction === 'in')?.endpointNumber ?? 0;
        outEndpoint = endpoints.find((endpoint) => endpoint.direction === 'out')?.endpointNumber ?? 0;

        if (inEndpoint === 0 || outEndpoint === 0) {
          fail('Could not find the USB endpoints to talk to the interface.');
          return;
        }
      } catch (error) {
        notes.push(`claim failed: ${String(error)}`);
        fail(
          'Windows would not hand the interface to the browser over WebUSB. This is expected when Vernier software is installed — use the WebHID connection instead.',
        );
        return;
      }

      setStatus({ kind: 'ready', message: 'Interface ready', sensorName: null });
    },

    start: async ({ periodSeconds = DEFAULT_PERIOD_SECONDS }: StartOptions = {}) => {
      if (!device) {
        fail('Connect the interface first.');
        return;
      }

      lastGood = null;
      reading = true;
      void readLoop();

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
      if (session) {
        const result = step(session, { type: 'stop' });
        session = result.state;
        for (const packet of result.writes) {
          await write(packet);
        }
      }
      reading = false;
      setStatus({ kind: 'ready', message: 'Stopped', sensorName: session?.sensorName ?? null });
    },

    disconnect: async () => {
      clearWatchdog();
      reading = false;
      if (device?.opened) {
        await device.releaseInterface(interfaceNumber).catch(() => {});
        await device.close().catch(() => {});
      }
      device = null;
      session = null;
      lastGood = null;
      samples.clear();
      setStatus({ kind: 'idle', message: 'Disconnected', sensorName: null });
      statuses.clear();
    },

    subscribe: samples.subscribe,
    onStatus: statuses.subscribe,

    diagnostics: () => ({
      sourceId: 'webusb',
      sourceLabel: 'LabQuest over USB (WebUSB fallback)',
      deviceName: device?.productName ?? null,
      vendorId: device?.vendorId ?? null,
      productId: device?.productId ?? null,
      collections: [],
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
