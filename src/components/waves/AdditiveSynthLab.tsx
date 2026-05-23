import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Music2,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Volume2,
  Waves,
} from 'lucide-react';

type Envelope = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

type VoiceStatus = 'held' | 'release';
type EnvelopeHandle = 'attack' | 'decay' | 'sustain' | 'release';
type SpectrogramScale = 'log' | 'linear';

type NoteKey = {
  id: string;
  label: string;
  midi: number;
  frequency: number;
  isBlack: boolean;
  whiteIndex: number;
};

type SynthVoice = {
  noteId: string;
  label: string;
  frequency: number;
  oscillator: OscillatorNode;
  gain: GainNode;
  status: VoiceStatus;
  releaseTimer: number | null;
};

type AudioGraph = {
  context: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
};

type Preset = {
  key: string;
  label: string;
  detail: string;
  harmonics: number[];
  envelope?: Envelope;
};

type CustomRecipe = {
  harmonics: number[];
  envelope: Envelope;
};

const HARMONIC_COUNT = 16;
const WAVE_SAMPLE_COUNT = 640;
const LIVE_WAVE_REFERENCE_FREQUENCY = 500;
const LIVE_WAVE_SCROLL_RATE = 1;
const LIVE_WAVE_DISPLAY_GAIN = 0.78;
const LIVE_WAVE_WINDOW_MS = 1000 / LIVE_WAVE_REFERENCE_FREQUENCY;
const THREE_NOTE_LOUDNESS_TARGET = 1.5;
const CHORD_LOUDNESS_EXPONENT = Math.log(THREE_NOTE_LOUDNESS_TARGET) / Math.log(3);
const WHITE_KEY_HEIGHT = 168;
const BLACK_KEY_WIDTH = 31;
const BLACK_KEY_HEIGHT = 104;
const DISPLAYED_NOTE_COUNT = 37;
const DISPLAYED_PIANO_MAX_WIDTH = 1040;
const NOTE_START_MIDI = 21;
const NOTE_COUNT = 88;
const NOTE_END_MIDI = NOTE_START_MIDI + NOTE_COUNT - 1;
const KEYBOARD_ROOT_MIN_OCTAVE = 0;
const KEYBOARD_ROOT_MAX_OCTAVE = 7;
const INITIAL_KEYBOARD_ROOT_OCTAVE = 4;
const SPECTROGRAM_MIN_FREQUENCY = 80;
const SPECTROGRAM_MAX_FREQUENCY = 8000;
const SPECTROGRAM_WIDTH = 960;
const SPECTROGRAM_HEIGHT = 480;
const SPECTROGRAM_ROW_HEIGHT = 2;
const SYNTH_ACCENT = '#0f766e';
const SPECTROGRAM_LOG_TICKS = [100, 250, 500, 1000, 2000, 4000, 8000];
const SPECTROGRAM_LINEAR_TICKS = [80, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const COMPUTER_KEY_OFFSETS: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
};

const INITIAL_HARMONICS = [
  1, 0.34, 0.18, 0.1, 0.07, 0.045, 0.032, 0.024,
  0.018, 0.014, 0.011, 0.009, 0.007, 0.006, 0.005, 0.004,
];

const INITIAL_ENVELOPE: Envelope = {
  attack: 0.03,
  decay: 0.16,
  sustain: 0.66,
  release: 0.34,
};

