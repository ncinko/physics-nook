import { useCallback, useEffect, useRef, useState } from 'react';
import {
  estimateFrameRate,
  frameIndexForTime,
  type FrameRateEstimate,
} from '../../../lib/kinematics/videoAnalysis';

/**
 * Everything about driving an HTML video element frame by frame lives here, so
 * the rest of the lab can consume a plain value object and never think about
 * seek races, codec support, or object-URL lifetimes.
 *
 * The central problem: the browser exposes no frame rate at all, and
 * `currentTime` is a request rather than a report. `requestVideoFrameCallback`
 * fixes both — it fires once per *presented* frame and hands back that frame's
 * real presentation timestamp — so we use it to measure the frame rate on load
 * and to record the true time of every frame the student marks. Browsers
 * without it still work; they just fall back to `currentTime`, which is within
 * half a frame of the truth and off by a *constant*, so velocities and
 * accelerations are unaffected.
 */

/** Not in every `lib.dom` yet, and a global augmentation would leak site-wide. */
interface VideoFrameMetadata {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?(
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ): number;
  cancelVideoFrameCallback?(handle: number): void;
};

export type VideoStatus = 'empty' | 'loading' | 'probing' | 'ready' | 'error';

export interface SettledFrame {
  /** Presentation time of the frame now on screen, in seconds. */
  time: number;
  /** True when the time came from the frame callback rather than a seek target. */
  exact: boolean;
}

export interface VideoFramesApi {
  attachVideo: (element: HTMLVideoElement | null) => void;
  objectUrl: string | null;
  status: VideoStatus;
  errorMessage: string | null;
  fileName: string | null;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  setFps: (fps: number) => void;
  frameRateEstimate: FrameRateEstimate | null;
  supportsFrameCallback: boolean;
  current: SettledFrame | null;
  currentFrame: number;
  frameCount: number;
  atEnd: boolean;
  seeking: boolean;
  loadFile: (file: File) => void;
  reset: () => void;
  stepFrames: (delta: number) => Promise<SettledFrame | null>;
  seekToFrame: (index: number) => Promise<SettledFrame | null>;
  detectFrameRate: () => Promise<void>;
}

const DEFAULT_FPS = 30;
/** Hard backstop so a wedged decoder can never freeze the controls. */
const SETTLE_TIMEOUT_MS = 1500;
/** After `seeked`, how long to wait for the frame callback before giving up. */
const FRAME_GRACE_MS = 220;
const METADATA_TIMEOUT_MS = 10000;

const CODEC_MESSAGE =
  "This browser can't decode this video — most often an HEVC / H.265 clip from an iPhone. " +
  'On the phone: Settings, Camera, Formats, Most Compatible. Safari can usually open the file as-is.';

