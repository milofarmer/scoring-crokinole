/**
 * The pages are the app as far as a player in the hall is concerned, and the
 * things most likely to break quietly are the ones checked here: the switcher
 * pointing at the wrong page, an asset URL that stops changing (so the big
 * screen keeps yesterday's stylesheet), and a value that escapes its quotes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PAGE_HEADERS,
  PAGE_NAMES,
  createPageRenderer,
  escapeHtml,
  pageNameFor,
  scriptLiteral,
} from '../src/services/pages.ts';

/** A throwaway public/ holding just enough for the renderer to work against. */
function makePublicDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crok-pages-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'style.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'assets', 'board.css'), 'body{}');
  return dir;
}

test('the nav marks the active page and only the active page', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  for (const active of PAGE_NAMES) {
    const nav = renderer.renderNav(active);
    const marked = nav.match(/aria-current="page"/g) ?? [];
    assert.equal(marked.length, 1, `${active} should mark exactly one link`);
    assert.match(nav, new RegExp(`<a href="${active}\\.php" aria-current="page">`));
  }
});

test('the nav lists every page, in order, whatever is active', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  const nav = renderer.renderNav('board');
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ['index.php', 'board.php', 'season.php', 'admin.php', 'api-docs.php']);
});

test('the nav can point at the .html pages instead', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir(), linkSuffix: '.html' });
  assert.match(renderer.renderNav('season'), /<a href="season\.html" aria-current="page">Season<\/a>/);
});

test('an asset URL carries the file version, and follows the file', () => {
  const dir = makePublicDir();
  const renderer = createPageRenderer({ publicDir: dir });

  const first = renderer.assetUrl('assets/style.css');
  assert.match(first, /^assets\/style\.css\?v=\d+$/);

  // A stylesheet edited on the laptop has to reach the screen in the hall.
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'assets', 'style.css'), later, later);
  assert.notEqual(renderer.assetUrl('assets/style.css'), first);
});

test('a missing asset still gets a version rather than a bare URL', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir(), now: () => 1_700_000_000_000 });
  assert.equal(renderer.assetUrl('assets/gone.css'), 'assets/gone.css?v=1700000000');
});

test('only the big screen pulls in board.css', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  assert.match(renderer.renderHead('Board', true), /assets\/board\.css\?v=\d+/);
  assert.doesNotMatch(renderer.renderHead('Phone', false), /board\.css/);
});

test('a title cannot break out of the head', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  const head = renderer.renderHead('Cup </title><script>alert(1)</script>', false);
  assert.doesNotMatch(head, /<script>/);
  assert.match(head, /<title>Cup &lt;\/title&gt;&lt;script&gt;/);
});

test('escapeHtml covers the characters that end an attribute or a tag', () => {
  assert.equal(escapeHtml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  assert.equal(escapeHtml('nothing to do'), 'nothing to do');
});

test('a value put into a script stays a value', () => {
  assert.equal(scriptLiteral('croki.local'), '"croki.local"');
  const hostile = scriptLiteral('</script><script>alert(1)</script>');
  assert.doesNotMatch(hostile, /<\/script>/);
  assert.doesNotMatch(hostile, /<script>/);
  // Still the same string once the JavaScript engine has read it.
  assert.equal(JSON.parse(hostile), '</script><script>alert(1)</script>');
  // A line separator is a newline to a JavaScript parser but not to JSON.
  assert.equal(scriptLiteral('a\u2028b'), '"a\\u2028b"');
});

test('the hostname placeholder comes from the environment, trimmed', () => {
  const renderer = createPageRenderer({
    publicDir: makePublicDir(),
    env: { CROK_HOSTNAME: '  croki.local  ' },
  });
  const filled = renderer.renderTemplate('board', 'const FRIENDLY_NAME = {{env:CROK_HOSTNAME}};');
  assert.equal(filled, 'const FRIENDLY_NAME = "croki.local";');
});

test('an unset hostname renders an empty string, not undefined', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir(), env: {} });
  assert.equal(renderer.renderTemplate('board', '{{env:CROK_HOSTNAME}}'), '""');
});

test('the mark takes its size from the placeholder', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  assert.match(renderer.renderTemplate('board', '{{mark:64}}'), /width="64" height="64"/);
  assert.match(renderer.renderTemplate('index', '{{mark}}'), /width="44" height="44"/);
});

test('a placeholder nobody implemented fails loudly instead of reaching a screen', () => {
  const renderer = createPageRenderer({ publicDir: makePublicDir() });
  assert.throws(() => renderer.renderTemplate('board', '<p>{{navv}}</p>'), /navv/);
});

test('a page is rendered with the no-store header the browser needs', () => {
  const dir = makePublicDir();
  fs.writeFileSync(path.join(dir, 'board.html'), '<head>{{head}}</head><body>{{nav}}</body>');
  const page = createPageRenderer({ publicDir: dir }).renderPage('board');

  assert.equal(page.headers['Cache-Control'], 'no-store, must-revalidate');
  assert.equal(page.headers, PAGE_HEADERS);
  assert.match(page.html, /<title>Crokinole — Big board<\/title>/);
  assert.match(page.html, /<a href="board\.php" aria-current="page">Board<\/a>/);
});

test('a request path maps to the page it is asking for', () => {
  assert.equal(pageNameFor('/'), 'index');
  assert.equal(pageNameFor('/board.html'), 'board');
  assert.equal(pageNameFor('/board.php'), 'board');
  assert.equal(pageNameFor('/api-docs.php'), 'api-docs');
  assert.equal(pageNameFor('/assets/style.css'), null);
  assert.equal(pageNameFor('/openapi.json'), null);
});

test('every page in the switcher has a template on disk', () => {
  const publicDir = path.join(import.meta.dirname, '..', 'public');
  const renderer = createPageRenderer({ publicDir, env: { CROK_HOSTNAME: 'croki.local' } });
  for (const name of PAGE_NAMES) {
    const { html } = renderer.renderPage(name);
    assert.doesNotMatch(html, /\{\{|<\?/, `${name} should have no placeholders or PHP left`);
    assert.match(html, /^<!doctype html>/);
  }
});
