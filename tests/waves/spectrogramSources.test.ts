import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import {
  RECORDED_CLIPS,
  availableClips,
  clipUrl,
  initialSourceState,
  shouldReleaseMicrophone,
  sourceReducer,
  sourceStatusMessage,
  type MicFailure,
  type SourceState,
} from '../../src/lib/waves/spectrogramSources.ts';

const live: SourceState = { ...initialSourceState, kind: 'microphone', micPermission: 'granted' };

test('asking for the microphone clears the current source and never assumes an answer', () => {
  const asking = sourceReducer({ ...initialSourceState, kind: 'example', id: 'beats' }, { type: 'request-mic' });
  assert.equal(asking.kind, 'idle');
  assert.equal(asking.id, null);
  assert.equal(asking.micPermission, 'prompting');

  const granted = sourceReducer(asking, { type: 'mic-granted' });
  assert.equal(granted.kind, 'microphone');
  assert.equal(granted.micPermission, 'granted');
});

test('a microphone failure falls back to idle and records why', () => {
  const failures: MicFailure[] = ['denied', 'no-device', 'insecure', 'unsupported', 'error'];
  for (const reason of failures) {
    const state = sourceReducer({ ...initialSourceState, micPermission: 'prompting' }, {
      type: 'mic-failed',
      reason,
    });
    assert.equal(state.kind, 'idle');
    assert.equal(state.micPermission, reason);
    // Every failure has to name the fallback, or the lab is a dead end.
    const message = sourceStatusMessage(state);
    assert.ok(message.length > 0, `${reason} has no message`);
    assert.ok(
      /example sounds/i.test(message),
      `the "${reason}" message does not point at the example sounds`,
    );
  }
  assert.equal(sourceStatusMessage(initialSourceState), '');
});

test('leaving the microphone always releases it', () => {
  // The privacy contract. If a transition out of 'microphone' ever stops
  // returning true here, the operating system's recording indicator stays lit.
  const departures = [
    sourceReducer(live, { type: 'select-example', id: 'pure-tone' }),
    sourceReducer(live, { type: 'select-clip', id: 'whatever' }),
    sourceReducer(live, { type: 'stop' }),
    sourceReducer(live, { type: 'request-mic' }),
    sourceReducer(live, { type: 'mic-failed', reason: 'error' }),
  ];
  for (const next of departures) {
    assert.equal(shouldReleaseMicrophone(live, next), true, `${next.kind} did not release the mic`);
  }

  assert.equal(shouldReleaseMicrophone(live, sourceReducer(live, { type: 'mic-granted' })), false);
  assert.equal(shouldReleaseMicrophone(initialSourceState, live), false);
});

test('switching to an example keeps the permission already granted', () => {
  const next = sourceReducer(live, { type: 'select-example', id: 'beats' });
  assert.equal(next.kind, 'example');
  assert.equal(next.id, 'beats');
  assert.equal(next.micPermission, 'granted');
});

test('a late callback from a replaced source does not stop the current one', () => {
  const playing = sourceReducer(initialSourceState, { type: 'select-example', id: 'siren' });
  const stale = sourceReducer(playing, { type: 'source-ended', id: 'pure-tone' });
  assert.equal(stale.kind, 'example');
  assert.equal(stale.id, 'siren');

  const own = sourceReducer(playing, { type: 'source-ended', id: 'siren' });
  assert.equal(own.kind, 'idle');
  assert.equal(own.id, null);
});

test('a clip that fails to load is remembered and cannot be chosen again', () => {
  const playing = sourceReducer(initialSourceState, { type: 'select-clip', id: 'birdsong' });
  const failed = sourceReducer(playing, { type: 'clip-failed', id: 'birdsong' });

  assert.equal(failed.kind, 'idle');
  assert.equal(failed.id, null);
  assert.deepEqual(failed.failedClips, ['birdsong']);

  // Selecting it again is a no-op rather than a second failed load.
  assert.equal(sourceReducer(failed, { type: 'select-clip', id: 'birdsong' }), failed);
  // And a repeated failure does not duplicate the entry.
  assert.deepEqual(sourceReducer(failed, { type: 'clip-failed', id: 'birdsong' }).failedClips, ['birdsong']);
});

test('a clip failing while something else plays does not interrupt it', () => {
  const playing = sourceReducer(initialSourceState, { type: 'select-example', id: 'beats' });
  const next = sourceReducer(playing, { type: 'clip-failed', id: 'handclap' });
  assert.equal(next.kind, 'example');
  assert.equal(next.id, 'beats');
  assert.deepEqual(next.failedClips, ['handclap']);
});

test('stopping preserves what we learned about the microphone and the clips', () => {
  const messy: SourceState = {
    kind: 'example',
    id: 'siren',
    micPermission: 'denied',
    failedClips: ['birdsong'],
  };
  const stopped = sourceReducer(messy, { type: 'stop' });
  assert.equal(stopped.kind, 'idle');
  assert.equal(stopped.id, null);
  assert.equal(stopped.micPermission, 'denied');
  assert.deepEqual(stopped.failedClips, ['birdsong']);
});

test('the clip manifest is well formed and hides what failed', () => {
  const ids = new Set(RECORDED_CLIPS.map((clip) => clip.id));
  assert.equal(ids.size, RECORDED_CLIPS.length, 'duplicate clip id');
  for (const clip of RECORDED_CLIPS) {
    assert.ok(clip.file.length > 0 && !clip.file.includes('/'), 'file must be a bare filename');
    assert.ok(clipUrl(clip).startsWith('/audio/spectrograms/'));
    assert.ok(clip.durationSeconds > 0);
  }

  assert.deepEqual(availableClips(initialSourceState), RECORDED_CLIPS);
  const withFailure = { ...initialSourceState, failedClips: RECORDED_CLIPS.map((clip) => clip.id) };
  assert.deepEqual(availableClips(withFailure), []);
});

test('every listed clip has a file behind it', () => {
  // A renamed or dropped audio file would otherwise only show up as a silent
  // 404 that disables the entry in the browser, which nobody would notice.
  for (const clip of RECORDED_CLIPS) {
    const path = new URL(`../../public${clipUrl(clip)}`, import.meta.url);
    assert.ok(existsSync(path), `${clip.id}: no file at public${clipUrl(clip)}`);
    assert.ok(statSync(path).size > 1024, `${clip.id}: the file is suspiciously small`);
  }
});