const PRESETS: Preset[] = [
  {
    key: 'sine',
    label: 'Sine',
    detail: 'One clean fundamental',
    harmonics: [1],
    envelope: { attack: 0.02, decay: 0.08, sustain: 0.78, release: 0.22 },
  },
  {
    key: 'square',
    label: 'Square-ish',
    detail: 'Odd harmonics',
    harmonics: Array.from({ length: HARMONIC_COUNT }, (_, index) =>
      index % 2 === 0 ? 1 / (index + 1) : 0,
    ),
    envelope: { attack: 0.018, decay: 0.12, sustain: 0.7, release: 0.28 },
  },
  {
    key: 'saw',
    label: 'Saw-ish',
    detail: 'Bright harmonic slope',
    harmonics: Array.from({ length: HARMONIC_COUNT }, (_, index) => 1 / (index + 1)),
    envelope: { attack: 0.014, decay: 0.11, sustain: 0.68, release: 0.24 },
  },
  {
    key: 'clarinet',
    label: 'Clarinet-ish',
    detail: 'Odd-heavy, reedy',
    harmonics: [1, 0.06, 0.58, 0.04, 0.32, 0.03, 0.18, 0.02, 0.12, 0.01, 0.08, 0.01, 0.05],
    envelope: { attack: 0.06, decay: 0.16, sustain: 0.72, release: 0.32 },
  },
  {
    key: 'bell',
    label: 'Bell-ish',
    detail: 'Glassy upper partials',
    harmonics: [0.72, 0.92, 0.42, 0.18, 0.62, 0.24, 0.08, 0.4, 0.12, 0.32, 0.05, 0.22],
    envelope: { attack: 0.006, decay: 0.58, sustain: 0.2, release: 0.82 },
  },
  {
    key: 'organ',
    label: 'Organ-ish',
    detail: 'Steady full stack',
    harmonics: [1, 0.82, 0.66, 0.54, 0.42, 0.34, 0.28, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08],
    envelope: { attack: 0.025, decay: 0.04, sustain: 0.92, release: 0.18 },
  },
  {
    key: 'pad',
    label: 'Warm Pad',
    detail: 'Slow, mellow blend',
    harmonics: [1, 0.48, 0.31, 0.19, 0.12, 0.08, 0.055, 0.038, 0.027, 0.02],
    envelope: { attack: 0.48, decay: 0.28, sustain: 0.74, release: 0.9 },
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeHarmonics = (values: number[]) =>
  Array.from({ length: HARMONIC_COUNT }, (_, index) => clamp(values[index] ?? 0, 0, 1));

const formatNumber = (value: number, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const formatAxisMilliseconds = (value: number) =>
  value === 0 ? '0 ms' : `${formatNumber(value, value >= 1 ? 1 : 2)} ms`;

const getChordMixScale = (voiceCount: number) =>
  voiceCount <= 1 ? 1 : voiceCount ** (CHORD_LOUDNESS_EXPONENT - 1);

const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const noteLabelFromMidi = (midi: number) => {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
};

const createPianoKeys = (): NoteKey[] => {
  let whiteIndex = 0;

  return Array.from({ length: NOTE_COUNT }, (_, index) => {
    const midi = NOTE_START_MIDI + index;
    const label = noteLabelFromMidi(midi);
    const isBlack = label.includes('#');
    const key: NoteKey = {
      id: label,
      label,
      midi,
      frequency: midiToFrequency(midi),
      isBlack,
      whiteIndex: isBlack ? Math.max(whiteIndex - 1, 0) : whiteIndex,
    };

    if (!isBlack) {
      whiteIndex += 1;
    }

    return key;
  });
};

const PIANO_KEYS = createPianoKeys();
const PIANO_KEY_BY_ID = new Map(PIANO_KEYS.map((key) => [key.id, key]));

const getNoteRangeLabel = (keys: NoteKey[]) => {
  if (keys.length === 0) {
    return 'Out of range';
  }

  return `${keys[0].label}-${keys[keys.length - 1].label}`;
};

const getKeyboardRangeNotes = (rootMidi: number) =>
  Object.values(COMPUTER_KEY_OFFSETS)
    .map((offset) => rootMidi + offset)
    .filter((midi) => midi >= NOTE_START_MIDI && midi <= NOTE_END_MIDI)
    .map((midi) => PIANO_KEY_BY_ID.get(noteLabelFromMidi(midi)))
    .filter((note): note is NoteKey => Boolean(note));

const getDisplayedPianoKeys = (rootMidi: number) => {
  const latestStart = NOTE_END_MIDI - DISPLAYED_NOTE_COUNT + 1;
  const startMidi = clamp(rootMidi - 12, NOTE_START_MIDI, latestStart);
  const endMidi = Math.min(startMidi + DISPLAYED_NOTE_COUNT - 1, NOTE_END_MIDI);

  return PIANO_KEYS.filter((key) => key.midi >= startMidi && key.midi <= endMidi);
};

const getEffectiveHarmonics = (harmonics: number[]) => {
  const normalized = normalizeHarmonics(harmonics);
  const total = normalized.reduce((sum, amplitude) => sum + Math.abs(amplitude), 0);
  const scale = total > 0 ? Math.min(0.9 / total, 1) : 0;

  return normalized.map((amplitude) => amplitude * scale);
};

const hasAudibleHarmonics = (harmonics: number[]) =>
  harmonics.some((amplitude) => amplitude > 0.0008);

const buildPeriodicWave = (context: AudioContext, effectiveHarmonics: number[]) => {
  const real = new Float32Array(HARMONIC_COUNT + 1);
  const imag = new Float32Array(HARMONIC_COUNT + 1);

  effectiveHarmonics.forEach((amplitude, index) => {
    const harmonic = index + 1;

    imag[harmonic] = amplitude;
  });

  if (!hasAudibleHarmonics(effectiveHarmonics)) {
    imag[1] = 0.0001;
  }

  return context.createPeriodicWave(real, imag, { disableNormalization: true });
};

const sampleCompositeWave = (effectiveHarmonics: number[], sampleCount = WAVE_SAMPLE_COUNT) => {
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const u = index / sampleCount;
    return effectiveHarmonics.reduce((sum, amplitude, harmonicIndex) => {
      const harmonic = harmonicIndex + 1;
      return sum + amplitude * Math.sin(Math.PI * 2 * harmonic * u);
    }, 0);
  });
  const max = samples.reduce((largest, sample) => Math.max(largest, Math.abs(sample)), 0);

  return max > 0 ? samples.map((sample) => sample / max) : samples;
};

const WAVE_GRAPH_WIDTH = 840;
const WAVE_GRAPH_HEIGHT = 280;
const WAVE_GRAPH_LEFT = 42;
const WAVE_GRAPH_RIGHT = 24;
const WAVE_GRAPH_TOP = 28;
const WAVE_GRAPH_BOTTOM = 38;
const WAVE_GRAPH_PLOT_WIDTH = WAVE_GRAPH_WIDTH - WAVE_GRAPH_LEFT - WAVE_GRAPH_RIGHT;
const WAVE_GRAPH_PLOT_HEIGHT = WAVE_GRAPH_HEIGHT - WAVE_GRAPH_TOP - WAVE_GRAPH_BOTTOM;
const WAVE_GRAPH_BASELINE = WAVE_GRAPH_TOP + WAVE_GRAPH_PLOT_HEIGHT / 2;
const WAVE_GRAPH_AMPLITUDE = WAVE_GRAPH_PLOT_HEIGHT * 0.42;

const wavePoint = (sample: number, index: number, sampleCount: number) => ({
  x: WAVE_GRAPH_LEFT + (index / Math.max(sampleCount - 1, 1)) * WAVE_GRAPH_PLOT_WIDTH,
  y: WAVE_GRAPH_BASELINE - sample * WAVE_GRAPH_AMPLITUDE,
});

const mixRgb = (from: [number, number, number], to: [number, number, number], amount: number) =>
  from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)) as [number, number, number];

const colorForAmplitude = (sample: number) => {
  const value = clamp(sample, -1, 1);
  const strength = Math.abs(value);
  const center: [number, number, number] = [15, 118, 110];
  const target: [number, number, number] = value >= 0 ? [239, 68, 68] : [59, 130, 246];
  const [red, green, blue] = mixRgb(center, target, 0.18 + strength * 0.82);

  return `rgb(${red}, ${green}, ${blue})`;
};

const buildWavePath = (samples: number[]) =>
  samples
    .map((sample, index) => {
      const { x, y } = wavePoint(sample, index, samples.length);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

const buildWaveSegments = (samples: number[]) =>
  samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    const start = wavePoint(previous, index, samples.length);
    const end = wavePoint(sample, index + 1, samples.length);
    const midpoint = (previous + sample) / 2;

    return {
      d: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
      color: colorForAmplitude(midpoint),
    };
  });

const sampleLiveWave = ({
  activeFrequencies,
  effectiveHarmonics,
  time,
}: {
  activeFrequencies: number[];
  effectiveHarmonics: number[];
  time: number;
}) => {
  if (activeFrequencies.length === 0) {
    return sampleCompositeWave(effectiveHarmonics);
  }

  const scroll = time * LIVE_WAVE_SCROLL_RATE;
  const samples = Array.from({ length: WAVE_SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / WAVE_SAMPLE_COUNT;

    return activeFrequencies.reduce((voiceSum, frequency) => {
      const cyclesPerWidth = frequency / LIVE_WAVE_REFERENCE_FREQUENCY;

      return voiceSum + effectiveHarmonics.reduce((harmonicSum, amplitude, harmonicIndex) => {
        const harmonic = harmonicIndex + 1;
        const spatialCycles = harmonic * cyclesPerWidth;

        return harmonicSum + amplitude * Math.sin(Math.PI * 2 * spatialCycles * (u - scroll));
      }, 0);
    }, 0);
  });
  const chordMixScale = getChordMixScale(activeFrequencies.length);

  return samples.map((sample) => sample * chordMixScale * LIVE_WAVE_DISPLAY_GAIN);
};

const frequencyFromSpectrogramX = (x: number, width: number, scale: SpectrogramScale) => {
  const t = clamp(x / Math.max(width - 1, 1), 0, 1);

  if (scale === 'linear') {
    return SPECTROGRAM_MIN_FREQUENCY + t * (SPECTROGRAM_MAX_FREQUENCY - SPECTROGRAM_MIN_FREQUENCY);
  }

  return SPECTROGRAM_MIN_FREQUENCY *
    (SPECTROGRAM_MAX_FREQUENCY / SPECTROGRAM_MIN_FREQUENCY) ** t;
};

