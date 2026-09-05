<?php
/** Shared HTML head + crokinole board logo. Include only. */
if (!defined('CROK')) { http_response_code(403); exit('forbidden'); }

// The stylesheets carry a version in their URL and can be cached hard, but the
// page pointing at them must not be: a browser holding yesterday's HTML keeps
// asking for yesterday's stylesheet, so the screen in the hall quietly stays out
// of date after an update. This has to run before anything is printed, which is
// why it lives here rather than in crok_head().
if (!headers_sent()) {
    header('Cache-Control: no-store, must-revalidate');
}

/**
 * Stamp each stylesheet with its file time. Without this a browser keeps showing
 * the previous styling after an update — which at a venue looks like a broken
 * screen rather than a stale cache.
 */
function crok_asset(string $file): string {
    $path = __DIR__ . '/../public/' . $file;
    $stamp = is_file($path) ? filemtime($path) : time();
    return $file . '?v=' . $stamp;
}

function crok_head(string $title, bool $bigscreen = false): void {
    $extra = $bigscreen
        ? '<link rel="stylesheet" href="' . crok_asset('assets/board.css') . '">'
        : '';
    $style = crok_asset('assets/style.css');
    echo <<<HTML
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>{$title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{$style}">
{$extra}
HTML;
}

/** Minimal page switcher shared by every screen. */
function crok_nav(string $active): string {
    $items = ['index.php' => 'Score', 'board.php' => 'Board', 'season.php' => 'Season',
              'admin.php' => 'Organizer', 'api-docs.php' => 'API'];
    $h = '<nav class="pagenav">';
    foreach ($items as $href => $label) {
        $cur = $active === $href ? ' aria-current="page"' : '';
        $h .= '<a href="' . $href . '"' . $cur . '>' . $label . '</a>';
    }
    return $h . '</nav>';
}

/** Inline crokinole-board mark (concentric rings, red/blue quadrant arcs, centre 20-hole). */
function crok_mark(int $size = 44): string {
    return <<<SVG
<svg class="mark" width="{$size}" height="{$size}" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="48" fill="#fffdf8" stroke="#1a1410" stroke-width="2.5"/>
  <circle cx="50" cy="50" r="35" fill="none" stroke="#c6a96a" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="22" fill="none" stroke="#c6a96a" stroke-width="1.5"/>
  <path d="M50 15 A35 35 0 0 1 85 50" fill="none" stroke="#b23a3a" stroke-width="3"/>
  <path d="M15 50 A35 35 0 0 1 50 15" fill="none" stroke="#2e4a7a" stroke-width="3"/>
  <path d="M85 50 A35 35 0 0 1 50 85" fill="none" stroke="#2e4a7a" stroke-width="3"/>
  <path d="M50 85 A35 35 0 0 1 15 50" fill="none" stroke="#b23a3a" stroke-width="3"/>
  <circle cx="50" cy="50" r="8" fill="#1a1410"/>
  <circle cx="50" cy="50" r="3.2" fill="#d8be86"/>
</svg>
SVG;
}
