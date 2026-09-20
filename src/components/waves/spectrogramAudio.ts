/**
 * The Web Audio half of the Live Spectrogram.
 *
 * This lives under components/ rather than lib/ because everything in it
 * touches AudioContext, MediaStream, or fetch. The declarative half - what the
 * example sounds *are*, and what the source state machine does - is pure and
 * lives in src/lib/waves/.
 */
import { createRng } from '../../lib/shared/rng.ts';
import type { ExampleSpec } from '../../lib/waves/spectrogramExamples.ts';
import { fillPinkNoise, fillWhiteNoise } from '../../lib/waves/spectrogramExamples.ts';
import type { MicFailure } from '../../lib/waves/spectrogramSources.ts';

type AudioContextConstructor = typeof AudioContext;

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null;
  const scoped = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? scoped.webkitAudioContext ?? null;
};

export interface SpectrogramGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  /** Every source connects here. */
  input: GainNode;
  /** Muted whenever the source is the microphone, or the room howls. */
  monitor: GainNode;
}

export interface GraphOptions {
  fftSize: number;
  minDecibels: number;
  maxDecibels: number;
  /**
   * Match the capture device when one is already open. Chrome can hand back a
   * permanently silent MediaStreamAudioSourceNode when the context runs at a
   * different rate from the microphone, so the microphone path asks for the
   * stream first and builds the context around it.
   */
  sampleRate?: number;
}

export const createSpectrogramGraph = (options: GraphOptions): SpectrogramGraph | null => {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;

  let context: AudioContext;
  try {
    context = options.sampleRate ? new Ctor({ sampleRate: options.sampleRate }) : new Ctor();
  } catch {
    // Some browsers reject an explicit rate they cannot honour.
    context = new Ctor();
  }
  const input = context.createGain();
  const analyser = context.createAnalyser();
  const monitor = context.createGain();

  analyser.fftSize = options.fftSize;
  analyser.minDecibels = options.minDecibels;
  analyser.maxDecibels = options.maxDecibels;
  // Not the 0.8 default. Temporal smoothing blurs the time axis, which would
  // quietly falsify the window-length demonstration this whole page is built
  // around: a short window would still look smeared in time.
  analyser.smoothingTimeConstant = 0;

  input.connect(analyser);
  analyser.connect(monitor);
  monitor.connect(context.destination);

  return { context, analyser, input, monitor };
};

const safeDisconnect = (node: AudioNode | null | undefined): void => {
  try {
    node?.disconnect();
  } catch {
    // The node may already have been torn down by a source that ended.
  }
};

export const closeSpectrogramGraph = (graph: SpectrogramGraph | null): void => {
  if (!graph) return;
  safeDisconnect(graph.input);
  safeDisconnect(graph.analyser);
  safeDisconnect(graph.monitor);
  graph.context.close().catch(() => {
    // Closing an already-closed context is not worth reporting.
  });
};

/** Chrome's autoplay policy and iOS both park a fresh context in 'suspended'. */
export const resumeGraph = async (graph: SpectrogramGraph): Promise<void> => {
  if (graph.context.state === 'suspended') {
    try {
      await graph.context.resume();
    } catch {
      // Nothing useful to do; the caller will see an empty display.
    }
  }
};

// ---------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------

export type MicrophoneSupport = 'ok' | 'insecure' | 'unsupported';

/**
 * Checked before the button renders, so an insecure origin shows a disabled
 * button with an explanation rather than a prompt that can never succeed.
 */
export const microphoneSupport = (): MicrophoneSupport => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (!navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext === false ? 'insecure' : 'unsupported';
  }
  return window.isSecureContext === false ? 'insecure' : 'ok';
};

export type MicrophoneResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: MicFailure };

export const requestMicrophone = async (): Promise<MicrophoneResult> => {
  const support = microphoneSupport();
  if (support !== 'ok') return { ok: false, reason: support };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      // All three off. The browser's voice-call processing gates quiet sounds,
      // flattens dynamics, and notches steady tones - precisely the structure
      // this lesson asks the reader to look at. Leaving them on would make the
      // display lie.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    return { ok: true, stream };
  } catch (error) {
    const name = (error as DOMException | undefined)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'no-device' };
    }
    return { ok: false, reason: 'error' };
  }
};

/** The rate the capture device is actually running at, when it will say. */
export const streamSampleRate = (stream: MediaStream): number | undefined => {
  const settings = stream.getAudioTracks()[0]?.getSettings?.();
  return typeof settings?.sampleRate === 'number' ? settings.sampleRate : undefined;
};

/**
 * Watch for the track going silent or disappearing.
 *
 * `muted` on a MediaStreamTrack does not mean the user muted it: it means the
 * track is not delivering data at all, which is exactly the "connected but
 * nothing is happening" case. Without this the UI has no way to tell that
 * apart from a quiet room.
 */
export const watchTrack = (
  stream: MediaStream,
  onChange: (state: { live: boolean; silent: boolean }) => void,
): (() => void) => {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    onChange({ live: false, silent: true });
    return () => {};
  }

  const report = () => onChange({ live: track.readyState === 'live', silent: track.muted });
  track.addEventListener('mute', report);
  track.addEventListener('unmute', report);
  track.addEventListener('ended', report);
  report();

  return () => {
    track.removeEventListener('mute', report);
    track.removeEventListener('unmute', report);
    track.removeEventListener('ended', report);
  };
};