const spectrogramXFromFrequency = (frequency: number, scale: SpectrogramScale) => {
  const t = scale === 'linear'
    ? (frequency - SPECTROGRAM_MIN_FREQUENCY) / (SPECTROGRAM_MAX_FREQUENCY - SPECTROGRAM_MIN_FREQUENCY)
    : Math.log(frequency / SPECTROGRAM_MIN_FREQUENCY) /
      Math.log(SPECTROGRAM_MAX_FREQUENCY / SPECTROGRAM_MIN_FREQUENCY);

  return `${clamp(t, 0, 1) * 100}%`;
};

function HarmonicBarGraph({
  harmonics,
  onChange,
}: {
  harmonics: number[];
  onChange: (index: number, value: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 760;
  const height = 280;
  const left = 24;
  const right = 24;
  const top = 28;
  const bottom = 226;
  const plotWidth = width - left - right;
  const barGap = 7;
  const barWidth = (plotWidth - barGap * (HARMONIC_COUNT - 1)) / HARMONIC_COUNT;

  const valueFromPointer = (event: ReactPointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return 0;
    }

    const rect = svg.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * height;
    return clamp((bottom - y) / (bottom - top), 0, 1);
  };

  const updateFromPointer = (index: number, event: ReactPointerEvent<SVGElement>) => {
    onChange(index, valueFromPointer(event));
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    activeIndexRef.current = null;
    setActiveIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const stepFromKey = (key: string) => {
    if (key === 'ArrowUp' || key === 'ArrowRight') {
      return 0.04;
    }

    if (key === 'ArrowDown' || key === 'ArrowLeft') {
      return -0.04;
    }

    if (key === 'PageUp') {
      return 0.12;
    }

    if (key === 'PageDown') {
      return -0.12;
    }

    return 0;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full select-none rounded-[1.25rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--sim-bg)_82%,white)] shadow-inner"
      role="img"
      aria-label="Interactive harmonic amplitude bar graph"
      onPointerMove={(event) => {
        if (activeIndexRef.current !== null) {
          updateFromPointer(activeIndexRef.current, event);
        }
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <defs>
        <linearGradient id="harmonic-bar-fill" x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.95)" />
          <stop offset="100%" stopColor="rgba(15,118,110,0.86)" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = bottom - tick * (bottom - top);
        return (
          <line
            key={tick}
            x1={left}
            x2={width - right}
            y1={y}
            y2={y}
            stroke={tick === 0 ? 'rgba(15,23,42,0.26)' : 'rgba(148,163,184,0.22)'}
            strokeWidth={tick === 0 ? 1.7 : 1.1}
            strokeDasharray={tick === 0 ? undefined : '6 8'}
          />
        );
      })}

      {normalizeHarmonics(harmonics).map((amplitude, index) => {
        const harmonic = index + 1;
        const x = left + index * (barWidth + barGap);
        const barHeight = amplitude * (bottom - top);
        const y = bottom - barHeight;
        const isActive = activeIndex === index;

        return (
          <g
            key={harmonic}
            role="slider"
            aria-label={`Harmonic ${harmonic} amplitude ${Math.round(amplitude * 100)} percent`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(amplitude * 100)}
            tabIndex={0}
            onPointerDown={(event) => {
              activeIndexRef.current = index;
              setActiveIndex(index);
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              updateFromPointer(index, event);
            }}
            onKeyDown={(event) => {
              const step = stepFromKey(event.key);

              if (step !== 0) {
                event.preventDefault();
                setActiveIndex(index);
                onChange(index, clamp(amplitude + step, 0, 1));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActiveIndex(index);
                onChange(index, 0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setActiveIndex(index);
                onChange(index, 1);
              }
            }}
            onBlur={() => {
              if (activeIndexRef.current === index) {
                activeIndexRef.current = null;
              }
              setActiveIndex((current) => (current === index ? null : current));
            }}
            onKeyUp={(event) => {
              if (stepFromKey(event.key) !== 0 || event.key === 'Home' || event.key === 'End') {
                setActiveIndex(null);
              }
            }}
            className="cursor-ns-resize focus:outline-none"
          >
            <rect
              x={x}
              y={top}
              width={barWidth}
              height={bottom - top}
              rx="8"
              fill="rgba(148,163,184,0.14)"
              stroke={isActive ? 'rgba(15,118,110,0.8)' : 'rgba(148,163,184,0.28)'}
              strokeWidth={isActive ? 2.2 : 1.2}
            />
            <rect
              x={x + 2}
              y={Math.min(y, bottom - 4)}
              width={barWidth - 4}
              height={Math.max(barHeight, 4)}
              rx="7"
              fill="url(#harmonic-bar-fill)"
            />
            <text
              x={x + barWidth / 2}
              y={bottom + 20}
              textAnchor="middle"
              fill="rgba(71,85,105,0.84)"
              fontSize="12"
              fontWeight="800"
            >
              {harmonic}
            </text>
            {isActive ? (
              <text
                x={x + barWidth / 2}
                y={Math.max(y - 8, top + 14)}
                textAnchor="middle"
                fill="rgba(15,23,42,0.72)"
                fontSize="11"
                fontWeight="700"
              >
                {Math.round(amplitude * 100)}
              </text>
            ) : null}
          </g>
        );
      })}

      <text x={left} y="262" fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
        harmonic number
      </text>
    </svg>
  );
}

