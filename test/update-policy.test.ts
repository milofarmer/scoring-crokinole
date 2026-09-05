/**
 * The rule that decides whether an update may interrupt anyone.
 *
 * Worth testing on its own because the expensive failure is silent: a dialog
 * appearing over the big screen during a final, which nobody finds out about
 * until it happens in front of a hall.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideUpdateAction, describeUpdateError } from '../electron/update-policy.ts';

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

/* ---- what a failure looks like on screen ---- */

/**
 * The real message electron-updater produced when the repository had no
 * release. Kept verbatim, because the failure it caused was not the 404 but
 * everything after it: the whole response, headers and Set-Cookie included,
 * dumped into a dialog.
 */
const REAL_404 = `404
"method: GET url: https://github.com/milofarmer/scoring-crokinole/releases.atom

Please double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.
"
Headers: {
"cache-control": "no-cache",
"content-type": "text/plain; charset=utf-8",
"server": "github.com",
"set-cookie": [
"_gh_sess=B267S9tWBPhJ9L3g7McoW%2F1RMtNJNF%2Fua8w; path=/; HttpOnly; secure; SameSite=Lax",
"logged_in=no; expires=Sun, 05 Sep 2027 22:14:47 GMT; domain=.github.com; path=/; HttpOnly; secure"
]
}`;

test('a 404 is explained without guessing at one cause, and not dumped', () => {
  const shown = describeUpdateError(new Error(REAL_404));
  // A 404 covers "no release yet", "private repository" and "moved", and they
  // cannot be told apart from here. The first version of this claimed the first
  // one and was wrong as soon as a release existed behind a private repository.
  assert.match(shown, /could not be read/);
  assert.match(shown, /private/);
  assert.ok(!/^No release has been published yet/.test(shown), 'do not assert one cause of a 404');
  assert.ok(!shown.includes('set-cookie'), 'a dialog must never put cookies on screen');
  assert.ok(!shown.includes('_gh_sess'), 'a session cookie must never reach the screen');
  assert.ok(shown.length < 220, 'a couple of readable lines, not a page');
});

test('a network failure says so plainly', () => {
  for (const raw of ['getaddrinfo ENOTFOUND github.com', 'connect ETIMEDOUT 140.82.121.3:443']) {
    assert.equal(describeUpdateError(new Error(raw)), 'The update server could not be reached.');
  }
});

test('anything else is cut down to one short line', () => {
  const long = new Error(`something went wrong\n${'x'.repeat(500)}`);
  const shown = describeUpdateError(long);
  assert.equal(shown, 'something went wrong');

  const noNewline = new Error('y'.repeat(400));
  assert.ok(describeUpdateError(noNewline).length <= 160);
  assert.ok(describeUpdateError(noNewline).endsWith('...'));

  assert.equal(describeUpdateError(new Error('')), 'The update check did not complete.');
  assert.equal(describeUpdateError('a plain string'), 'a plain string');
});
