/**
 * LabQuest over WebUSB — the transport that actually reaches the hardware.
 *
 * The LabQuest family does NOT enumerate as HID. Read from the device tree of
 * a Windows machine with a LabQuest Mini attached:
 *
 *   HardwareIds:   USB\VID_08F7&PID_0008&REV_0001
 *   CompatibleIds: USB\COMPAT_VID_08F7&Class_FF&SubClass_00&Prot_00
 *   Service:       WINUSB
 *   Class:         VST_WinUSB  ("Vernier LabQuest Mini")
 *
 * Class 0xFF is vendor-specific with bulk endpoints, so `navigator.hid` has
 * nothing to offer for this vendor ID and its picker opens empty — that is the
 * whole of the "it will not connect" symptom, and no amount of framing work
 * fixes it.
 *
 * The `WINUSB` service line is the other half. Vernier's driver package binds
 * the interface to Microsoft's WinUSB, and a WinUSB binding is exactly the
 * precondition Chrome requires before it will hand a device to WebUSB. So the
 * installed Vernier software is what *enables* this path rather than what
 * blocks it, which is why Vernier's own browser build of Graphical Analysis
 * drives a LabQuest Mini over USB in Chrome.
 *
 * The framing this speaks was measured from Graphical Analysis driving this
 * same hardware; see the provenance note in `ngioPackets.ts`.
 */

import {
  VERNIER_VENDOR_ID,
  describeVernierDevice,
  findVernierDevice,
  webUsbFilters,
} from '../deviceIds.ts';
import {
  DEFAULT_PERIOD_SECONDS,
  describePhase,
  startSession,
  step,
  type SessionState,
} from '../ngioSession.ts';
import { conditionSample, type MotionSample } from '../motionStream.ts';
import { DEFAULT_SENSOR_CONTEXT, findSensor, type SensorContext } from '../sensorIds.ts';
import { createTrafficLog } from '../diagnostics.ts';
import { createEmitter, type MotionSource, type SourceStatus, type StartOptions } from './types.ts';

// WebUSB is absent from TypeScript's DOM library.
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
  alternate?: UsbAlternateInterface;
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
  reset: () => Promise<void>;
  selectConfiguration: (value: number) => Promise<void>;
  claimInterface: (value: number) => Promise<void>;
  releaseInterface: (value: number) => Promise<void>;
  clearHalt: (direction: 'in' | 'out', endpointNumber: number) => Promise<void>;
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

/** How long to wait for a reply before declaring the current step stuck. */
const RESPONSE_TIMEOUT_MS = 1500;

/**
 * Receive buffer for each bulk read, matching the 30000 Vernier's own WebUSB
 * transport uses.
 *
 * This is not padding-paranoia. A bulk `transferIn` shorter than the packet
 * the device sends fails the transfer outright — WinUSB reports `babble` — so
 * reading into a 64-byte buffer loses every reply longer than 64 bytes and,
 * if the status is not inspected, looks exactly like a device that never
 * answered.
 */
const BULK_RECEIVE_BUFSIZE = 30000;

/**
 * Prefers the interface exposing a bulk pair rather than trusting that the
 * NGIO endpoints live on interface 0. Falls back to the first interface so a
 * device with an unexpected layout still reports real endpoint numbers into
 * the diagnostics instead of failing blind.
 */