function EnvelopeEditor({
  envelope,
  onChange,
}: {
  envelope: Envelope;
  onChange: (envelope: Envelope) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeHandleRef = useRef<EnvelopeHandle | null>(null);
  const width = 760;
  const height = 260;
  const top = 28;
  const bottom = 210;
  const left = 36;
  const attackStart = left;
  const attackEnd = 210;
  const decayStart = 230;
  const decayEnd = 370;
  const sustainX = 530;
  const releaseStart = 588;
  const releaseEnd = 724;
  const attackX = attackStart + (envelope.attack / 0.8) * (attackEnd - attackStart);
  const decayX = decayStart + (envelope.decay / 0.9) * (decayEnd - decayStart);
  const sustainY = bottom - envelope.sustain * (bottom - top);
  const releaseX = releaseStart + (envelope.release / 1.2) * (releaseEnd - releaseStart);
  const path = `M ${left} ${bottom} L ${attackX} ${top} L ${decayX} ${sustainY} L ${sustainX} ${sustainY} L ${releaseX} ${bottom}`;

  const getPoint = (event: ReactPointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }

    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * height,
    };
  };

  const updateHandle = (handle: EnvelopeHandle, event: ReactPointerEvent<SVGElement>) => {
    const point = getPoint(event);
    const next = { ...envelope };

    if (handle === 'attack') {
      next.attack = clamp(((point.x - attackStart) / (attackEnd - attackStart)) * 0.8, 0.005, 0.8);
    } else if (handle === 'decay') {
      next.decay = clamp(((point.x - decayStart) / (decayEnd - decayStart)) * 0.9, 0.01, 0.9);
      next.sustain = clamp((bottom - point.y) / (bottom - top), 0.05, 1);
    } else if (handle === 'sustain') {
      next.sustain = clamp((bottom - point.y) / (bottom - top), 0.05, 1);
    } else {
      next.release = clamp(((point.x - releaseStart) / (releaseEnd - releaseStart)) * 1.2, 0.025, 1.2);
    }

    onChange(next);
  };

  const startHandle = (handle: EnvelopeHandle, event: ReactPointerEvent<SVGElement>) => {
    activeHandleRef.current = handle;
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    updateHandle(handle, event);
  };

  const finishHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    activeHandleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handles: Array<{ key: EnvelopeHandle; x: number; y: number; label: string }> = [
    { key: 'attack', x: attackX, y: top, label: `attack ${formatNumber(envelope.attack, 2)} seconds` },
    { key: 'decay', x: decayX, y: sustainY, label: `decay ${formatNumber(envelope.decay, 2)} seconds and sustain ${Math.round(envelope.sustain * 100)} percent` },
    { key: 'sustain', x: sustainX, y: sustainY, label: `sustain ${Math.round(envelope.sustain * 100)} percent` },
    { key: 'release', x: releaseX, y: bottom, label: `release ${formatNumber(envelope.release, 2)} seconds` },
  ];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full select-none rounded-[1.25rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--sim-bg)_82%,white)] shadow-inner"
      role="img"
      aria-label="Interactive ADSR envelope graph"
      onPointerMove={(event) => {
        if (activeHandleRef.current) {
          updateHandle(activeHandleRef.current, event);
        }
      }}
      onPointerUp={finishHandle}
      onPointerCancel={finishHandle}
    >
      <rect x="0" y="0" width={width} height={height} rx="20" fill="transparent" />
      {[0, 0.5, 1].map((tick) => {
        const y = bottom - tick * (bottom - top);
        return (
          <g key={tick}>
            <line
              x1={left}
              x2={releaseEnd}
              y1={y}
              y2={y}
              stroke={tick === 0 ? 'rgba(15,23,42,0.26)' : 'rgba(148,163,184,0.22)'}
              strokeWidth={tick === 0 ? 1.7 : 1.1}
              strokeDasharray={tick === 0 ? undefined : '6 8'}
            />
            <text x="12" y={y + 4} fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
              {tick}
            </text>
          </g>
        );
      })}

      <path d={`${path} L ${releaseX} ${bottom} L ${left} ${bottom} Z`} fill="rgba(59,130,246,0.1)" />
      <path
        d={path}
        fill="none"
        stroke="rgba(15,118,110,0.94)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {handles.map((handle) => (
        <g
          key={handle.key}
          role="slider"
          aria-label={handle.label}
          tabIndex={0}
          onPointerDown={(event) => startHandle(handle.key, event)}
          className="cursor-grab focus:outline-none"
        >
          <circle
            cx={handle.x}
            cy={handle.y}
            r="13"
            fill={handle.key === 'release' ? 'rgba(239,68,68,0.92)' : 'rgba(59,130,246,0.95)'}
            stroke="rgba(255,255,255,0.96)"
            strokeWidth="3"
          />
          <text
            x={handle.x}
            y={handle.y - 20}
            textAnchor="middle"
            fill="rgba(15,23,42,0.74)"
            fontSize="12"
            fontWeight="800"
          >
            {handle.key[0].toUpperCase()}
          </text>
        </g>
      ))}

      <text x={left} y="246" fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
        A {formatNumber(envelope.attack, 2)}s
      </text>
      <text x={decayStart} y="246" fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
        D {formatNumber(envelope.decay, 2)}s
      </text>
      <text x={sustainX - 48} y="246" fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
        S {Math.round(envelope.sustain * 100)}%
      </text>
      <text x={releaseStart} y="246" fill="rgba(71,85,105,0.78)" fontSize="12" fontWeight="700">
        R {formatNumber(envelope.release, 2)}s
      </text>
    </svg>
  );
}

function ControlSlider({
  label,
  value,
  valueLabel,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-semibold text-[color:var(--text-primary)]">{label}</span>
        <span className="font-mono text-[color:var(--text-muted)]">{valueLabel}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.currentTarget.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
      />
    </label>
  );
}

function MetricCard({
  eyebrow,
  value,
  detail,
  color = 'var(--accent-blue)',
}: {
  eyebrow: string;
  value: string;
  detail: string;
  color?: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color }}>
        {eyebrow}
      </p>
      <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
        {value}
      </p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{detail}</p>
    </div>
  );
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

