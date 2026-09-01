/**
 * The guided tour through the video analysis lab, as data.
 *
 * The tour walks one worked example end to end — a Caltrain locomotive pulling
 * out of Menlo Park — because the hard part of video analysis is not any single
 * control, it is knowing which order to touch them in and why. Reading "set a
 * scale, then an origin, then mark" in prose is not the same as watching the
 * numbers appear.
 *
 * Steps are declarative on purpose. Each one says which control it points at,
 * what state the lab should be in when it opens, and how to tell that the
 * student has actually done the thing — and nothing about how any of that is
 * drawn. That keeps the whole script DOM-free and unit testable in
 * `tests/kinematics`, and it keeps the coach component down to measuring a
 * rectangle and placing a card.
 *
 * A step never advances on its own unless its `isComplete` was *false* when the
 * step opened. Without that rule a step whose condition happens to hold
 * already — the lab opens in Scale mode, so "you are in Scale mode" is true
 * from the start — would flash past before it could be read.
 */

import type { StageMode } from './videoAnalysis.ts';

/** Served straight out of `public/`; the clip is bundled with the site. */
export const TUTORIAL_VIDEO_SRC = '/videos/caltrain-tutorial.mp4';
export const TUTORIAL_VIDEO_NAME = 'caltrain-tutorial.mp4';

/**
 * The clip is a 10 s, 1280x720 cut at exactly 30 fps, so frame index and time
 * line up on round numbers and the tour can talk about "frame 210" and mean it.
 */
export const TUTORIAL_FPS = 30;
export const TUTORIAL_FRAME_COUNT = 300;

/**
 * The engineer's cab door, used as the known length.
 *
 * There is no ruler in the shot — which is the usual situation when you film
 * something you did not plan to film — so the tour falls back on an object
 * whose size a student can sanity check from experience: a door you can just
 * walk through, about 2 m. It is worth being honest that this is a good
 * estimate rather than a measurement, and the step copy says so.
 *
 * It survives a cross check. At frame 210 the door is about 207 px tall while
 * the carbody measures about 340 px from walkway to roof; a locomotive
 * carbody is roughly 3.5 m over that span, which puts the door at about 2.1 m.
 */
export const TUTORIAL_SCALE_METERS = 2;

/** The frame where the door is clear of both edges of the picture. */
export const TUTORIAL_SCALE_FRAME = 210;

/**
 * Twenty frames — two thirds of a second — between marks, ten marks in all, so
 * the data spans six of the clip's ten seconds.
 *
 * The spacing is set by how far the train actually goes. It starts from rest
 * and only reaches about 0.9 m/s by t = 6 s, so the nose lamp crosses roughly
 * 285 px over those six seconds. Marking every frame, or even every fifth
 * frame, would crowd the early points closer together than anyone can click,
 * and the "motion" between them would be hand tremor.
 */
export const TUTORIAL_STEP_FRAMES = 20;

/** Enough points for a parabola to be worth fitting, few enough to sit through. */
export const TUTORIAL_TARGET_POINTS = 10;

/**
 * Where a step can point. Each value is the `data-tour` attribute on the
 * control it names; `null` puts the card in the middle with nothing
 * highlighted.
 */
export type TutorialAnchor =
  | 'stage'
  | 'transport'
  | 'mode-row'
  | 'mode-mark'
  | 'mode-origin'
  | 'ruler-length'
  | 'frame-rate'
  | 'plot-axes'
  | 'fit-controls'
  | 'fit-panel'
  | 'export';