const pickInterface = (configuration: UsbConfiguration | null): UsbInterface | null => {
  const interfaces = configuration?.interfaces ?? [];
  const withBulkPair = interfaces.find((candidate) => {
    const endpoints = candidate.alternate?.endpoints ?? [];
    return (
      endpoints.some((endpoint) => endpoint.direction === 'in' && endpoint.type === 'bulk') &&
      endpoints.some((endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk')
    );
  });
  return withBulkPair ?? interfaces[0] ?? null;
};

const pickEndpoint = (usbInterface: UsbInterface, direction: 'in' | 'out'): UsbEndpoint | null => {
  const endpoints = usbInterface.alternate?.endpoints ?? [];
  const matching = endpoints.filter((endpoint) => endpoint.direction === direction);
  return matching.find((endpoint) => endpoint.type === 'bulk') ?? matching[0] ?? null;
};

export const createWebUsbSource = (): MotionSource => {
  const samples = createEmitter<MotionSample>();
  const statuses = createEmitter<SourceStatus>();
  const traffic = createTrafficLog(80);

  let device: UsbDevice | null = null;
  let interfaceNumber = 0;
  let inEndpoint = 0;
  let outEndpoint = 0;
  let session: SessionState | null = null;
  let lastGood: MotionSample | null = null;
  /**
   * The instrument context every raw tick is converted through. Mutable so the
   * calibrate screen can change the scale mid-session; the next sample picks it
   * up and no stream is disturbed.
   */
  let sensorContext: SensorContext = DEFAULT_SENSOR_CONTEXT;
  let reading = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  /**
   * Counted so the diagnostics can distinguish the three ways a probe fails:
   * writes rejected, writes accepted but device mute, or device answering in a
   * shape we cannot decode.
   */
  let writesAccepted = 0;
  let framesReceived = 0;
  const notes: string[] = [];
  let status: SourceStatus = {
    kind: usbApi() ? 'idle' : 'unsupported',
    message: usbApi()
      ? 'Not connected'
      : 'This browser has no WebUSB. Chrome or Edge is required to read a LabQuest.',
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

  /**
   * Records the outcome, not just the intent. The traffic log is written
   * before the transfer resolves, so without this a rejected write and a
   * silent device produce an identical transcript — which is exactly the
   * ambiguity that made the first round of diagnostics unreadable.
   */
  const write = async (bytes: Uint8Array) => {
    if (!device) return;
    traffic.push('tx', bytes);
    try {
      const result = await device.transferOut(outEndpoint, bytes);
      const outcome = (result as { status?: string } | undefined)?.status;
      if (outcome && outcome !== 'ok') {
        notes.push(`transferOut on endpoint ${outEndpoint} returned "${outcome}".`);
      } else {
        writesAccepted += 1;
      }
    } catch (error) {
      notes.push(`transferOut on endpoint ${outEndpoint} threw: ${String(error)}`);
      throw error;
    }
  };

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
      armWatchdog();
      if (previousPhase !== 'streaming') {
        // A restart re-zeroes the device's capture clock, so the last accepted
        // sample is from a different timeline. Carrying it across would make
        // the first reading of the new rate a dropout on a negative dt.
        lastGood = null;
        setStatus({
          kind: 'streaming',
          message: describePhase(session),
          sensorName: session.sensorName,
        });
      }

      const sensor = findSensor(session.sensorId);
      result.samples.forEach((raw) => {
        // The one place raw ticks become metres, and therefore the one place
        // the calibration scale is applied. Everything downstream — the
        // plausibility gate below, the recorded buffer, derived velocity,
        // scoring, the submitted samples — sees corrected metres for free.
        const distance = sensor ? sensor.toPhysical(raw.raw, sensorContext) : Number.NaN;
        const sample = conditionSample(lastGood, { t: raw.t, distance });
        if (sample.quality === 'ok') lastGood = sample;
        samples.emit(sample);
      });
      return;
    }

    if (previousPhase === session.phase) return;

    // A rate change and a stop are both brief detours out of 'streaming'. They
    // are not a device that is still connecting, and reporting them that way
    // would blank the reading the page is showing mid-round.
    if (session.retuning) return;

    setStatus({
      kind: session.phase === 'stopped' ? 'ready' : 'connecting',
      message: describePhase(session),
      sensorName: session.sensorName,
    });
  };

  /**
   * Bulk endpoints have no event to subscribe to; the read loop polls from the
   * moment the interface is claimed until disconnect.
   */
  const readLoop = async () => {
    while (reading && device) {
      try {
        const result = await device.transferIn(inEndpoint, BULK_RECEIVE_BUFSIZE);
        if (!reading) break;

        // Never swallow a non-ok status. Discarding these silently is what
        // made a stalled pipe indistinguishable from a mute device.
        if (result.status === 'stall') {
          notes.push(`Bulk IN ${inEndpoint} stalled; clearing halt and retrying.`);
          await device.clearHalt('in', inEndpoint).catch(() => {});
          continue;
        }
        if (result.status !== 'ok') {
          notes.push(`transferIn on endpoint ${inEndpoint} returned "${result.status}".`);
          continue;
        }
        if (!result.data) continue;

        const bytes = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset,
          result.data.byteLength,
        );
        traffic.push('rx', bytes);
        framesReceived += 1;
        handleSessionReport(bytes);
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
    label: 'LabQuest over USB',
    isReal: true,
    isSupported: () => usbApi() !== null,

    connect: async () => {
      const usb = usbApi();
      if (!usb) {
        setStatus({
          kind: 'unsupported',
          message: 'This browser has no WebUSB. Chrome or Edge is required to read a LabQuest.',
          sensorName: null,
        });
        return;
      }

      setStatus({ kind: 'connecting', message: 'Choose your interface', sensorName: null });

      // Reuse a previously granted device so a reconnect skips the picker.
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
        fail(
          `${describeVernierDevice(chosen.vendorId, chosen.productId)} is not an interface this page can read. ` +
            'Connect a LabQuest Mini, LabQuest 2, or LabQuest 3.',
        );
        return;
      }

      try {
        if (!chosen.opened) await chosen.open();
        await chosen.selectConfiguration(1);

        // Vernier's own transport resets every device except the LabQuest 3
        // before claiming it, and tolerates the reset failing. Windows often
        // rejects it; a Mini left mid-session by Logger Pro needs it.
        if (known.productId !== 0x0015) {
          await chosen.reset().catch((error: unknown) => {
            notes.push(`device.reset() failed (expected on Windows): ${String(error)}`);
          });
        }

        const usbInterface = pickInterface(chosen.configuration);
        if (!usbInterface) {
          fail('The interface exposes no USB interface to claim.');
          return;
        }

        interfaceNumber = usbInterface.interfaceNumber;
        await chosen.claimInterface(interfaceNumber);

        const incoming = pickEndpoint(usbInterface, 'in');
        const outgoing = pickEndpoint(usbInterface, 'out');

        if (!incoming || !outgoing) {
          fail('Could not find the USB endpoints to talk to the interface.');
          return;
        }

        inEndpoint = incoming.endpointNumber;
        outEndpoint = outgoing.endpointNumber;
        notes.push(
          `Claimed interface ${interfaceNumber}; ${incoming.type} IN ${inEndpoint}, ${outgoing.type} OUT ${outEndpoint}.`,
        );
      } catch (error) {
        notes.push(`claim failed: ${String(error)}`);
        fail(
          'The browser could not claim the interface. Close Logger Pro, Graphical Analysis, or ' +
            'any other tab holding the LabQuest, then try again.',
        );
        return;
      }

      reading = true;
      void readLoop();

      setStatus({ kind: 'ready', message: 'Interface ready', sensorName: null });
    },

    start: async ({ periodSeconds = DEFAULT_PERIOD_SECONDS }: StartOptions = {}) => {
      if (!device) {
        fail('Connect the interface first.');
        return;
      }

      lastGood = null;
      const opened = startSession({ periodSeconds });
      session = opened.state;
      setStatus({ kind: 'connecting', message: describePhase(session), sensorName: null });

      for (const packet of opened.writes) {
        await write(packet);
      }
      armWatchdog();
    },

    setPeriod: async (periodSeconds: number) => {
      if (!session) return;
      const result = step(session, { type: 'set-period', periodSeconds });
      session = result.state;
      for (const packet of result.writes) {
        await write(packet);
      }
      // The retune sequence waits on replies like any other command, so it
      // needs the same watchdog. Without it a device that goes quiet part way
      // through leaves the stream stopped and nothing ever says so.
      if (result.writes.length > 0) armWatchdog();
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

    setSensorContext: (next: SensorContext) => {
      sensorContext = next;
    },

    subscribe: samples.subscribe,
    onStatus: statuses.subscribe,

    diagnostics: () => ({
      sourceId: 'webusb',
      sourceLabel: 'LabQuest over USB (WebUSB)',
      deviceName: device?.productName ?? null,
      vendorId: device?.vendorId ?? null,
      productId: device?.productId ?? null,
      phase: session ? session.phase : status.kind,
      sensorId: session?.sensorId ?? null,
      sensorName: session?.sensorName ?? null,
      error: status.kind === 'error' ? status.message : (session?.error ?? null),
      traffic: traffic.entries(),
      notes: [
        ...notes,
        `Writes accepted by the USB stack: ${writesAccepted}. Frames received: ${framesReceived}.`,
      ],
    }),
  };
};
