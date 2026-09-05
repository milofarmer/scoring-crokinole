<?php define('CROK', 1); require __DIR__ . '/../src/brand.php'; ?>
<!doctype html><html lang="en"><head><?php crok_head('Crokinole — API'); ?>
<link rel="stylesheet" href="<?= crok_asset('assets/apidocs.css') ?>">
</head>
<body class="apidocs">
<div class="doclayout">

  <aside class="docnav" id="docnav">
    <div class="brandline">
      <?= crok_mark(30) ?>
      <div>
        <div class="eyebrow">CROKINOLE</div>
        <div class="apiname">Tournament API</div>
      </div>
    </div>
    <label class="searchbox">
      <input id="navSearch" type="search" placeholder="Search" autocomplete="off" spellcheck="false">
    </label>
    <nav id="navList"></nav>
    <div class="navfoot">
      <a href="openapi.json" download>Download the spec</a>
    </div>
  </aside>

  <main class="doccontent" id="doccontent">
    <div class="loading" id="loading">Loading the API description…</div>
  </main>

</div>
<script src="<?= crok_asset('assets/apidocs.js') ?>"></script>
</body></html>
