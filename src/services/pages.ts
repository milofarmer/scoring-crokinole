/**
 * The chrome every page shares: the <head>, the page switcher, the board mark
 * and cache-busted asset URLs. This is the Node port of src/brand.php, kept so
 * the same markup can be served without PHP.
 *
 * The pages in public/ are plain HTML with `{{name}}` / `{{name:argument}}`
 * placeholders. They are filled in per request rather than baked into the files
 * because two of the values are only knowable at request time: an asset's
 * modification time, and CROK_HOSTNAME. Keeping the shared markup here also
 * means the nav lives in one place instead of being copied into five files.
 */
import fs from 'node:fs';
import path from 'node:path';

export type PageName = 'index' | 'board' | 'season' | 'admin' | 'api-docs';

interface PageSpec {
  readonly title: string;
  /** The big screen in the hall pulls in board.css on top of the shared styles. */
  readonly bigscreen: boolean;
}

const PAGE_SPECS: Readonly<Record<PageName, PageSpec>> = {
  index: { title: 'Crokinole — Score entry', bigscreen: false },
  board: { title: 'Crokinole — Big board', bigscreen: true },
  season: { title: 'Crokinole — Season ranking', bigscreen: false },
  admin: { title: 'Crokinole — Organizer', bigscreen: false },
  'api-docs': { title: 'Crokinole — API', bigscreen: false },
};

interface NavItem {
  readonly page: PageName;
  readonly label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { page: 'index', label: 'Score' },
  { page: 'board', label: 'Board' },
  { page: 'season', label: 'Season' },
  { page: 'admin', label: 'Organizer' },
  { page: 'api-docs', label: 'API' },
];

export const PAGE_NAMES: readonly PageName[] = NAV_ITEMS.map((item) => item.page);

/**
 * The stylesheets carry a version in their URL and can be cached hard, but the
 * page pointing at them must not be: a browser holding yesterday's HTML keeps
 * asking for yesterday's stylesheet, so the screen in the hall quietly stays out
 * of date after an update. Whoever serves these pages has to send this.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, must-revalidate',
};

export interface RenderedPage {
  readonly html: string;
  /** Send these as-is; see PAGE_HEADERS for why no-store matters. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface PageRendererOptions {
  /** Directory holding the .html pages and assets/. */
  readonly publicDir: string;
  /**
   * Extension the page switcher links to. The inline scripts in these pages
   * still call api.php and build /index.php links, so the default matches them;
   * pass '.html' once the server serves the pages under their own names.
   */
  readonly linkSuffix?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable so a test does not need real files on disk. */
  readonly now?: () => number;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPES[character] ?? character);
}

/*
 * A JSON string is not automatically safe inside <script>: the parser ends the
 * block at the first "</script>" whatever the quoting says. Escaping the angle
 * brackets keeps the value a value.
 */
const SCRIPT_ESCAPES: Readonly<Record<string, string>> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  ['\u2028']: '\\u2028',
  ['\u2029']: '\\u2029',
};

export function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => SCRIPT_ESCAPES[character] ?? character,
  );
}

const MARK_SIZE_FALLBACK = 44;

/** Inline crokinole-board mark (concentric rings, red/blue quadrant arcs, centre 20-hole). */
export function renderMark(size: number = MARK_SIZE_FALLBACK): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="48" fill="#fffdf8" stroke="#1a1410" stroke-width="2.5"/>
  <circle cx="50" cy="50" r="35" fill="none" stroke="#c6a96a" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="22" fill="none" stroke="#c6a96a" stroke-width="1.5"/>
  <path d="M50 15 A35 35 0 0 1 85 50" fill="none" stroke="#b23a3a" stroke-width="3"/>
  <path d="M15 50 A35 35 0 0 1 50 15" fill="none" stroke="#2e4a7a" stroke-width="3"/>
  <path d="M85 50 A35 35 0 0 1 50 85" fill="none" stroke="#2e4a7a" stroke-width="3"/>
  <path d="M50 85 A35 35 0 0 1 15 50" fill="none" stroke="#b23a3a" stroke-width="3"/>
  <circle cx="50" cy="50" r="8" fill="#1a1410"/>
  <circle cx="50" cy="50" r="3.2" fill="#d8be86"/>