export const useVideoFrames = (): VideoFramesApi => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Pending asynchronous work for the current seek, all of which must be
  // cancellable: a leaked frame callback that calls setState after unmount is
  // the classic bug in a component like this.
  const frameHandleRef = useRef<number | null>(null);
  const seekedHandlerRef = useRef<(() => void) | null>(null);
  const graceTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const metadataTimerRef = useRef<number | null>(null);

  const busyRef = useRef(false);
  const settledRef = useRef<SettledFrame | null>(null);
  const lastPresentedRef = useRef(-1);
  const fpsRef = useRef(DEFAULT_FPS);
  const durationRef = useRef(0);
  const awaitingDurationRef = useRef(false);

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoStatus>('empty');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fps, setFpsState] = useState(DEFAULT_FPS);
  const [frameRateEstimate, setFrameRateEstimate] = useState<FrameRateEstimate | null>(null);
  const [supportsFrameCallback, setSupportsFrameCallback] = useState(true);
  const [current, setCurrent] = useState<SettledFrame | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const setFps = useCallback((next: number) => {
    if (!Number.isFinite(next) || next <= 0) return;
    fpsRef.current = next;
    setFpsState(next);
  }, []);

  const cancelPending = useCallback(() => {
    const video = videoRef.current as RvfcVideo | null;
    if (video && frameHandleRef.current !== null) {
      video.cancelVideoFrameCallback?.(frameHandleRef.current);
    }
    frameHandleRef.current = null;
    if (video && seekedHandlerRef.current) {
      video.removeEventListener('seeked', seekedHandlerRef.current);
    }
    seekedHandlerRef.current = null;
    if (graceTimerRef.current !== null) window.clearTimeout(graceTimerRef.current);
    graceTimerRef.current = null;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  /**
   * Seek to `target` and resolve once a frame is genuinely on screen.
   *
   * Two guards make the result trustworthy. `presentedFrames` must have
   * advanced — that is precisely what the counter is for, and it rejects a
   * callback left over from before the seek. And the reported `mediaTime` must
   * land within three quarters of a frame of where we aimed, which rejects an
   * intermediate frame delivered while the decoder is still catching up.
   */
  const settle = useCallback(
    (target: number): Promise<SettledFrame | null> => {
      const video = videoRef.current;
      if (!video) return Promise.resolve(null);
      const clamped = Math.min(Math.max(target, 0), Math.max(0, durationRef.current - 1e-3));
      cancelPending();

      return new Promise<SettledFrame | null>((resolve) => {
        let done = false;
        const finish = (time: number, exact: boolean) => {
          if (done) return;
          done = true;
          cancelPending();
          resolve({ time, exact });
        };

        const rvfc = video as RvfcVideo;
        const canUseFrameCallback = typeof rvfc.requestVideoFrameCallback === 'function';
        let attempts = 0;

        const requestFrame = () => {
          if (!canUseFrameCallback) return;
          frameHandleRef.current = rvfc.requestVideoFrameCallback!((_now, metadata) => {
            frameHandleRef.current = null;
            const advanced = metadata.presentedFrames > lastPresentedRef.current;
            const onTarget =
              Math.abs(metadata.mediaTime - clamped) < 0.75 / Math.max(1, fpsRef.current);
            lastPresentedRef.current = Math.max(lastPresentedRef.current, metadata.presentedFrames);
            if (advanced && onTarget) {
              finish(metadata.mediaTime, true);
              return;
            }
            attempts += 1;
            if (attempts <= 4) requestFrame();
          });
        };
        requestFrame();

        // `seeked` fires as soon as the decoder is positioned, which is usually
        // *before* the frame is presented. Give the frame callback a short grace
        // period rather than immediately settling for the less precise value.
        const onSeeked = () => {
          if (!canUseFrameCallback) {
            finish(video.currentTime, false);
            return;
          }
          if (graceTimerRef.current === null) {
            graceTimerRef.current = window.setTimeout(
              () => finish(video.currentTime, false),
              FRAME_GRACE_MS,
            );
          }
        };
        seekedHandlerRef.current = onSeeked;
        video.addEventListener('seeked', onSeeked);
        settleTimerRef.current = window.setTimeout(
          () => finish(video.currentTime, false),
          SETTLE_TIMEOUT_MS,
        );

        video.currentTime = clamped;
      });
    },
    [cancelPending],
  );

  const frameCount = Math.max(1, Math.floor(duration * fps));

  const seekToFrame = useCallback(
    async (index: number): Promise<SettledFrame | null> => {
      const video = videoRef.current;
      if (!video || busyRef.current || durationRef.current <= 0) return null;
      const workingFps = fpsRef.current;
      const lastIndex = Math.max(0, Math.floor(durationRef.current * workingFps) - 1);
      const clampedIndex = Math.min(Math.max(0, Math.round(index)), lastIndex);

      busyRef.current = true;
      setSeeking(true);
      // Aim at the *middle* of the target frame. A boundary target
      // (index / fps) lands on the previous or the next frame depending on how
      // the decoder rounds, which is the usual cause of "sometimes it steps two".
      const settled = await settle((clampedIndex + 0.5) / workingFps);
      busyRef.current = false;

      // Normalise to a frame *start* time. The mid-frame target is a seek
      // strategy, not a measurement: storing it would leave every recorded time
      // half a frame high, and `Math.round(time * fps)` would then land on the
      // next frame index — which made stepping advance two frames at a time.
      // The exact path already reports a true presentation timestamp; the
      // fallback path knows which frame it asked for, and the frame it got
      // starts at index / fps.
      const normalised: SettledFrame | null = settled
        ? settled.exact
          ? settled
          : { time: clampedIndex / workingFps, exact: false }
        : null;
      if (normalised) settledRef.current = normalised;

      if (!mountedRef.current) return normalised;
      setSeeking(false);
      if (normalised) {
        setCurrent(normalised);
        setAtEnd(clampedIndex >= lastIndex);
      }
      return normalised;
    },
    [settle],
  );

  const stepFrames = useCallback(
    (delta: number): Promise<SettledFrame | null> => {
      // Recompute the current index from the last *measured* time rather than
      // keeping a counter, so a slightly wrong frame rate can never accumulate
      // into a drift of whole frames over a long clip.
      const base = settledRef.current
        ? frameIndexForTime(settledRef.current.time, fpsRef.current)
        : 0;
      return seekToFrame(base + delta);
    },
    [seekToFrame],
  );

  /**
   * Measure the frame rate by playing briefly and watching which frames the
   * browser presents. Probing by seeking would be circular — you cannot step
   * one frame until you already know how long a frame is.
   *
   * Only consecutive presentations count: `presentedFrames === last + 1` throws
   * away any gap where a frame was dropped, so every retained interval is
   * exactly one frame period.
   */
  const detectFrameRate = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const rvfc = video as RvfcVideo;
    if (typeof rvfc.requestVideoFrameCallback !== 'function') {
      setSupportsFrameCallback(false);
      setStatus('ready');
      await seekToFrame(0);
      return;
    }

    setStatus('probing');
    cancelPending();
    video.currentTime = 0;
    video.muted = true;

    const times: number[] = [];
    let lastPresented: number | null = null;
    const startedAt = Date.now();

    await new Promise<void>((resolve) => {
      let finished = false;
      const stop = () => {
        if (finished) return;
        finished = true;
        if (frameHandleRef.current !== null) {
          rvfc.cancelVideoFrameCallback?.(frameHandleRef.current);
          frameHandleRef.current = null;
        }
        if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
        resolve();
      };

      const onFrame = (_now: number, metadata: VideoFrameMetadata) => {
        if (lastPresented === null || metadata.presentedFrames === lastPresented + 1) {
          times.push(metadata.mediaTime);
        }
        lastPresented = metadata.presentedFrames;
        if (times.length < 24 && Date.now() - startedAt < 1200) {
          frameHandleRef.current = rvfc.requestVideoFrameCallback!(onFrame);
        } else {
          stop();
        }
      };
      frameHandleRef.current = rvfc.requestVideoFrameCallback!(onFrame);
      settleTimerRef.current = window.setTimeout(stop, 2500);
      // A rejected play() means an autoplay policy blocked us; the caller can
      // retry from inside a user gesture with the "Detect frame rate" button.
      video.play().catch(() => stop());
    });

    video.pause();
    if (!mountedRef.current) return;

    const estimate = estimateFrameRate(times);
    if (estimate) {
      setFrameRateEstimate(estimate);
      setFps(estimate.fps);
    }
    lastPresentedRef.current = -1;
    setStatus('ready');
    await seekToFrame(0);
  }, [cancelPending, seekToFrame, setFps]);

  const handleMediaError = useCallback(() => {
    const video = videoRef.current;
    if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
    metadataTimerRef.current = null;
    setStatus('error');
    setErrorMessage(
      video?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? CODEC_MESSAGE
        : 'The video could not be loaded. Try a different file.',
    );
  }, []);

  const handleMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      // Some containers report an infinite duration until you seek past the end.
      awaitingDurationRef.current = true;
      video.currentTime = 1e9;
      return;
    }
    if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
    metadataTimerRef.current = null;
    awaitingDurationRef.current = false;
    durationRef.current = video.duration;
    setDuration(video.duration);
    setSize({ width: video.videoWidth, height: video.videoHeight });
    setSupportsFrameCallback(
      typeof (video as RvfcVideo).requestVideoFrameCallback === 'function',
    );
    void detectFrameRate();
  }, [detectFrameRate]);

  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      const previous = videoRef.current;
      if (previous === element) return;

      if (previous) {
        cancelPending();
        previous.removeEventListener('loadedmetadata', handleMetadata);
        previous.removeEventListener('durationchange', handleMetadata);
        previous.removeEventListener('error', handleMediaError);
        previous.pause();
        // Dropping the source releases the decoder rather than leaving it
        // holding a few hundred megabytes of clip.
        previous.removeAttribute('src');
        previous.load();
      }

      videoRef.current = element;
      if (element) {
        element.addEventListener('loadedmetadata', handleMetadata);
        element.addEventListener('durationchange', handleMetadata);
        element.addEventListener('error', handleMediaError);
      }
    },
    [cancelPending, handleMediaError, handleMetadata],
  );

  const loadFile = useCallback(
    (file: File) => {
      cancelPending();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      // createObjectURL streams the file from disk. Reading it into memory with
      // FileReader would turn a 300 MB clip into a 400 MB string and kill the tab.
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      settledRef.current = null;
      lastPresentedRef.current = -1;
      durationRef.current = 0;
      awaitingDurationRef.current = false;

      setObjectUrl(url);
      setFileName(file.name);
      setErrorMessage(null);
      setFrameRateEstimate(null);
      setCurrent(null);
      setAtEnd(false);
      setDuration(0);
      setSize({ width: 0, height: 0 });
      setStatus('loading');

      if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
      metadataTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus((previous) => (previous === 'loading' ? 'error' : previous));
        setErrorMessage((previous) => previous ?? CODEC_MESSAGE);
      }, METADATA_TIMEOUT_MS);
    },
    [cancelPending],
  );

  const reset = useCallback(() => {
    cancelPending();
    if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
    metadataTimerRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    settledRef.current = null;
    lastPresentedRef.current = -1;
    durationRef.current = 0;
    setObjectUrl(null);
    setFileName(null);
    setStatus('empty');
    setErrorMessage(null);
    setCurrent(null);
    setAtEnd(false);
    setDuration(0);
    setSize({ width: 0, height: 0 });
    setFrameRateEstimate(null);
  }, [cancelPending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPending();
      if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [cancelPending]);

  return {
    attachVideo,
    objectUrl,
    status,
    errorMessage,
    fileName,
    duration,
    videoWidth: size.width,
    videoHeight: size.height,
    fps,
    setFps,
    frameRateEstimate,
    supportsFrameCallback,
    current,
    currentFrame: current ? frameIndexForTime(current.time, fps) : 0,
    frameCount,
    atEnd,
    seeking,
    loadFile,
    reset,
    stepFrames,
    seekToFrame,
    detectFrameRate,
  };
};
