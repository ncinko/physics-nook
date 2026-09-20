/**
 * The Live Spectrogram's audio-source state machine, kept pure and DOM-free so
 * every transition can be pinned by a test.
 *
 * The important one is `shouldReleaseMicrophone`. The island's only job when
 * the source changes is to call it and obey it, which is what makes "the
 * microphone actually turns off" a tested contract rather than a hopeful
 * comment in an effect.
 */

export type SourceKind = 'idle' | 'microphone' | 'example' | 'clip';

export type MicPermission =
  | 'unknown'
  | 'prompting'
  | 'granted'
  | 'denied'
  | 'no-device'
  | 'insecure'
  | 'unsupported'
  | 'error';

export type MicFailure = Exclude<MicPermission, 'unknown' | 'prompting' | 'granted'>;

export interface SourceState {
  kind: SourceKind;
  /** The example or clip id currently playing, or null. */
  id: string | null;
  micPermission: MicPermission;
  /** Clips that 404'd or failed to decode; they stay disabled for the session. */
  failedClips: string[];
}

export type SourceEvent =
  | { type: 'request-mic' }
  | { type: 'mic-granted' }
  | { type: 'mic-failed'; reason: MicFailure }
  | { type: 'select-example'; id: string }
  | { type: 'select-clip'; id: string }
  | { type: 'clip-failed'; id: string }
  | { type: 'source-ended'; id: string }
  | { type: 'stop' };

export const initialSourceState: SourceState = {
  kind: 'idle',
  id: null,
  micPermission: 'unknown',
  failedClips: [],
};

export const sourceReducer = (state: SourceState, event: SourceEvent): SourceState => {
  switch (event.type) {
    case 'request-mic':
      return { ...state, kind: 'idle', id: null, micPermission: 'prompting' };

    case 'mic-granted':
      return { ...state, kind: 'microphone', id: null, micPermission: 'granted' };

    case 'mic-failed':
      // Never retried automatically: a denied permission prompt that reappears
      // on its own is how a site gets its microphone blocked permanently.
      return { ...state, kind: 'idle', id: null, micPermission: event.reason };

    case 'select-example':
      return { ...state, kind: 'example', id: event.id };

    case 'select-clip':
      return state.failedClips.includes(event.id)
        ? state
        : { ...state, kind: 'clip', id: event.id };

    case 'clip-failed':
      return {
        ...state,
        kind: state.kind === 'clip' && state.id === event.id ? 'idle' : state.kind,
        id: state.kind === 'clip' && state.id === event.id ? null : state.id,
        failedClips: state.failedClips.includes(event.id)
          ? state.failedClips
          : [...state.failedClips, event.id],
      };

    case 'source-ended':
      // A late callback from a source the reader already replaced must not
      // stop the current one.
      return state.id === event.id ? { ...state, kind: 'idle', id: null } : state;

    case 'stop':
      return { ...state, kind: 'idle', id: null };

    default:
      return state;
  }
};

/**
 * True whenever the machine leaves the microphone. The island must respond by
 * calling `stop()` on every MediaStreamTrack: disconnecting the source node
 * alone leaves the operating system's recording indicator lit.
 */
export const shouldReleaseMicrophone = (previous: SourceState, next: SourceState): boolean =>
  previous.kind === 'microphone' && next.kind !== 'microphone';

/**
 * Every failure names the fallback, so the lab is never a dead end for a
 * reader whose microphone is unavailable.
 */
export const sourceStatusMessage = (state: SourceState): string => {
  switch (state.micPermission) {
    case 'denied':
      return 'Your browser is blocking the microphone for this site. Open the padlock in the address bar, allow the microphone, then press Use microphone again. The example sounds work either way.';
    case 'no-device':
      return 'No microphone was found. You can still use the example sounds below.';
    case 'insecure':
      return 'The microphone needs a secure (https) connection. The example sounds work here.';
    case 'unsupported':
      return 'This browser does not support microphone input. The example sounds work here.';
    case 'error':
      return 'The microphone could not be opened. Another app may be using it. The example sounds work here.';
    case 'prompting':
      return 'Waiting for microphone permission.';
    default:
      return '';
  }
};

// ---------------------------------------------------------------------------
// Recorded clips
// ---------------------------------------------------------------------------

export interface RecordedClip {
  id: string;
  label: string;
  /** What the reader should look for in the picture. */
  blurb: string;
  /** Filename only; the base path is prepended by `clipUrl`. */
  file: string;
  durationSeconds: number;
  credit?: string;
}

export const CLIP_BASE_PATH = '/audio/spectrograms/';

export const clipUrl = (clip: RecordedClip): string => `${CLIP_BASE_PATH}${clip.file}`;

/**
 * Empty until licensed audio ships. The lab is complete without it: when this
 * list is empty the recorded-sound group does not render at all, and a clip
 * whose file is missing or undecodable disables only its own entry.
 */
export const RECORDED_CLIPS: RecordedClip[] = [];

export const availableClips = (state: SourceState): RecordedClip[] =>
  RECORDED_CLIPS.filter((clip) => !state.failedClips.includes(clip.id));
