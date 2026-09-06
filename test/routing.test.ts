/**
 * How a request says which call it wants.
 *
 * This has one failure mode that hides itself. The pages post the action in the
 * JSON body; when the server read it from the query string only, every one of
 * them silently fell through to "state", which answers {ok: true, ...}. The
 * organiser screen therefore reported success while writing nothing at all, and
 * looked fine right up until someone checked the database.
 *
 * So these tests assert the effect of a call, not that it returned ok.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  process.env.CROK_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'crok-routing-')), 'crok.sqlite');
  const server = createApp().listen(0);
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    await run(`http://127.0.0.1:${(address satisfies AddressInfo).port}`);
  } finally {
    server.close();
  }
}

async function post(base: string, url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json();
  assert.ok(typeof parsed === 'object' && parsed !== null);
  return { ...parsed };
}

test('an action in the body reaches that call, which is how every page sends it', async () => {
  await withServer(async (base) => {
    const created = await post(base, '/api.php', {
      action: 'create_event', name: 'Body routed', admin_pin: '1234', num_rounds: 3,
    });
    assert.equal(created.ok, true);

    // The point: check it actually happened, not that the reply said ok.
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.ok(typeof state === 'object' && state !== null && 'event' in state);
    const event = Reflect.get(state, 'event');
    assert.ok(typeof event === 'object' && event !== null, 'the tournament must exist afterwards');
    assert.equal(Reflect.get(event, 'name'), 'Body routed');
  });
});

test('the query string still works and wins over the body', async () => {
  await withServer(async (base) => {
    await post(base, '/api.php?action=create_event', { name: 'From query', admin_pin: '1234' });
    const state = await (await fetch(`${base}/api/state`)).json();
    const event = Reflect.get(Object(state), 'event');
    assert.equal(Reflect.get(Object(event), 'name'), 'From query');

    // A body claiming a different action must not redirect a query-named call.
    const reply = await post(base, '/api.php?action=state', { action: 'reset_event', admin_pin: '1234' });
    assert.equal(reply.ok, true);
    assert.ok('event' in reply, 'answered as state, not as reset_event');
  });
});

test('a path names its own call and never consults the body', async () => {
  await withServer(async (base) => {
    await post(base, '/api/create_event', { name: 'Path routed', admin_pin: '1234' });

    // Ask for state by path while the body claims to be an organiser action.
    const reply = await post(base, '/api/state', { action: 'reset_event', admin_pin: '1234' });
    assert.ok('event' in reply, 'the path decided, not the body');

    const after = await (await fetch(`${base}/api/state`)).json();
    const event = Reflect.get(Object(after), 'event');
    assert.equal(Reflect.get(Object(event), 'name'), 'Path routed', 'nothing was reset');
  });
});

test('an unknown action says so rather than quietly answering as state', async () => {
  await withServer(async (base) => {
    const reply = await post(base, '/api.php', { action: 'no_such_action' });
    assert.equal(reply.ok, false);
    assert.ok(!('event' in reply), 'must not look like a successful state call');
  });
});