/**
 * Stopping every track is what actually turns off the operating system's
 * recording indicator. Disconnecting the source node alone leaves it lit.
 */
export const releaseMicrophone = (stream: MediaStream | null): void => {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already ended.
    }
  }
};

// ---------------------------------------------------------------------------
// Playable sources
// ---------------------------------------------------------------------------

export interface ActiveSource {
  stop(): void;
}

/** Long enough that the loop seam is inaudible, short enough to build fast. */
const NOISE_SECONDS = 2;
const RAMP_SECONDS = 0.015;

const makeNoiseBuffer = (context: AudioContext, color: 'white' | 'pink'): AudioBuffer => {
  const length = Math.floor(context.sampleRate * NOISE_SECONDS);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);
  // Seeded, so the same example produces the same picture every time it runs.
  const random = createRng(0x5eed).next;
  if (color === 'pink') fillPinkNoise(channel, random);
  else fillWhiteNoise(channel, random);
  return buffer;
};

/**
 * Turn a declarative example spec into sounding nodes.
 *
 * The 15 ms envelope matters more than it looks: switching a tone on
 * instantaneously is a step function, and a step is broadband - it would paint
 * a full-height click across the display every time an example started, right
 * next to the prose explaining that a vertical streak means an impulse.
 */
export const startExample = (
  graph: SpectrogramGraph,
  spec: ExampleSpec,
  durationSeconds: number,
  onEnded: () => void,
): ActiveSource => {
  const { context, input } = graph;
  const now = context.currentTime;
  const endAt = now + durationSeconds;

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(1, now + RAMP_SECONDS);
  envelope.connect(input);

  const nodes: AudioScheduledSourceNode[] = [];

  switch (spec.kind) {
    case 'partials': {
      const total = spec.partials.reduce((sum, partial) => sum + partial.gain, 0) || 1;
      for (const partial of spec.partials) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(partial.hz, now);
        gain.gain.setValueAtTime((partial.gain / total) * 0.9, now);
        oscillator.connect(gain).connect(envelope);
        nodes.push(oscillator);
      }
      break;
    }

    case 'sweep': {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(spec.fromHz, now);
      if (spec.sweep === 'log') {
        oscillator.frequency.exponentialRampToValueAtTime(spec.toHz, endAt);
      } else {
        oscillator.frequency.linearRampToValueAtTime(spec.toHz, endAt);
      }
      gain.gain.setValueAtTime(0.8, now);
      oscillator.connect(gain).connect(envelope);
      nodes.push(oscillator);
      break;
    }

    case 'fm': {
      const carrier = context.createOscillator();
      const modulator = context.createOscillator();
      const depth = context.createGain();
      const gain = context.createGain();
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(spec.carrierHz, now);
      modulator.type = 'sine';
      modulator.frequency.setValueAtTime(spec.rateHz, now);
      depth.gain.setValueAtTime(spec.depthHz, now);
      modulator.connect(depth).connect(carrier.frequency);
      gain.gain.setValueAtTime(0.8, now);
      carrier.connect(gain).connect(envelope);
      nodes.push(carrier, modulator);
      break;
    }

    case 'noise': {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = makeNoiseBuffer(context, spec.color);
      source.loop = true;
      gain.gain.setValueAtTime(spec.color === 'pink' ? 0.9 : 0.5, now);
      source.connect(gain).connect(envelope);
      nodes.push(source);
      break;
    }

    default:
      break;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnded();
  };

  envelope.gain.setValueAtTime(1, Math.max(now, endAt - RAMP_SECONDS));
  envelope.gain.linearRampToValueAtTime(0, endAt);

  for (const node of nodes) {
    node.start(now);
    node.stop(endAt + 0.02);
  }
  if (nodes.length > 0) nodes[0].onended = finish;
  else finish();

  return {
    stop() {
      const at = context.currentTime;
      try {
        envelope.gain.cancelScheduledValues(at);
        envelope.gain.setValueAtTime(envelope.gain.value, at);
        envelope.gain.linearRampToValueAtTime(0, at + RAMP_SECONDS);
      } catch {
        // A context closing underneath us; the nodes are about to go anyway.
      }
      for (const node of nodes) {
        try {
          node.stop(at + RAMP_SECONDS + 0.01);
        } catch {
          // Already stopped.
        }
      }
      window.setTimeout(() => safeDisconnect(envelope), 200);
      finish();
    },
  };
};

export const playBuffer = (
  graph: SpectrogramGraph,
  buffer: AudioBuffer,
  onEnded: () => void,
): ActiveSource => {
  const { context, input } = graph;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(0.9, context.currentTime);
  source.connect(gain).connect(input);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    safeDisconnect(gain);
    onEnded();
  };
  source.onended = finish;
  source.start();

  return {
    stop() {
      try {
        source.stop();
      } catch {
        // Already stopped; onended still fires.
      }
      finish();
    },
  };
};

/**
 * Fetch and decode a clip. Returns null rather than throwing: a missing or
 * undecodable file disables one entry in the picker and nothing else.
 */
export const loadClip = async (
  context: AudioContext,
  url: string,
): Promise<AudioBuffer | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    return null;
  }
};
