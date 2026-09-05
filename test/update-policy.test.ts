/**
 * The rule that decides whether an update may interrupt anyone.
 *
 * Worth testing on its own because the expensive failure is silent: a dialog
 * appearing over the big screen during a final, which nobody finds out about
 * until it happens in front of a hall.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideUpdateAction } from '../electron/update-policy.ts';

test('nothing to say when this copy is current', () => {
  assert.deepEqual(
    decideUpdateAction({ version: null, tournamentLive: false, declined: null, askedFor: false }),
    { kind: 'nothing' },
  );
  assert.deepEqual(
    decideUpdateAction({ version: null, tournamentLive: false, declined: null, askedFor: true }),
    { kind: 'nothing' },
  );
});

test('a tournament in progress is never interrupted', () => {
  assert.deepEqual(
    decideUpdateAction({ version: '2.1.0', tournamentLive: true, declined: null, askedFor: false }),
    { kind: 'menu-only', version: '2.1.0' },
    'the menu may say so, nothing may take focus',
  );
});

test('with nothing being played, an update asks once', () => {
  assert.deepEqual(
    decideUpdateAction({ version: '2.1.0', tournamentLive: false, declined: null, askedFor: false }),
    { kind: 'offer', version: '2.1.0' },
  );
});

test('a version already turned down does not ask again', () => {
  assert.deepEqual(
    decideUpdateAction({ version: '2.1.0', tournamentLive: false, declined: '2.1.0', askedFor: false }),
    { kind: 'menu-only', version: '2.1.0' },
  );
  // But a newer one is a different question.
  assert.deepEqual(
    decideUpdateAction({ version: '2.2.0', tournamentLive: false, declined: '2.1.0', askedFor: false }),
    { kind: 'offer', version: '2.2.0' },
  );
});

test('asking from the menu always gets an answer', () => {
  for (const live of [true, false]) {
    assert.deepEqual(
      decideUpdateAction({ version: '2.1.0', tournamentLive: live, declined: '2.1.0', askedFor: true }),
      { kind: 'offer', version: '2.1.0' },
      `even mid-tournament (live: ${live}) and even after being declined`,
    );
  }
});

test('an unknown tournament state is treated as live', () => {
  // createUpdateWatcher turns any failed or unexpected answer from the server
  // into tournamentLive: true. This pins the consequence of that choice.
  assert.deepEqual(
    decideUpdateAction({ version: '2.1.0', tournamentLive: true, declined: null, askedFor: false }),
    { kind: 'menu-only', version: '2.1.0' },
    'silence is the safe answer when we cannot tell',
  );
});