export default function AdditiveSynthLab() {
  const [harmonics, setHarmonics] = useState<number[]>(() => normalizeHarmonics(INITIAL_HARMONICS));
  const [envelope, setEnvelope] = useState<Envelope>(INITIAL_ENVELOPE);
  const [masterVolume, setMasterVolume] = useState(0.28);
  const [activePresetKey, setActivePresetKey] = useState('custom');
  const [customRecipe, setCustomRecipe] = useState<CustomRecipe>(() => ({
    harmonics: normalizeHarmonics(INITIAL_HARMONICS),
    envelope: INITIAL_ENVELOPE,
  }));
  const [activeNotes, setActiveNotes] = useState<Map<string, SynthVoice>>(() => new Map());
  const [keyboardRootOctave, setKeyboardRootOctave] = useState(INITIAL_KEYBOARD_ROOT_OCTAVE);
  const [spectrogramScale, setSpectrogramScale] = useState<SpectrogramScale>('log');
  const [waveTime, setWaveTime] = useState(0);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const activeNotesRef = useRef(activeNotes);
  const pointerNotesRef = useRef<Map<number, string>>(new Map());
  const keyboardNotesRef = useRef<Map<string, string>>(new Map());
  const pendingReleaseNotesRef = useRef<Set<string>>(new Set());
  const releaseNoteRef = useRef<(noteId: string) => void>(() => {});
  const animationRef = useRef<number | null>(null);
  const waveAnimationRef = useRef<number | null>(null);
  const waveLastTimestampRef = useRef<number | null>(null);
  const spectrogramInitializedRef = useRef(false);
  const lastSpectrogramScaleRef = useRef<SpectrogramScale | null>(null);
  const harmonicsRef = useRef(harmonics);
  const envelopeRef = useRef(envelope);
  const masterVolumeRef = useRef(masterVolume);

  const effectiveHarmonics = useMemo(
    () => getEffectiveHarmonics(harmonics),
    [harmonics],
  );
  const compositeSamples = useMemo(
    () => sampleCompositeWave(effectiveHarmonics),
    [effectiveHarmonics],
  );
  const heldVoices = Array.from(activeNotes.values()).filter((voice) => voice.status === 'held');
  const activeFrequencies = useMemo(
    () => Array.from(activeNotes.values()).map((voice) => voice.frequency),
    [activeNotes],
  );
  const soundingVoices = activeNotes.size;
  const isSounding = soundingVoices > 0;
  const chordMixScale = getChordMixScale(soundingVoices);
  const keyboardRootMidi = (keyboardRootOctave + 1) * 12;
  const spectrogramTicks = spectrogramScale === 'linear' ? SPECTROGRAM_LINEAR_TICKS : SPECTROGRAM_LOG_TICKS;
  const computerKeyboardNotes = useMemo(() => getKeyboardRangeNotes(keyboardRootMidi), [keyboardRootMidi]);
  const displayedPianoKeys = useMemo(() => getDisplayedPianoKeys(keyboardRootMidi), [keyboardRootMidi]);
  const displayedWhiteKeys = useMemo(() => displayedPianoKeys.filter((key) => !key.isBlack), [displayedPianoKeys]);
  const displayedBlackKeys = useMemo(() => displayedPianoKeys.filter((key) => key.isBlack), [displayedPianoKeys]);
  const firstDisplayedWhiteIndex = displayedWhiteKeys[0]?.whiteIndex ?? 0;
  const computerKeyboardRangeLabel = useMemo(() => getNoteRangeLabel(computerKeyboardNotes), [computerKeyboardNotes]);
  const displayedPianoRangeLabel = useMemo(() => getNoteRangeLabel(displayedPianoKeys), [displayedPianoKeys]);
  const liveWaveSamples = useMemo(
    () =>
      isSounding
        ? sampleLiveWave({
            activeFrequencies,
            effectiveHarmonics,
            time: waveTime,
          })
        : compositeSamples,
    [activeFrequencies, compositeSamples, effectiveHarmonics, isSounding, waveTime],
  );
  const waveformPath = useMemo(() => buildWavePath(liveWaveSamples), [liveWaveSamples]);
  const waveformSegments = useMemo(() => buildWaveSegments(liveWaveSamples), [liveWaveSamples]);
  const lowestVoice = Array.from(activeNotes.values()).reduce<SynthVoice | null>(
    (lowest, voice) => (!lowest || voice.frequency < lowest.frequency ? voice : lowest),
    null,
  );

  useEffect(() => {
    activeNotesRef.current = activeNotes;
  }, [activeNotes]);

  useEffect(() => {
    harmonicsRef.current = harmonics;
  }, [harmonics]);

  useEffect(() => {
    envelopeRef.current = envelope;
  }, [envelope]);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;
    const graph = graphRef.current;
    if (graph) {
      const now = graph.context.currentTime;
      graph.masterGain.gain.setTargetAtTime(masterVolume * chordMixScale, now, 0.02);
    }
  }, [chordMixScale, masterVolume]);

  useEffect(() => {
    if (!isSounding) {
      if (waveAnimationRef.current !== null) {
        window.cancelAnimationFrame(waveAnimationRef.current);
        waveAnimationRef.current = null;
      }
      waveLastTimestampRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      const previous = waveLastTimestampRef.current ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.04);
      waveLastTimestampRef.current = timestamp;
      setWaveTime((current) => current + dt);
      waveAnimationRef.current = window.requestAnimationFrame(tick);
    };

    waveAnimationRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (waveAnimationRef.current !== null) {
        window.cancelAnimationFrame(waveAnimationRef.current);
        waveAnimationRef.current = null;
      }
      waveLastTimestampRef.current = null;
    };
  }, [isSounding]);

  const updateActiveNotes = useCallback((updater: (current: Map<string, SynthVoice>) => Map<string, SynthVoice>) => {
    setActiveNotes((current) => {
      const next = updater(current);
      activeNotesRef.current = next;
      return next;
    });
  }, []);

  const getAudioGraph = useCallback(async () => {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!graphRef.current) {
      const audioWindow = window as Window &
        typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        };
      const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

      if (!AudioContextConstructor) {
        return null;
      }

      const context = new AudioContextConstructor();
      const masterGain = context.createGain();
      const analyser = context.createAnalyser();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      masterGain.gain.setValueAtTime(
        masterVolumeRef.current * getChordMixScale(activeNotesRef.current.size),
        context.currentTime,
      );
      masterGain.connect(analyser);
      analyser.connect(context.destination);

      graphRef.current = { context, masterGain, analyser };
    }

    if (graphRef.current.context.state === 'suspended') {
      await graphRef.current.context.resume().catch(() => undefined);
    }

    return graphRef.current;
  }, []);

  const createCurrentWave = useCallback((context: AudioContext) => {
    const currentEffectiveHarmonics = getEffectiveHarmonics(harmonicsRef.current);
    return buildPeriodicWave(context, currentEffectiveHarmonics);
  }, []);

  const disconnectVoice = useCallback((voice: SynthVoice) => {
    if (voice.releaseTimer !== null) {
      window.clearTimeout(voice.releaseTimer);
    }

    try {
      voice.oscillator.stop();
    } catch {
      // Oscillators can only be stopped once.
    }

    try {
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    } catch {
      // The node may already be disconnected by a scheduled release.
    }
  }, []);

  const startNote = useCallback(
    async (note: NoteKey) => {
      const existing = activeNotesRef.current.get(note.id);
      if (existing) {
        disconnectVoice(existing);
        updateActiveNotes((current) => {
          const next = new Map(current);
          next.delete(note.id);
          return next;
        });
      }

      const currentEffectiveHarmonics = getEffectiveHarmonics(harmonicsRef.current);
      if (!hasAudibleHarmonics(currentEffectiveHarmonics)) {
        return;
      }

      const graph = await getAudioGraph();
      if (!graph || graph.context.state === 'closed') {
        return;
      }

      const { context, masterGain } = graph;
      const now = context.currentTime;
      const voiceGain = context.createGain();
      const oscillator = context.createOscillator();
      const currentEnvelope = envelopeRef.current;
      const attackEnd = now + Math.max(currentEnvelope.attack, 0.002);
      const decayEnd = attackEnd + Math.max(currentEnvelope.decay, 0.001);
      const sustainLevel = clamp(currentEnvelope.sustain, 0.02, 1);
      const periodicWave = createCurrentWave(context);

      oscillator.frequency.setValueAtTime(note.frequency, now);
      oscillator.setPeriodicWave(periodicWave);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.exponentialRampToValueAtTime(0.82, attackEnd);
      voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
      oscillator.connect(voiceGain);
      voiceGain.connect(masterGain);
      oscillator.start(now);

      const voice: SynthVoice = {
        noteId: note.id,
        label: note.label,
        frequency: note.frequency,
        oscillator,
        gain: voiceGain,
        status: 'held',
        releaseTimer: null,
      };

      updateActiveNotes((current) => {
        const next = new Map(current);
        next.set(note.id, voice);
        return next;
      });

      if (pendingReleaseNotesRef.current.has(note.id)) {
        pendingReleaseNotesRef.current.delete(note.id);
        window.setTimeout(() => releaseNoteRef.current(note.id), 0);
      }
    },
    [createCurrentWave, disconnectVoice, getAudioGraph, updateActiveNotes],
  );

  const releaseNote = useCallback(
    (noteId: string) => {
      const graph = graphRef.current;
      const voice = activeNotesRef.current.get(noteId);

      if (!graph || !voice) {
        pendingReleaseNotesRef.current.add(noteId);
        return;
      }

      const now = graph.context.currentTime;
      const release = Math.max(envelopeRef.current.release, 0.025);

      if (voice.releaseTimer !== null) {
        window.clearTimeout(voice.releaseTimer);
      }

      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
        voice.oscillator.stop(now + release + 0.03);
      } catch {
        // The note may already be inside its shutdown path.
      }

      const releaseTimer = window.setTimeout(() => {
        try {
          voice.oscillator.disconnect();
          voice.gain.disconnect();
        } catch {
          // The browser may have already released the node graph.
        }

        updateActiveNotes((current) => {
          if (current.get(noteId)?.oscillator !== voice.oscillator) {
            return current;
          }

          const next = new Map(current);
          next.delete(noteId);
          return next;
        });
      }, (release + 0.08) * 1000);

      const releasedVoice: SynthVoice = {
        ...voice,
        status: 'release',
        releaseTimer,
      };

      updateActiveNotes((current) => {
        if (current.get(noteId) !== voice) {
          return current;
        }

        const next = new Map(current);
        next.set(noteId, releasedVoice);
        return next;
      });
    },
    [updateActiveNotes],
  );

  releaseNoteRef.current = releaseNote;

  const releaseAllNotes = useCallback(() => {
    Array.from(activeNotesRef.current.values())
      .filter((voice) => voice.status === 'held')
      .forEach((voice) => releaseNote(voice.noteId));
    pointerNotesRef.current.clear();
    keyboardNotesRef.current.clear();
    pendingReleaseNotesRef.current.clear();
  }, [releaseNote]);

  useEffect(() => {
    const finishGlobalPointer = (event: PointerEvent) => {
      const noteId = pointerNotesRef.current.get(event.pointerId);
      if (!noteId) {
        return;
      }

      pointerNotesRef.current.delete(event.pointerId);
      releaseNote(noteId);
    };

    window.addEventListener('pointerup', finishGlobalPointer);
    window.addEventListener('pointercancel', finishGlobalPointer);

    return () => {
      window.removeEventListener('pointerup', finishGlobalPointer);
      window.removeEventListener('pointercancel', finishGlobalPointer);
    };
  }, [releaseNote]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }

    const wave = createCurrentWave(graph.context);
    activeNotesRef.current.forEach((voice) => {
      try {
        voice.oscillator.setPeriodicWave(wave);
      } catch {
        // A voice may be shutting down while the timbre changes.
      }
    });
  }, [createCurrentWave, effectiveHarmonics]);

  useEffect(() => {
    const canvas = spectrogramCanvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const width = SPECTROGRAM_WIDTH;
    const height = SPECTROGRAM_HEIGHT;
    const scaleChanged = lastSpectrogramScaleRef.current !== spectrogramScale;
    const shouldInitialize = canvas.width !== width || canvas.height !== height || !spectrogramInitializedRef.current || scaleChanged;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const frequencyData = new Uint8Array(1024);

    const drawIdle = () => {
      const darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
      context.fillStyle = darkMode ? '#111827' : '#f8fafc';
      context.fillRect(0, 0, width, height);
      context.fillStyle = darkMode ? 'rgba(15, 118, 110, 0.12)' : 'rgba(59, 130, 246, 0.08)';
      context.fillRect(0, 0, width, height);
      spectrogramInitializedRef.current = true;
      lastSpectrogramScaleRef.current = spectrogramScale;
    };

    const drawSpectrogramRow = () => {
      const graph = graphRef.current;
      if (!graph) {
        return;
      }

      const darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
      graph.analyser.getByteFrequencyData(frequencyData);
      context.drawImage(canvas, 0, 0, width, height - SPECTROGRAM_ROW_HEIGHT, 0, SPECTROGRAM_ROW_HEIGHT, width, height - SPECTROGRAM_ROW_HEIGHT);

      for (let x = 0; x < width; x += 1) {
        const frequency = frequencyFromSpectrogramX(x, width, spectrogramScale);
        const bin = clamp(
          Math.round(frequency / (graph.context.sampleRate / graph.analyser.fftSize)),
          0,
          frequencyData.length - 1,
        );
        const intensity = frequencyData[bin] / 255;
        const alpha = clamp(intensity ** 1.4, 0, 0.96);
        const red = Math.round(24 + intensity * 228);
        const green = Math.round(92 + intensity * 134);
        const blue = Math.round(132 + intensity * 72);

        context.fillStyle = alpha > 0.02
          ? `rgba(${red}, ${green}, ${blue}, ${alpha})`
          : darkMode
            ? 'rgba(15, 23, 42, 0.08)'
            : 'rgba(248, 250, 252, 0.06)';
        context.fillRect(x, 0, 1, SPECTROGRAM_ROW_HEIGHT);
      }
    };

    const draw = () => {
      if (graphRef.current && isSounding) {
        drawSpectrogramRow();
        animationRef.current = window.requestAnimationFrame(draw);
      } else {
        animationRef.current = null;
      }
    };

    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
    }

    if (shouldInitialize) {
      drawIdle();
    }

    draw();

    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isSounding, spectrogramScale]);

  useEffect(() => {
    return () => {
      if (waveAnimationRef.current !== null) {
        window.cancelAnimationFrame(waveAnimationRef.current);
        waveAnimationRef.current = null;
      }
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      activeNotesRef.current.forEach((voice) => disconnectVoice(voice));
      activeNotesRef.current = new Map();

      const graph = graphRef.current;
      graphRef.current = null;
      if (graph && graph.context.state !== 'closed') {
        graph.context.close().catch(() => undefined);
      }
    };
  }, [disconnectVoice]);

  const saveCustomRecipe = (nextHarmonics: number[], nextEnvelope = envelopeRef.current) => {
    setActivePresetKey('custom');
    setCustomRecipe({
      harmonics: normalizeHarmonics(nextHarmonics),
      envelope: { ...nextEnvelope },
    });
  };

  const updateHarmonic = (index: number, value: number) => {
    const next = [...harmonicsRef.current];

    next[index] = clamp(value, 0, 1);
    harmonicsRef.current = next;
    setHarmonics(next);
    saveCustomRecipe(next);
  };

  const applyPreset = (preset: Preset) => {
    const nextHarmonics = normalizeHarmonics(preset.harmonics);

    setActivePresetKey(preset.key);
    harmonicsRef.current = nextHarmonics;
    setHarmonics(nextHarmonics);
    if (preset.envelope) {
      envelopeRef.current = preset.envelope;
      setEnvelope(preset.envelope);
    }
  };

  const applyCustomPreset = () => {
    const nextHarmonics = normalizeHarmonics(customRecipe.harmonics);
    const nextEnvelope = { ...customRecipe.envelope };

    setActivePresetKey('custom');
    harmonicsRef.current = nextHarmonics;
    envelopeRef.current = nextEnvelope;
    setHarmonics(nextHarmonics);
    setEnvelope(nextEnvelope);
  };

  const randomizeHarmonics = () => {
    const next = Array.from({ length: HARMONIC_COUNT }, (_, index) => {
      const falloff = 1 / (index + 1) ** 0.72;
      const shaped = Math.random() ** (index < 3 ? 0.85 : 1.7);
      return clamp(shaped * falloff * (index === 0 ? 1 : 1.25), 0, 1);
    });

    harmonicsRef.current = next;
    setHarmonics(next);
    saveCustomRecipe(next);
  };

  const resetSynth = () => {
    const nextHarmonics = normalizeHarmonics(INITIAL_HARMONICS);

    harmonicsRef.current = nextHarmonics;
    envelopeRef.current = INITIAL_ENVELOPE;
    setHarmonics(nextHarmonics);
    setEnvelope(INITIAL_ENVELOPE);
    saveCustomRecipe(nextHarmonics, INITIAL_ENVELOPE);
    setMasterVolume(0.28);
    setKeyboardRootOctave(INITIAL_KEYBOARD_ROOT_OCTAVE);
    releaseAllNotes();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, note: NoteKey) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    pointerNotesRef.current.set(event.pointerId, note.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    void startNote(note);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const noteId = pointerNotesRef.current.get(event.pointerId);
    if (!noteId) {
      return;
    }

    pointerNotesRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    releaseNote(noteId);
  };

  const shiftKeyboardOctave = (direction: -1 | 1) => {
    setKeyboardRootOctave((current) => clamp(
      current + direction,
      KEYBOARD_ROOT_MIN_OCTAVE,
      KEYBOARD_ROOT_MAX_OCTAVE,
    ));
  };

  const noteFromComputerKey = (key: string) => {
    const offset = COMPUTER_KEY_OFFSETS[key];

    if (typeof offset !== 'number') {
      return null;
    }

    const midi = keyboardRootMidi + offset;

    if (midi < NOTE_START_MIDI || midi > NOTE_END_MIDI) {
      return null;
    }

    return PIANO_KEY_BY_ID.get(noteLabelFromMidi(midi)) ?? null;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.repeat || isTextEditingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'z' || key === 'x') {
      event.preventDefault();
      shiftKeyboardOctave(key === 'z' ? -1 : 1);
      return;
    }

    const note = noteFromComputerKey(key);
    if (!note || keyboardNotesRef.current.has(key)) {
      return;
    }

    event.preventDefault();
    keyboardNotesRef.current.set(key, note.id);
    void startNote(note);
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    const noteId = keyboardNotesRef.current.get(key);
    if (!noteId) {
      return;
    }

    event.preventDefault();
    keyboardNotesRef.current.delete(key);
    releaseNote(noteId);
  };

  return (
    <div
      data-testid="additive-synth-lab"
      className="grid h-full min-h-[56rem] grid-cols-1 gap-6 bg-[var(--sim-bg)] p-4 text-[color:var(--text-primary)] xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:p-5"
      style={{ overflowAnchor: 'none' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[1.7rem] border border-[var(--grid-line)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_42%),var(--bg-primary)] shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--grid-line)] px-5 py-5">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: SYNTH_ACCENT }}>
                {isSounding ? 'Live waveform' : 'Harmonic sum'}
              </p>
              <p className="mt-2 mb-0 max-w-2xl text-sm leading-7 text-[color:var(--text-muted)]">
                {isSounding
                  ? 'The current signal uses a fixed display scale, so changing peak heights stay visible as it scrolls.'
                  : 'One cycle of the waveform produced by the current harmonic mixture.'}
              </p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[color:var(--text-muted)] shadow-sm">
              {isSounding ? 'Live' : 'Composite'}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <svg
              viewBox="0 0 840 280"
              className="h-auto w-full rounded-[1.35rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--sim-bg)_82%,white)] shadow-inner"
              role="img"
              aria-label={isSounding ? 'Live scrolling waveform' : 'Composite waveform for the current harmonic mixture'}
            >
                <rect x="0" y="0" width="840" height="280" rx="22" fill="transparent" />
                {[0, 0.25, 0.5, 0.75, 1].map((position) => {
                  const x = 42 + position * 774;
                  return (
                    <g key={position}>
                      <line x1={x} x2={x} y1="28" y2="242" stroke="rgba(148,163,184,0.2)" strokeWidth="1.2" />
                      <text x={x} y="262" textAnchor="middle" fill="rgba(71,85,105,0.82)" fontSize="12" fontWeight="700">
                        {isSounding
                          ? formatAxisMilliseconds(position * LIVE_WAVE_WINDOW_MS)
                          : position === 1
                            ? '1 cycle'
                            : formatNumber(position, 2)}
                      </text>
                    </g>
                  );
                })}
                {[54, 135, 216].map((y, index) => (
                  <line
                    key={y}
                    x1="42"
                    x2="816"
                    y1={y}
                    y2={y}
                    stroke={index === 1 ? 'rgba(15,23,42,0.28)' : 'rgba(148,163,184,0.22)'}
                    strokeWidth={index === 1 ? '1.7' : '1.2'}
                    strokeDasharray={index === 1 ? undefined : '7 8'}
                  />
                ))}
                <path
                  d={`${waveformPath} L 816 135 L 42 135 Z`}
                  fill="rgba(59,130,246,0.1)"
                />
                <path
                  d={waveformPath}
                  fill="none"
                  stroke="rgba(15,23,42,0.16)"
                  strokeWidth="5.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {waveformSegments.map((segment, index) => (
                  <path
                    key={index}
                    d={segment.d}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="4.4"
                    strokeLinecap="round"
                  />
                ))}
                <text x="58" y="34" fill="rgba(15,23,42,0.72)" fontSize="13" fontWeight="700">
                  {isSounding ? 'slow-mo signal' : 'normalized amplitude'}
                </text>
            </svg>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard
            eyebrow="Held notes"
            value={heldVoices.length ? heldVoices.map((voice) => voice.label).join(' ') : 'None'}
            detail={isSounding ? `${soundingVoices} voice${soundingVoices === 1 ? '' : 's'} sounding` : 'Tap or hold piano keys'}
            color={SYNTH_ACCENT}
          />
          <MetricCard
            eyebrow="Fundamental"
            value={lowestVoice ? `${formatNumber(lowestVoice.frequency, 1)} Hz` : 'A0-C8'}
            detail={lowestVoice ? lowestVoice.label : '88-key piano range'}
          />
        </div>

        <div className="overflow-hidden rounded-[1.7rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--grid-line)] px-5 py-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: SYNTH_ACCENT }}>
                Piano keyboard
              </p>
              <p className="mt-2 mb-0 text-sm text-[color:var(--text-muted)]">
                A W S E D F T G Y H U J K O L P ; maps to {computerKeyboardRangeLabel}. Z/X shift register.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => shiftKeyboardOctave(-1)}
                disabled={keyboardRootOctave <= KEYBOARD_ROOT_MIN_OCTAVE}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:border-[var(--grid-line)] disabled:hover:text-[color:var(--text-primary)]"
                aria-label="Shift keyboard down one octave"
                title="Lower register"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[color:var(--text-muted)] shadow-sm">
                Viewing {displayedPianoRangeLabel}
              </span>
              <button
                type="button"
                onClick={() => shiftKeyboardOctave(1)}
                disabled={keyboardRootOctave >= KEYBOARD_ROOT_MAX_OCTAVE}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:border-[var(--grid-line)] disabled:hover:text-[color:var(--text-primary)]"
                aria-label="Shift keyboard up one octave"
                title="Higher register"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={releaseAllNotes}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                Release
              </button>
            </div>
          </div>

          <div className="px-4 py-5">
            <div
              className="relative mx-auto"
              style={{
                width: '100%',
                maxWidth: `${DISPLAYED_PIANO_MAX_WIDTH}px`,
                height: `${WHITE_KEY_HEIGHT}px`,
              }}
            >
              <div className="absolute inset-0 flex">
                {displayedWhiteKeys.map((key) => {
                  const isHeld = activeNotes.get(key.id)?.status === 'held';
                  return (
                    <button
                      type="button"
                      key={key.id}
                      onPointerDown={(event) => handlePointerDown(event, key)}
                      onPointerUp={finishPointer}
                      onPointerCancel={finishPointer}
                      className={`relative flex shrink-0 items-end justify-center border border-slate-300 pb-3 text-xs font-bold shadow-sm transition-colors ${
                        isHeld
                          ? 'bg-[color-mix(in_srgb,var(--accent-blue)_22%,white)] text-[var(--accent-blue)]'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                      style={{
                        width: `${100 / Math.max(displayedWhiteKeys.length, 1)}%`,
                        height: `${WHITE_KEY_HEIGHT}px`,
                        borderRadius: '0 0 0.7rem 0.7rem',
                      }}
                      aria-label={`Play ${key.label}`}
                    >
                      {key.label}
                    </button>
                  );
                })}
              </div>

              {displayedBlackKeys.map((key) => {
                const isHeld = activeNotes.get(key.id)?.status === 'held';
                const whiteKeyCount = Math.max(displayedWhiteKeys.length, 1);
                const relativeWhiteIndex = key.whiteIndex - firstDisplayedWhiteIndex;
                return (
                  <button
                    type="button"
                    key={key.id}
                    onPointerDown={(event) => handlePointerDown(event, key)}
                    onPointerUp={finishPointer}
                    onPointerCancel={finishPointer}
                    className={`absolute top-0 z-10 flex items-end justify-center pb-3 text-[0.65rem] font-bold text-white shadow-md transition-colors ${
                      isHeld
                        ? 'bg-[var(--accent-red)]'
                        : 'bg-slate-900 hover:bg-slate-700'
                    }`}
                    style={{
                      left: `${((relativeWhiteIndex + 1) / whiteKeyCount) * 100}%`,
                      width: `clamp(18px, ${(0.62 / whiteKeyCount) * 100}%, ${BLACK_KEY_WIDTH}px)`,
                      height: `${BLACK_KEY_HEIGHT}px`,
                      borderRadius: '0 0 0.55rem 0.55rem',
                      transform: 'translateX(-50%)',
                    }}
                    aria-label={`Play ${key.label}`}
                  />
                );
              })}
            </div>

            <div
              className="mx-auto mt-5 overflow-hidden rounded-[1.1rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--sim-bg)_82%,white)] shadow-inner"
              style={{ width: '100%', maxWidth: `${SPECTROGRAM_WIDTH}px` }}
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] px-4 py-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Wideband spectrogram
                </p>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="inline-flex rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1 shadow-sm">
                    {(['log', 'linear'] as const).map((scale) => (
                      <button
                        type="button"
                        key={scale}
                        onClick={() => setSpectrogramScale(scale)}
                        aria-pressed={spectrogramScale === scale}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                          spectrogramScale === scale
                            ? 'bg-[var(--accent-blue)] text-white'
                            : 'text-[color:var(--text-muted)] hover:text-[var(--accent-blue)]'
                        }`}
                      >
                        {scale}
                      </button>
                    ))}
                  </div>
                  <p className="m-0 font-mono text-xs text-[color:var(--text-muted)]">
                    {SPECTROGRAM_MIN_FREQUENCY} Hz-{SPECTROGRAM_MAX_FREQUENCY / 1000} kHz
                  </p>
                </div>
              </div>
              <div
                className="relative"
                style={{
                  width: '100%',
                  height: `${SPECTROGRAM_HEIGHT}px`,
                }}
              >
                <canvas
                  ref={spectrogramCanvasRef}
                  className="block"
                  style={{
                    width: '100%',
                    height: `${SPECTROGRAM_HEIGHT}px`,
                  }}
                  aria-label="Live wideband spectrogram"
                />
                <svg
                  viewBox={`0 0 ${SPECTROGRAM_WIDTH} ${SPECTROGRAM_HEIGHT}`}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  aria-hidden="true"
                >
                  {spectrogramTicks.map((frequency) => {
                    const x = spectrogramXFromFrequency(frequency, spectrogramScale);
                    return (
                      <g key={frequency}>
                        <line
                          x1={x}
                          x2={x}
                          y1="0"
                          y2={SPECTROGRAM_HEIGHT}
                          stroke="rgba(148,163,184,0.22)"
                          strokeWidth="1"
                        />
                        <text
                          x={x}
                          y="16"
                          textAnchor="middle"
                          fill="rgba(71,85,105,0.82)"
                          fontSize="11"
                          fontWeight="800"
                        >
                          {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-[1.7rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Presets
              </p>
              <p className="mt-2 mb-0 text-sm leading-6 text-[color:var(--text-muted)]">
                Starting recipes for common harmonic shapes.
              </p>
            </div>
            <Music2 className="mt-0.5 h-5 w-5 text-[var(--accent-blue)]" aria-hidden="true" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button
              type="button"
              onClick={applyCustomPreset}
              className={`min-h-16 rounded-[1.05rem] border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                activePresetKey === 'custom'
                  ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))] shadow-sm'
                  : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] hover:border-[var(--accent-blue)]'
              }`}
            >
              <span className="block text-sm font-semibold text-[color:var(--text-primary)]">Custom</span>
              <span className="mt-1 block text-xs text-[color:var(--text-muted)]">Your saved harmonic shape</span>
            </button>
            {PRESETS.map((preset) => {
              const active = activePresetKey === preset.key;
              return (
                <button
                  type="button"
                  key={preset.key}
                  onClick={() => applyPreset(preset)}
                  className={`min-h-16 rounded-[1.05rem] border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                    active
                      ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))] shadow-sm'
                      : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{preset.label}</span>
                  <span className="mt-1 block text-xs text-[color:var(--text-muted)]">{preset.detail}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[1.7rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: SYNTH_ACCENT }}>
                Harmonic amplitudes
              </p>
              <p className="mt-2 mb-0 text-sm text-[color:var(--text-muted)]">
                Sixteen partials, each an integer multiple of the fundamental frequency.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={randomizeHarmonics}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                aria-label="Randomize harmonic amplitudes"
                title="Randomize"
              >
                <Shuffle className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={resetSynth}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
                aria-label="Reset synthesizer"
                title="Reset"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <HarmonicBarGraph
            harmonics={harmonics}
            onChange={updateHarmonic}
          />
        </div>

        <div className="rounded-[1.7rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" style={{ color: SYNTH_ACCENT }} aria-hidden="true" />
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: SYNTH_ACCENT }}>
              Shape
            </p>
          </div>

          <div className="space-y-5">
            <ControlSlider
              label="Volume"
              value={masterVolume}
              valueLabel={`${Math.round(masterVolume * 100)}%`}
              min={0.04}
              max={0.56}
              step={0.01}
              onChange={setMasterVolume}
            />

            <EnvelopeEditor
              envelope={envelope}
              onChange={(nextEnvelope) => {
                envelopeRef.current = nextEnvelope;
                setEnvelope(nextEnvelope);
                saveCustomRecipe(harmonicsRef.current, nextEnvelope);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
