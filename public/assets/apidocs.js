/**
 * Renders the API reference from openapi.json.
 *
 * Written out here rather than pulling a documentation tool from a CDN, for the
 * same reason as everything else on this laptop: the hall may have no internet,
 * and a page that only works when it can reach the outside world is no use to
 * somebody wiring up a scoring machine at the venue on the morning of an event.
 *
 * It reads the spec at runtime, so the docs cannot drift from it: change
 * openapi.json and this follows.
 */
(function () {
  'use strict';

  const $ = (s, root) => (root || document).querySelector(s);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---- just enough markdown for the descriptions in the spec ---- */

  function inline(text) {
    // Escape first, then re-introduce only the markup we mean to allow, so a
    // description can never inject markup into the page.
    let out = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out = out.replace(/`([^`]+)`/g, (m, code) => '<code>' + code + '</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, (m, bold) => '<strong>' + bold + '</strong>');
    return out;
  }

  function markdown(text) {
    if (!text) return '';
    const lines = String(text).split('\n');
    let html = '';
    let list = null;
    let code = null;
    let indented = null;

    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    const closeIndented = () => {
      if (!indented) return;
      // Trailing blank lines belong outside the block, not inside it.
      while (indented.length && indented[indented.length - 1].trim() === '') indented.pop();
      html += '<pre><code>' + inline(indented.join('\n')) + '</code></pre>';
      indented = null;
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');

      if (code !== null) {
        if (/^\s*```/.test(line)) { html += '<pre><code>' + inline(code.join('\n')) + '</code></pre>'; code = null; }
        else code.push(raw);
        continue;
      }
      if (/^\s*```/.test(line)) { closeList(); closeIndented(); code = []; continue; }

      // An indented run is a code sample too; the spec uses that for the
      // two-ways-to-call example. Consecutive lines are one block, so a sample
      // does not come out as a stack of separate boxes.
      if (/^ {4}\S/.test(raw)) {
        closeList();
        if (!indented) indented = [];
        indented.push(raw.replace(/^ {4}/, ''));
        continue;
      }
      // A blank line inside an indented run does not end it; the next real line does.
      if (indented && line.trim() === '') { indented.push(''); continue; }
      closeIndented();

      if (line.trim() === '') { closeList(); continue; }

      const heading = line.match(/^(#{2,4})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = Math.min(heading[1].length, 3);
        html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
        continue;
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
        html += '<li>' + inline(bullet[1]) + '</li>';
        continue;
      }
      const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (numbered) {
        if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
        html += '<li>' + inline(numbered[1]) + '</li>';
        continue;
      }

      closeList();
      html += '<p>' + inline(line) + '</p>';
    }
    closeList();
    closeIndented();
    if (code !== null) html += '<pre><code>' + inline(code.join('\n')) + '</code></pre>';
    return html;
  }

  /* ---- reading the spec ---- */

  let SPEC = null;

  /** Follow a $ref, or hand back what was already a schema. */
  function resolve(node) {
    let current = node;
    let hops = 0;
    while (current && current.$ref && hops < 20) {
      const path = current.$ref.replace(/^#\//, '').split('/');
      let found = SPEC;
      for (const part of path) found = found ? found[part] : undefined;
      current = found;
      hops += 1;
    }
    return current || {};
  }

  /** A readable type name: "string", "integer or null", "array of SetScore". */
  function typeName(schema) {
    const s = resolve(schema);
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.enum) return s.enum.map((v) => (v === null ? 'null' : String(v))).join(' | ');
    if (s.oneOf) return s.oneOf.map(typeName).join(' or ');
    let t = s.type;
    if (Array.isArray(t)) t = t.join(' or ');
    if (t === 'array') {
      const inner = s.items && s.items.$ref ? s.items.$ref.split('/').pop() : typeName(s.items || {});
      return 'array of ' + inner;
    }
    return t || 'object';
  }

  /** One property of a schema, recursing one level into nested objects. */
  function fieldNode(name, schema, required, depth) {
    const s = resolve(schema);
    const wrap = el('div', 'field');
    const line = el('div', 'fieldline');
    line.appendChild(el('span', 'fieldname', name));
    line.appendChild(el('span', 'fieldtype', typeName(schema)));
    if (required) line.appendChild(el('span', 'req', 'REQUIRED'));
    if (s.default !== undefined) line.appendChild(el('span', 'fieldtype', 'default ' + JSON.stringify(s.default)));
    wrap.appendChild(line);

    if (s.description) {
      const d = el('div', 'fielddesc');
      d.innerHTML = inline(s.description);
      wrap.appendChild(d);
    }

    // Go one level down, and one more for arrays of objects, then stop: past
    // that it stops being a summary and starts being a wall.
    const inner = s.type === 'array' ? resolve(s.items || {}) : s;
    if (depth < 2 && inner.properties) {
      const nest = el('div', 'nested');
      const req = inner.required || [];
      for (const key of Object.keys(inner.properties)) {
        nest.appendChild(fieldNode(key, inner.properties[key], req.indexOf(key) !== -1, depth + 1));
      }
      wrap.appendChild(nest);
    }
    return wrap;
  }

  function schemaFields(schema, depth) {
    const s = resolve(schema);
    const box = document.createDocumentFragment();
    if (!s.properties) return box;
    const req = s.required || [];
    for (const key of Object.keys(s.properties)) {
      box.appendChild(fieldNode(key, s.properties[key], req.indexOf(key) !== -1, depth || 0));
    }
    return box;
  }

  /* ---- request examples ---- */

  function firstExample(op) {
    const body = op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
    if (!body) return null;
    if (body.examples) {
      const names = Object.keys(body.examples);
      if (names.length) return { names, examples: body.examples };
    }
    if (body.example) return { names: ['example'], examples: { example: { value: body.example } } };
    return null;
  }

  function curlFor(path, method, bodyValue, op) {
    const origin = window.location.origin;
    let out = 'curl ' + origin + path;
    if (method !== 'get') out = 'curl -X ' + method.toUpperCase() + ' ' + origin + path;

    const needsKey = (op.security || []).some((s) => s.MachineKey);
    if (needsKey) out += " \\\n  --header 'X-Api-Key: <your key>'";
    if (bodyValue) {
      out += " \\\n  --header 'Content-Type: application/json'";
      out += " \\\n  --data '" + JSON.stringify(bodyValue) + "'";
    }
    return out;
  }

  /* ---- the try-it panel ---- */

  function tryPanel(path, method, op, initialBody) {
    const panel = el('div', 'panel');
    const head = el('div', 'panelhead');
    head.appendChild(el('span', 't', 'Try it'));
    panel.appendChild(head);

    const form = el('form', 'tryform');
    const needsKey = (op.security || []).some((s) => s.MachineKey);

    let keyInput = null;
    if (needsKey) {
      const label = el('label');
      label.appendChild(el('span', null, 'X-Api-Key'));
      keyInput = el('input');
      keyInput.type = 'text';
      keyInput.placeholder = 'the event API key';
      keyInput.autocomplete = 'off';
      // Remembered on this machine only, so the organiser is not retyping it
      // every time they check something.
      try { keyInput.value = localStorage.getItem('crok_docs_apikey') || ''; } catch (e) { keyInput.value = ''; }
      label.appendChild(keyInput);
      form.appendChild(label);
    }

    let bodyInput = null;
    if (method !== 'get') {
      const label = el('label');
      label.appendChild(el('span', null, 'Body'));
      bodyInput = el('textarea');
      bodyInput.spellcheck = false;
      bodyInput.value = initialBody ? JSON.stringify(initialBody, null, 2) : '{}';
      label.appendChild(bodyInput);
      form.appendChild(label);
    }

    const go = el('button', 'btn go', 'Send request');
    go.type = 'submit';
    form.appendChild(go);
    panel.appendChild(form);

    const result = el('div', 'tryresult');
    result.hidden = true;
    panel.appendChild(result);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const options = { method: method.toUpperCase(), headers: {} };
      if (keyInput && keyInput.value.trim() !== '') {
        options.headers['X-Api-Key'] = keyInput.value.trim();
        try { localStorage.setItem('crok_docs_apikey', keyInput.value.trim()); } catch (e) { /* private mode */ }
      }
      if (bodyInput) {
        try {
          JSON.parse(bodyInput.value);
        } catch (e) {
          show(result, 0, 'That body is not valid JSON: ' + e.message);
          return;
        }
        options.headers['Content-Type'] = 'application/json';
        options.body = bodyInput.value;
      }

      go.disabled = true;
      go.textContent = 'Sending…';
      try {
        const response = await fetch(path, options);
        const text = await response.text();
        let pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* not JSON */ }
        show(result, response.status, pretty);
      } catch (e) {
        show(result, 0, 'The request did not complete: ' + e.message);
      } finally {
        go.disabled = false;
        go.textContent = 'Send request';
      }
    });

    return panel;
  }

  function show(box, status, text) {
    box.hidden = false;
    box.className = 'tryresult ' + (status >= 200 && status < 300 ? 'ok' : 'bad');
    box.innerHTML = '';
    const head = el('div', 'rhead');
    head.appendChild(el('span', 'st', status === 0 ? 'FAILED' : String(status)));
    box.appendChild(head);
    const pre = el('pre', 'code');
    pre.textContent = text;
    box.appendChild(pre);
  }

  /* ---- building the page ---- */

  function operationNode(path, method, op) {
    const row = el('div', 'oprow');
    row.id = 'op-' + (op.operationId || method + path.replace(/\W+/g, '-'));

    const main = el('div', 'opmain');
    const line = el('div', 'opline');
    line.appendChild(el('span', 'verb ' + method, method.toUpperCase()));
    line.appendChild(el('span', 'oppath', path));
    for (const scheme of op.security || []) {
      if (scheme.MachineKey) line.appendChild(el('span', 'opauth', 'API key'));
      if (scheme.AdminPin) line.appendChild(el('span', 'opauth', 'Organiser PIN'));
    }
    main.appendChild(line);
    main.appendChild(el('div', 'opsummary', op.summary || ''));

    if (op.description) {
      const prose = el('div', 'prose');
      prose.innerHTML = markdown(op.description);
      main.appendChild(prose);
    }

    const params = (op.parameters || []).map(resolve);
    if (params.length) {
      main.appendChild(el('div', 'subhead', 'Parameters'));
      for (const p of params) {
        const wrap = el('div', 'field');
        const l = el('div', 'fieldline');
        l.appendChild(el('span', 'fieldname', p.name));
        l.appendChild(el('span', 'fieldtype', typeName(p.schema || {}) + ' · in ' + p.in));
        if (p.required) l.appendChild(el('span', 'req', 'REQUIRED'));
        wrap.appendChild(l);
        if (p.description) {
          const d = el('div', 'fielddesc');
          d.innerHTML = inline(p.description);
          wrap.appendChild(d);
        }
        main.appendChild(wrap);
      }
    }

    const bodySchema = op.requestBody && op.requestBody.content
      && op.requestBody.content['application/json']
      && op.requestBody.content['application/json'].schema;
    if (bodySchema) {
      main.appendChild(el('div', 'subhead', 'Body'));
      main.appendChild(schemaFields(bodySchema, 0));
    }

    main.appendChild(el('div', 'subhead', 'Responses'));
    for (const code of Object.keys(op.responses || {})) {
      const r = resolve(op.responses[code]);
      const s = el('div', 'status ' + (code.charAt(0) === '2' ? 'ok' : 'bad'));
      s.appendChild(el('span', 'code', code));
      const what = el('span', 'what');
      what.innerHTML = inline(r.description || '');
      s.appendChild(what);
      main.appendChild(s);
    }

    /* right column */
    const side = el('div', 'opside');
    const found = firstExample(op);
    let current = found ? found.examples[found.names[0]].value : null;

    const sample = el('div', 'panel');
    const sampleHead = el('div', 'panelhead');
    sampleHead.appendChild(el('span', 't', 'Request'));
    const pre = el('pre', 'code');

    const paint = () => { pre.innerHTML = curlFor(path, method, current, op)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    if (found && found.names.length > 1) {
      for (const name of found.names) {
        const b = el('button', null, found.examples[name].summary || name);
        b.type = 'button';
        if (name === found.names[0]) b.classList.add('on');
        b.addEventListener('click', () => {
          current = found.examples[name].value;
          paint();
          const editor = $('.tryform textarea', side);
          if (editor) editor.value = JSON.stringify(current, null, 2);
          for (const other of sampleHead.querySelectorAll('button')) other.classList.remove('on');
          b.classList.add('on');
        });
        sampleHead.appendChild(b);
      }
    }
    paint();
    sample.appendChild(sampleHead);
    sample.appendChild(pre);
    side.appendChild(sample);
    side.appendChild(tryPanel(path, method, op, current));

    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  function build(spec) {
    SPEC = spec;
    const content = $('#doccontent');
    const navList = $('#navList');
    content.innerHTML = '';
    navList.innerHTML = '';

    /* intro */
    const intro = el('div', 'docintro');
    intro.appendChild(el('h1', null, spec.info.title));
    const badges = el('div', 'badges');
    badges.appendChild(el('span', 'badge on', 'v' + spec.info.version));
    badges.appendChild(el('span', 'badge', 'OpenAPI ' + spec.openapi));
    badges.appendChild(el('span', 'badge', window.location.host));
    intro.appendChild(badges);
    const introProse = el('div', 'prose');
    introProse.innerHTML = markdown(spec.info.description || spec.info.summary || '');
    intro.appendChild(introProse);
    content.appendChild(intro);

    /* group the operations by tag, in the order the spec lists its tags */
    const groups = new Map();
    for (const tag of spec.tags || []) groups.set(tag.name, []);
    for (const path of Object.keys(spec.paths)) {
      for (const method of Object.keys(spec.paths[path])) {
        const op = spec.paths[path][method];
        const tag = (op.tags && op.tags[0]) || 'Other';
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push({ path, method, op });
      }
    }

    for (const [name, ops] of groups) {
      if (!ops.length) continue;
      const tagInfo = (spec.tags || []).filter((t) => t.name === name)[0] || {};

      const head = el('div', 'grouphead');
      head.id = 'tag-' + name.replace(/\W+/g, '-').toLowerCase();
      head.appendChild(el('h2', null, name));
      if (tagInfo.description) head.appendChild(el('p', null, tagInfo.description));
      content.appendChild(head);

      navList.appendChild(el('div', 'navgroup', name));
      for (const entry of ops) {
        const node = operationNode(entry.path, entry.method, entry.op);
        content.appendChild(node);

        const link = el('a', 'navitem');
        link.href = '#' + node.id;
        link.dataset.target = node.id;
        link.appendChild(el('span', 'verb ' + entry.method, entry.method.toUpperCase()));
        link.appendChild(el('span', null, entry.op.summary || entry.path));
        link.dataset.search = ((entry.op.summary || '') + ' ' + entry.path + ' ' + name).toLowerCase();
        navList.appendChild(link);
      }
    }

    wireSearch();
    wireHighlight();
  }

  function wireSearch() {
    const input = $('#navSearch');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let visibleInGroup = 0;
      const groupNodes = [];
      for (const node of $('#navList').children) {
        if (node.classList.contains('navgroup')) {
          groupNodes.push({ node, from: visibleInGroup });
          visibleInGroup = 0;
          continue;
        }
        const hit = q === '' || (node.dataset.search || '').indexOf(q) !== -1;
        node.hidden = !hit;
        if (hit) visibleInGroup += 1;
        if (groupNodes.length) groupNodes[groupNodes.length - 1].count = visibleInGroup;
      }
      // A heading with nothing under it is just noise.
      for (const g of groupNodes) g.node.hidden = q !== '' && !g.count;
    });
  }

  /** Mark the operation currently on screen in the index. */
  function wireHighlight() {
    const links = Array.prototype.slice.call(document.querySelectorAll('.navitem'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    const byId = new Map(links.map((a) => [a.dataset.target, a]));
    const seen = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target.id); else seen.delete(entry.target.id);
      }
      for (const a of links) a.classList.remove('on');
      for (const a of links) {
        if (seen.has(a.dataset.target)) { a.classList.add('on'); break; }
      }
    }, { rootMargin: '-80px 0px -70% 0px' });
    for (const id of byId.keys()) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
  }

  fetch('openapi.json')
    .then((r) => {
      if (!r.ok) throw new Error('the spec came back as ' + r.status);
      return r.json();
    })
    .then(build)
    .catch((e) => {
      const box = $('#loading');
      if (box) box.textContent = 'Could not load openapi.json: ' + e.message;
    });
}());