/** The slice of lab state a step is allowed to watch. */
export interface TutorialProgress {
  mode: StageMode;
  /** True once the ruler has been dragged off its auto-placed position. */
  scaleMoved: boolean;
  scaleLengthMeters: number;
  /** True once the origin has been moved off its auto-placed position. */
  originMoved: boolean;
  pointCount: number;
  plotY: readonly string[];
  fitModel: 'none' | 'linear' | 'quadratic';
  fitQuantity: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  /** One paragraph per entry. */
  body: string[];
  anchor: TutorialAnchor | null;
  /** Seek here when the step opens, so everyone sees the same picture. */
  seekToFrame?: number;
  /** Put the lab in this mode when the step opens. */
  setMode?: StageMode;
  /** Set the auto-advance distance when the step opens. */
  setStepFrames?: number;
  /** When this turns true the tour moves on by itself. */
  isComplete?: (progress: TutorialProgress) => boolean;
  /** A live line under the body, e.g. a running count of marked points. */
  status?: (progress: TutorialProgress) => string | null;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: '',
    body: [
      'This is a locomotive filmed from the platform.',
      'It starts nearly at rest and is still speeding up when the clip ends.  Assuming the acceleration is constant, we should be able to measure it.',
    ],
    anchor: null,
  },
  {
    id: 'transport',
    title: '',
    body: [
      'Play the clip through before measuring anything. You are looking for two things: a stretch of motion worth analyzing, and a common feature you can find in every frame.',
    ],
    anchor: 'transport',
  },
  {
    id: 'modes',
    title: '',
    body: [
      'These four buttons decide what happens when you click the video, and only one is active at a time.',
      'Scale is selected now, so the video is waiting for you to tell it how big things are. Everything else depends on getting this pixel to meter conversion right, which is why it comes first.',
    ],
    anchor: 'mode-row',
  },
  {
    id: 'scale-drag',
    title: '',
    body: [
      'We have jumped to frame 210, where the engineer’s door on the side of the cab is visible.',
      'Drag the two ends of the purple ruler onto the top and bottom of that door.',
    ],
    anchor: 'stage',
    setMode: 'calibrate', 
    seekToFrame: TUTORIAL_SCALE_FRAME,
    isComplete: (progress) => progress.scaleMoved,
  },
  {
    id: 'scale-length',
    title: '',
    body: [
      'Now say how long the purple ruler is. The cab door is about 2 meters high, so type 2 into the box and hit Enter. The analysis tool now knows how many pixels per meter are in this shot.',
      'If possible, place an actual meter stick in the same plane as the motion before recording a video.',
    ],
    anchor: 'ruler-length',
    isComplete: (progress) =>
      progress.scaleLengthMeters >= 1.5 && progress.scaleLengthMeters <= 2.5,
  },
  {
    id: 'frame-rate',
    title: '',
    body: [
      'The analysis tool measured this clip at 30 frames per second, so each frame is a thirtieth of a second later than the one before.',
      'If your camera says otherwise, type the real number here.  This allows us to accurately convert frame numbers to time values.',
    ],
    anchor: 'frame-rate',
  },
  {
    id: 'origin-mode',
    title: '',
    body: ['Click Origin. The video is then waiting for you to place the point where you want x = 0, y = 0.'],
    anchor: 'mode-origin',
    isComplete: (progress) => progress.mode === 'origin',
  },
  {
    id: 'origin-click',
    title: '',
    body: [
      'It really does not matter where you put the origin; moving the origin shifts every position by the same amount, but velocity and acceleration values are unaffected.',
    ],
    anchor: 'stage',
    setMode: 'origin',
    seekToFrame: 0,
    isComplete: (progress) => progress.originMoved,
  },
  {
    id: 'mark-mode',
    title: '',
    body: ['Click Mark. From here on, clicking the video records a point and steps the clip forward.'],
    anchor: 'mode-mark',
    isComplete: (progress) => progress.mode === 'mark',
  },
  {
    id: 'mark-points',
    title: '',
    body: [
      `Click a visible feature, like the train light closest to the camera. The clip jumps forward ${TUTORIAL_STEP_FRAMES} frames and waits for the next click. Do it at least ${TUTORIAL_TARGET_POINTS} times, which carries you six seconds into the clip.`,
      'Hit the same feature every time, and click as close to the same spot on that feature as you can. The analysis tool will do the rest.',
      'Misclick? Use ctrl+z or the undo point button.',
    ],
    anchor: 'stage',
    setMode: 'mark',
    seekToFrame: 0,
    setStepFrames: TUTORIAL_STEP_FRAMES,
    isComplete: (progress) => progress.pointCount >= TUTORIAL_TARGET_POINTS,
    status: (progress) =>
      `${progress.pointCount} of ${TUTORIAL_TARGET_POINTS} points marked`,
  },
  {
    id: 'graph',
    title: '',
    body: [
      'The graph has been filling in as you clicked. The train moves horizontally, so turn on x and turn off y',
      'The curve should bend: the horizontalgaps between points grow as the train picks up speed.',
    ],
    anchor: 'plot-axes',
    isComplete: (progress) => progress.plotY.includes('x'),
  },
  {
    id: 'fit',
    title: '',
    body: [
      'Set the fit to quadratic and the quantity to x. Constant acceleration means position is quadratic in time, so if that curve is a good fit, the acceleration really was near enough constant.',
    ],
    anchor: 'fit-controls',
    isComplete: (progress) => progress.fitModel === 'quadratic' && progress.fitQuantity === 'x',
  },
  {
    id: 'fit-read',
    title: '',
    body: [
      'For x = x₀ + v₀t + ½at², the coefficient on t² is half the acceleration.  Expect a negative value because the velocity is increasing in the negative direction.',
      'Switch the fit to linear against vx to see the same acceleration a second way, as the slope of the velocity graph.',
    ],
    anchor: 'fit-panel',
  },
  {
    id: 'export',
    title: '',
    body: [
      'Copy for spreadsheet puts the table on the clipboard tab-separated, which lands in Sheets or Excel as proper columns. Download CSV saves the same thing as a file.',
    ],
    anchor: 'export',
  },
  {
    id: 'finish',
    title: '',
    body: [
      'The important steps are: scale, frame rate, marks, fit.',
      'When you shoot your own clip, put a meter stick in frame in the same plane as the motion, hold the camera still, and film square-on to the motion. ',
    ],
    anchor: null,
  },
];

/** Where a given step sits, for the "Step 4 of 15" line. */
export const tutorialStepNumber = (index: number) => index + 1;

export const isLastTutorialStep = (index: number) => index >= TUTORIAL_STEPS.length - 1;

/**
 * Clamp an arbitrary index onto the script. The coach advances from timers and
 * from state changes, and both can fire around an exit.
 */
export const clampTutorialIndex = (index: number) =>
  Math.min(Math.max(index, 0), TUTORIAL_STEPS.length - 1);

export default TUTORIAL_STEPS;