</svg>`;
}

/** Placeholders look like {{nav}} or {{mark:64}}; the argument stays path-safe. */
const PLACEHOLDER = /\{\{([a-z]+)(?::([A-Za-z0-9._/-]*))?\}\}/g;

export function createPageRenderer(options: PageRendererOptions) {
  const { publicDir } = options;
  const linkSuffix = options.linkSuffix ?? '.php';
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;

  /**
   * Stamp each asset with its file time. Without this a browser keeps showing
   * the previous styling after an update — which at a venue looks like a broken
   * screen rather than a stale cache. Read per call, so editing a stylesheet on
   * the laptop takes effect without a restart.
   */
  function assetUrl(file: string): string {
    let stamp = Math.floor(now() / 1000);
    try {
      stamp = Math.floor(fs.statSync(path.join(publicDir, file)).mtimeMs / 1000);
    } catch {
      // Missing file: fall back to "now" so the URL still changes rather than
      // pinning a browser to something that may appear later.
    }
    return `${file}?v=${stamp}`;
  }

  function renderHead(title: string, bigscreen: boolean): string {
    const extra = bigscreen ? `<link rel="stylesheet" href="${assetUrl('assets/board.css')}">` : '';
    return [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="robots" content="noindex">',
      `<title>${escapeHtml(title)}</title>`,
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">',
      `<link rel="stylesheet" href="${assetUrl('assets/style.css')}">`,
      extra,
    ].join('\n');
  }

  /** Minimal page switcher shared by every screen. */
  function renderNav(active: PageName): string {
    const links = NAV_ITEMS.map((item) => {
      const current = item.page === active ? ' aria-current="page"' : '';
      return `<a href="${escapeHtml(item.page + linkSuffix)}"${current}>${escapeHtml(item.label)}</a>`;
    });
    return `<nav class="pagenav">${links.join('')}</nav>`;
  }

  function fill(name: PageName, template: string): string {
    const spec = PAGE_SPECS[name];
    return template.replace(PLACEHOLDER, (whole, key: string, argument: string | undefined) => {
      if (key === 'head') return renderHead(spec.title, spec.bigscreen);
      if (key === 'nav') return renderNav(name);
      if (key === 'mark') {
        const size = Number.parseInt(argument ?? '', 10);
        return renderMark(Number.isInteger(size) && size > 0 ? size : MARK_SIZE_FALLBACK);
      }
      if (key === 'asset' && argument !== undefined) return escapeHtml(assetUrl(argument));
      if (key === 'env' && argument !== undefined) return scriptLiteral((env[argument] ?? '').trim());
      // A typo would otherwise ship "{{navv}}" to the screen in the hall.
      throw new Error(`Unknown placeholder ${whole} in ${name}.html`);
    });
  }

  return {
    assetUrl,
    renderHead,
    renderNav,
    renderMark,

    /** Fill in one page. Throws if the template is missing or has a bad placeholder. */
    renderPage(name: PageName): RenderedPage {
      const template = fs.readFileSync(path.join(publicDir, `${name}.html`), 'utf8');
      return { html: fill(name, template), headers: PAGE_HEADERS };
    },

    /** Render a template held in memory; the same substitution, no disk read. */
    renderTemplate(name: PageName, template: string): string {
      return fill(name, template);
    },
  };
}

export type PageRenderer = ReturnType<typeof createPageRenderer>;

/**
 * Which page a request is asking for, or null when it is not a page at all.
 * Both extensions resolve, so a bookmarked .php link from the Docker app and a
 * phone opening /board.html land on the same screen.
 */
export function pageNameFor(urlPath: string): PageName | null {
  const last = urlPath.split('/').pop() ?? '';
  if (last === '') return 'index';
  const base = last.replace(/\.(html|php)$/, '');
  return PAGE_NAMES.find((name) => name === base) ?? null;
}
