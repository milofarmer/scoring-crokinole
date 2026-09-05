<?php define('CROK', 1); require __DIR__ . '/../src/brand.php'; ?>
<!doctype html><html lang="en"><head><?php crok_head('Crokinole — Organizer'); ?></head>
<body>
<div class="wrap">
  <?= crok_nav('admin.php') ?>
  <div class="topbar">
    <?= crok_mark(44) ?>
    <div class="titles"><div class="eyebrow">Organizer</div><h1>Control panel</h1></div>
  </div>

  <!-- gate / create -->
  <div id="gate">
    <div id="loginCard" class="card hidden">
      <h2>Organizer sign-in</h2>
      <label class="field"><span class="lab">Organizer PIN</span>
        <input id="loginPin" type="password" autocomplete="off"></label>
      <button class="btn wide" id="loginBtn">Enter</button>
      <p id="loginErr" class="muted center" style="color:var(--red)"></p>
    </div>

    <div id="createCard" class="card hidden">
      <h2>Create tournament</h2>
      <label class="field"><span class="lab">Name</span><input id="cName" value="NK Crokinole"></label>
      <div class="row">
        <label class="field"><span class="lab">Table code (players)</span><input id="cCode" placeholder="e.g. NK2026"></label>
        <label class="field"><span class="lab">Organizer PIN</span><input id="cPin" placeholder="secret"></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Rounds</span><input id="cRounds" class="num" type="number" value="4"></label>
        <label class="field"><span class="lab">Win pts</span><input id="cWin" class="num" type="number" value="2"></label>
        <label class="field"><span class="lab">Tie pts</span><input id="cTie" class="num" type="number" value="1"></label>
      </div>
      <button class="btn wide" id="createBtn">Create &amp; start</button>
    </div>
  </div>

  <!-- dashboard -->
  <div id="dash" class="hidden">
    <!-- settings -->
    <div class="card">
      <h2>Event</h2>
      <div class="row">
        <label class="field"><span class="lab">Name</span><input id="sName"></label>
        <label class="field"><span class="lab">Table code</span><input id="sCode"></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Rounds</span><input id="sRounds" class="num" type="number"></label>
        <label class="field"><span class="lab">Win</span><input id="sWin" class="num" type="number"></label>
        <label class="field"><span class="lab">Tie</span><input id="sTie" class="num" type="number"></label>
        <label class="field"><span class="lab">Status</span>
          <select id="sStatus"><option value="running">running</option><option value="finished">finished</option><option value="setup">setup</option></select></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Current round (shown on phones &amp; board)</span>
          <select id="sCurrent"></select></label>
        <div style="align-self:end"><button class="btn wide" id="saveEvent">Save event</button></div>
      </div>
    </div>

    <!-- poules -->
    <div class="card">
      <h2>Poules</h2>
      <div id="pouleList"></div>
      <div class="row" style="margin-top:6px">
        <input id="pName" placeholder="Poule name (e.g. A)">
        <input id="pTables" class="num" type="number" placeholder="tables" value="11">
        <button class="btn ghost" id="addPoule" style="flex:0 0 auto">Add poule</button>
      </div>
    </div>

    <!-- teams -->
    <div class="card">
      <h2>Teams (<span id="teamCount">0</span>)</h2>
      <div class="row">
        <input id="tName" placeholder="Team name">
        <input id="tP1" placeholder="Player 1">
        <input id="tP2" placeholder="Player 2">
        <select id="tPoule" style="flex:0 0 130px"></select>
        <button class="btn ghost" id="addTeam" style="flex:0 0 auto">Add</button>
      </div>
      <details style="margin:12px 0">
        <summary class="mono muted" style="cursor:pointer">Bulk add — one per line: <code>Team; Player 1; Player 2; PouleName</code></summary>
        <textarea id="bulk" rows="5" style="margin-top:8px" placeholder="Sharpshooters; Anne; Bram; A&#10;The Twenties; Cor; Dana; A"></textarea>
        <button class="btn ghost" id="bulkBtn" style="margin-top:8px">Add all</button>
      </details>
      <div id="teamList"></div>
    </div>

    <!-- rounds -->
    <div class="card">
      <h2>Draw &amp; scores</h2>
      <div class="row" style="align-items:end">
        <label class="field" style="flex:0 0 160px"><span class="lab">Round</span><select id="rSel"></select></label>
        <button class="btn ghost" id="genBtn" style="flex:0 0 auto">Generate draw</button>
        <button class="btn ghost" id="regenBtn" style="flex:0 0 auto">Redraw (wipe)</button>
        <button class="btn" id="makeCurrent" style="flex:0 0 auto">Set as current round</button>
      </div>
      <p class="muted" style="font-size:13px">Round 1 is a random draw; later rounds use Swiss pairing on the standings and avoid rematches.</p>
      <div id="matchList"></div>
    </div>

    <div class="card">
      <h2>Finals (loting)</h2>
      <p class="muted" style="font-size:13px;margin-top:-4px">Poule winners advance, plus the best runners-up (No.2's) as wildcards, into a cross-seeded bracket.</p>
      <div class="row" style="align-items:end">
        <label class="field" style="flex:0 0 130px"><span class="lab">Top per poule</span>
          <input id="koPer" class="num" type="number" min="1" value="1"></label>
        <label class="field" style="flex:0 0 170px"><span class="lab">+ Wildcards (best No.2's)</span>
          <input id="koWild" class="num" type="number" min="0" value="0"></label>
        <div class="field" style="flex:1"><span class="lab">To the finals</span>
          <div id="koTotal" class="mono" style="font-size:19px;padding:9px 0;color:var(--gold-2)">—</div></div>
      </div>
      <div class="row" style="margin-bottom:4px">
        <button class="btn" id="koGen" style="flex:0 0 auto">Generate bracket</button>
        <button class="btn ghost" id="koRegen" style="flex:0 0 auto">Rebuild (wipe KO)</button>
        <button class="btn ghost" id="koNext" style="flex:0 0 auto">Refresh bracket</button>
      </div>
      <div id="koRounds" class="mono muted" style="font-size:13px;margin-top:8px"></div>
    </div>

    <div class="card">
      <h2>Automated scoring (inbound API)</h2>
      <p class="muted" style="font-size:13px;margin-top:-4px">For an AI/table system that scores matches automatically. It posts to <code>api.php</code> with this key; everything else stays manual.</p>
      <label class="field"><span class="lab">API key</span>
        <input id="apiKey" readonly onclick="this.select()" style="font-family:var(--mono);font-size:13px"></label>
      <details>
        <summary class="mono muted" style="cursor:pointer;font-size:13px">How to call it</summary>
        <pre style="background:var(--panel-2);border-radius:10px;padding:12px;overflow:auto;font-size:12px;line-height:1.5">POST /api.php   (JSON, or header X-Api-Key)

1. What is on each table now
{ "action":"ingest_tables", "api_key":"KEY" }

2. Score a match  (identify by match_code, match_id, or table)
{ "action":"ingest_score", "api_key":"KEY",
  "match_code":"MD55",
  "sets":[ {"pa":30,"pb":24,"ta":1,"tb":0}, ... ],   // per set: points + 20's
  "complete":true,                                    // false = live/partial
  "source":"ai-table-3" }

Totals instead of sets: "points_a":118, "points_b":96, "twenties_a":4, "twenties_b":3
Knockout tie: add "shootout_winner": &lt;team_id&gt;</pre>
      </details>
    </div>

    <div class="card">
      <h2>Season ranking · Field-Weighted Points</h2>
      <p class="muted" style="font-size:13px;margin-top:-4px">Record results from official croki.nl nights. FWP is computed from the field (FSI/FDI/size). <a href="season.php" target="_blank">View leaderboard ↗</a></p>

      <div class="row" style="align-items:end">
        <label class="field" style="flex:1"><span class="lab">Add player</span><input id="spName" placeholder="Player name"></label>
        <button class="btn ghost" id="spAdd" style="flex:0 0 auto">Add player</button>
        <div class="muted mono" id="spCount" style="flex:0 0 auto;align-self:center"></div>
      </div>

      <div class="mono muted" style="margin:14px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Add a night</div>
      <div class="row">
        <label class="field" style="flex:2"><span class="lab">Event</span><input id="snName" placeholder="e.g. Elmira 2026"></label>
        <label class="field" style="flex:1"><span class="lab">Date</span><input id="snDate" type="date"></label>
        <label class="field" style="flex:1"><span class="lab">Host</span><input id="snHost" placeholder="croki.nl"></label>
      </div>
      <div class="row" style="align-items:end">
        <label class="field" style="flex:0 0 90px"><span class="lab">Season</span><input id="snSeason" value="S17"></label>
        <label class="field" style="flex:0 0 120px"><span class="lab">Type</span>
          <select id="snType"><option value="singles">singles</option><option value="doubles">doubles</option></select></label>
        <label class="field" style="flex:0 0 90px"><span class="lab">Field size</span><input id="snSize" class="num" type="number" min="2"></label>
        <label class="field" style="flex:0 0 90px"><span class="lab">FSI</span><input id="snFsi" class="num" type="number" step="0.01" value="1.00"></label>
        <label class="field" style="flex:0 0 90px"><span class="lab">FDI</span><input id="snFdi" class="num" type="number" step="0.01" value="1.00"></label>
        <button class="btn" id="snAdd" style="flex:0 0 auto">Add night</button>
      </div>
      <div id="nightList"></div>

      <div class="mono muted" style="margin:14px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Add a result</div>
      <div class="row" style="align-items:end">
        <label class="field" style="flex:2"><span class="lab">Night</span><select id="srNight"></select></label>
        <label class="field" style="flex:2"><span class="lab">Player</span><select id="srPlayer"></select></label>
        <label class="field" style="flex:0 0 100px"><span class="lab">Position</span><input id="srPos" class="num" type="number" min="1"></label>
        <div class="field" style="flex:0 0 90px"><span class="lab">FWP</span><div id="srFwp" class="mono" style="padding:9px 0;color:var(--gold-2)">—</div></div>
        <button class="btn ghost" id="srAdd" style="flex:0 0 auto">Add result</button>
      </div>
      <div id="resultList"></div>
    </div>

    <div class="card">
      <h2>Danger zone</h2>
      <button class="btn danger" id="resetBtn">Delete this event &amp; all data</button>
    </div>
  </div>

</div>

<script>
const $ = s => document.querySelector(s);
let A = null, curRound = 1;
function pin(){ return sessionStorage.getItem('crok_pin') || ''; }
function setPin(v){ sessionStorage.setItem('crok_pin', v); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(m,e){ const t=document.createElement('div'); t.className='toast'+(e?' err':''); t.textContent=m; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }
async function api(action, data){
  const r = await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({action, admin_pin:pin()}, data||{}))});
  return r.json();
}

async function boot(){
  const s = await (await fetch('api.php?action=state')).json();
  if(!s.event){ $('#createCard').classList.remove('hidden'); return; }
  if(pin()){ const r = await api('admin_login'); if(r.ok){ return show(); } sessionStorage.removeItem('crok_pin'); }
  $('#loginCard').classList.remove('hidden');
}

$('#loginBtn').onclick = async ()=>{
  setPin($('#loginPin').value.trim());
  const r = await api('admin_login');
  if(r.ok){ $('#loginErr').textContent=''; show(); }
  else { $('#loginErr').textContent = r.error||'Wrong PIN'; sessionStorage.removeItem('crok_pin'); }
};
$('#createBtn').onclick = async ()=>{
  const r = await api('create_event', {name:$('#cName').value, play_code:$('#cCode').value,
    admin_pin:$('#cPin').value, num_rounds:+$('#cRounds').value, points_win:+$('#cWin').value, points_tie:+$('#cTie').value});
  if(!r.ok){ toast(r.error,true); return; }
  setPin($('#cPin').value.trim()); show();
};

async function show(){
  $('#gate').classList.add('hidden'); $('#dash').classList.remove('hidden');
  await refresh();
}

async function refresh(){
  const r = await api('admin_state', {round:curRound});
  if(!r.ok){ toast(r.error,true); return; }
  A = r; curRound = r.round;
  // event fields
  $('#sName').value=r.event.name||''; $('#sCode').value=r.event.play_code||'';
  $('#sRounds').value=r.event.num_rounds; $('#sWin').value=r.event.points_win; $('#sTie').value=r.event.points_tie;
  $('#sStatus').value=r.event.status;
  $('#apiKey').value=r.event.api_key||'';
  fillRoundSelects();
  renderPoules(); renderTeams(); renderMatches(); renderKo();
}

function fillRoundSelects(){
  const n=A.event.num_rounds;
  const cur=$('#sCurrent'), rs=$('#rSel');
  cur.innerHTML=''; rs.innerHTML='';
  const opt=(v,lab,selRef)=>`<option value="${v}" ${v===selRef?'selected':''}>${lab}</option>`;
  for(let i=1;i<=n;i++){
    cur.insertAdjacentHTML('beforeend', opt(i,'Round '+i,A.event.current_round));
    rs.insertAdjacentHTML('beforeend', opt(i,'Round '+i,curRound));
  }
  (A.ko_rounds||[]).forEach(k=>{
    cur.insertAdjacentHTML('beforeend', opt(k.round,k.label||('KO '+k.round),A.event.current_round));
    rs.insertAdjacentHTML('beforeend', opt(k.round,k.label||('KO '+k.round),curRound));
  });
}

function renderKo(){
  $('#koPer').value=A.event.advance_per_poule||1;
  $('#koWild').value=A.event.wildcards||0;
  koTotal();
  const ks=A.ko_rounds||[];
  $('#koRounds').innerHTML = ks.length
    ? 'Bracket: '+ks.map(k=>esc(k.label)+' ('+k.count+')').join(' → ')
    : 'No bracket generated yet.';
}
function koTotal(){
  const poules=(A.poules||[]).length;
  const per=Math.max(1,+$('#koPer').value||1), wild=Math.max(0,+$('#koWild').value||0);
  const total=poules*per+wild;
  let pow=1; while(pow<total) pow*=2;
  const byes = total>1 ? pow-total : 0;
  $('#koTotal').textContent = poules?(total+' teams  ('+poules+'×'+per+(wild?' + '+wild:'')+')'+(byes?'  · '+byes+' byes':'')):'add poules first';
}
$('#koPer').oninput=koTotal; $('#koWild').oninput=koTotal;
$('#koGen').onclick=()=>koGen(false);
$('#koRegen').onclick=()=>{ if(confirm('Rebuild the finals bracket? This wipes all KO matches & scores.')) koGen(true); };
async function koGen(force){
  const r=await api('generate_ko',{per_poule:+$('#koPer').value,wildcards:+$('#koWild').value,force:force?1:0});
  if(r.ok){ toast(r.label+' drawn ('+r.created+' matches)'); curRound=r.round; refresh(); } else toast(r.error,true);
}
$('#koNext').onclick=async ()=>{
  const r=await api('generate_next_ko');
  if(r.ok){ toast(r.label+' drawn'); curRound=r.round; refresh(); } else toast(r.error,true);
};

$('#saveEvent').onclick = async ()=>{
  const r = await api('update_event', {name:$('#sName').value, play_code:$('#sCode').value,
    num_rounds:+$('#sRounds').value, points_win:+$('#sWin').value, points_tie:+$('#sTie').value,
    current_round:+$('#sCurrent').value, status:$('#sStatus').value});
  if(r.ok){ toast('Saved'); refresh(); } else toast(r.error,true);
};

/* poules */
function renderPoules(){
  const pmap = A.poules;
  $('#pouleList').innerHTML = pmap.length ? pmap.map(p=>{
    const teams = A.teams.filter(t=>t.poule_id===p.id).length;
    return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
      <b class="mono">Poule ${esc(p.name)}</b><span class="muted">${p.tables} tables · ${teams} teams</span></div>`;
  }).join('') : '<p class="muted">No poules yet. Add A and B.</p>';
  // team + poule dropdowns
  const opts = '<option value="0">— no poule —</option>' + A.poules.map(p=>`<option value="${p.id}">Poule ${esc(p.name)}</option>`).join('');
  $('#tPoule').innerHTML = opts;
}
$('#addPoule').onclick = async ()=>{
  const list = A.poules.map(p=>({name:p.name, tables:p.tables}));
  const name=$('#pName').value.trim(); if(!name){ toast('Name?',true); return; }
  list.push({name, tables:+$('#pTables').value||11});
  const r = await api('set_poules', {poules:list});
  if(r.ok){ $('#pName').value=''; toast('Poule added'); refresh(); } else toast(r.error,true);
};

/* teams */
function renderTeams(){
  $('#teamCount').textContent = A.teams.length;
  const pById = {}; A.poules.forEach(p=>pById[p.id]=p.name);
  const groups = {};
  A.teams.forEach(t=>{ (groups[t.poule_id]=groups[t.poule_id]||[]).push(t); });
  let html='';
  Object.keys(groups).forEach(pid=>{
    const label = pById[pid] ? 'Poule '+pById[pid] : 'No poule';
    html += `<div class="mono muted" style="margin:10px 0 4px">${esc(label)} · ${groups[pid].length}</div>`;
    groups[pid].forEach(t=>{
      const psel = '<option value="0">—</option>'+A.poules.map(p=>`<option value="${p.id}" ${p.id===t.poule_id?'selected':''}>${esc(p.name)}</option>`).join('');
      html += `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
        <span class="mono muted" style="width:28px">${t.number}</span>
        <span style="flex:1"><b>${esc(t.name)}</b> <span class="muted">${esc([t.player1,t.player2].filter(Boolean).join(' · '))}</span></span>
        <span class="mono" title="team login code" style="flex:0 0 auto;background:var(--gold-soft);border:1px solid var(--gold-2);color:#6a5326;border-radius:6px;padding:2px 8px;letter-spacing:.12em">${esc(t.login_code||'—')}</span>
        <select data-team="${t.id}" class="tp" style="flex:0 0 90px">${psel}</select>
        <button class="btn danger" data-del="${t.id}" style="flex:0 0 auto;padding:6px 10px">✕</button></div>`;
    });
  });
  $('#teamList').innerHTML = html || '<p class="muted">No teams yet.</p>';
  $('#teamList').querySelectorAll('.tp').forEach(sel=> sel.onchange = async ()=>{
    const r = await api('update_team', {id:+sel.dataset.team, poule_id:+sel.value}); if(r.ok) refresh(); else toast(r.error,true);
  });
  $('#teamList').querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{
    if(!confirm('Delete team?')) return;
    const r = await api('delete_team', {id:+b.dataset.del}); if(r.ok){ toast('Deleted'); refresh(); } else toast(r.error,true);
  });
}
$('#addTeam').onclick = async ()=>{
  const r = await api('add_team', {name:$('#tName').value, player1:$('#tP1').value, player2:$('#tP2').value, poule_id:+$('#tPoule').value});
  if(r.ok){ $('#tName').value=$('#tP1').value=$('#tP2').value=''; toast('Added'); refresh(); } else toast(r.error,true);
};
$('#bulkBtn').onclick = async ()=>{
  const r = await api('bulk_add_teams', {text:$('#bulk').value});
  if(r.ok){ $('#bulk').value=''; toast('Added '+r.added+' teams'); refresh(); } else toast(r.error,true);
};

/* rounds */
$('#rSel').onchange = ()=>{ curRound=+$('#rSel').value; refresh(); };
$('#genBtn').onclick = ()=>gen(false);
$('#regenBtn').onclick = ()=>{ if(confirm('Redraw round '+curRound+'? This wipes its current matches & scores.')) gen(true); };
async function gen(force){
  const r = await api('generate_round', {round:curRound, force:force?1:0});
  if(r.ok){ toast('Drew '+r.created+' matches'); refresh(); } else toast(r.error,true);
}
$('#makeCurrent').onclick = async ()=>{
  const r = await api('update_event', {current_round:curRound});
  if(r.ok){ toast('Round '+curRound+' is now live'); refresh(); } else toast(r.error,true);
};

function renderMatches(){
  const tById={}; A.teams.forEach(t=>tById[t.id]=t);
  const pById={}; A.poules.forEach(p=>pById[p.id]=p.name);
  if(!A.matches.length){ $('#matchList').innerHTML='<p class="muted">No matches for round '+curRound+'. Click “Generate draw”.</p>'; return; }
  const groups={}; A.matches.forEach(m=>{ (groups[m.poule_id]=groups[m.poule_id]||[]).push(m); });
  let html='';
  Object.keys(groups).forEach(pid=>{
    html += `<div class="mono muted" style="margin:12px 0 4px">${pById[pid]?'Poule '+esc(pById[pid]):'Matches'}</div>`;
    groups[pid].sort((a,b)=>a.table_no-b.table_no).forEach(m=>{
      const a=tById[m.team_a_id], b=tById[m.team_b_id];
      html += `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <span class="mono muted" style="flex:0 0 auto;min-width:32px">T${m.table_no}${m.match_code?` <span style="color:var(--gold-2)">#${m.match_code}</span>`:''}</span>
        <span style="flex:1 1 150px"><span class="pill a">A</span> ${esc(a?a.name:'—')}</span>
        <input class="num" data-f="points_a" data-m="${m.id}" type="number" min="0" style="flex:0 0 60px" value="${m.points_a??''}" placeholder="pts" title="total points">
        <input class="num" data-f="twenties_a" data-m="${m.id}" type="number" style="flex:0 0 54px" value="${m.twenties_a||0}" title="total 20s">
        <span style="flex:1 1 150px"><span class="pill b">B</span> ${b?esc(b.name):'<span class=muted>bye</span>'}</span>
        <input class="num" data-f="points_b" data-m="${m.id}" type="number" min="0" style="flex:0 0 60px" value="${m.points_b??''}" placeholder="pts" title="total points" ${b?'':'disabled'}>
        <input class="num" data-f="twenties_b" data-m="${m.id}" type="number" style="flex:0 0 54px" value="${m.twenties_b||0}" title="20s" ${b?'':'disabled'}>
        ${m.phase==='ko'&&b?`<select data-f="shootout_winner" data-m="${m.id}" style="flex:0 0 130px" title="shoot-out winner (2–2 only)">
          <option value="">shoot-out…</option>
          <option value="${m.team_a_id}" ${m.shootout_winner===m.team_a_id?'selected':''}>${esc(a?a.name:'A')} won SO</option>
          <option value="${m.team_b_id}" ${m.shootout_winner===m.team_b_id?'selected':''}>${esc(b.name)} won SO</option></select>`:''}
        <button class="btn ghost" data-save="${m.id}" style="flex:0 0 auto;padding:8px 12px">Save</button></div>`;
    });
  });
  $('#matchList').innerHTML = html;
  $('#matchList').querySelectorAll('[data-save]').forEach(btn=> btn.onclick = async ()=>{
    const id=btn.dataset.save; const g={};
    $('#matchList').querySelectorAll(`[data-m="${id}"]`).forEach(inp=>{ g[inp.dataset.f]= inp.value===''?null:+inp.value; });
    const r = await api('set_match', Object.assign({id:+id, status:'entered'}, g));
    if(r.ok){ toast('Saved'); refresh(); } else toast(r.error,true);
  });
}

$('#resetBtn').onclick = async ()=>{
  if(!confirm('Delete the entire event and all teams, poules, scores? This cannot be undone.')) return;
  const r = await api('reset_event'); if(r.ok){ location.reload(); } else toast(r.error,true);
};

/* season ranking (FWP) */
let SD = {players:[], nights:[], results:[]};
function fwpCalc(pos,N,fsi,fdi){ if(N<=1) return 50*fsi; pos=Math.max(1,Math.min(N,pos)); const x=(pos-1)/(N-1), f=0.40*fdi; return Math.round(50*fsi*(f+(1-f)*Math.pow(1-x,1.83))*10)/10; }
function nightById(id){ return SD.nights.find(n=>+n.id===+id); }
async function loadSeason(){
  const r = await api('season_data'); if(!r.ok) return;
  SD = {players:r.players||[], nights:r.nights||[], results:r.results||[]};
  $('#spCount').textContent = SD.players.length+' players';
  $('#srNight').innerHTML = SD.nights.length ? SD.nights.map(n=>`<option value="${n.id}">${esc(n.name)} · ${esc(n.type)} · N${n.field_size}</option>`).join('') : '<option value="">— add a night first —</option>';
  $('#srPlayer').innerHTML = SD.players.length ? SD.players.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">— add a player first —</option>';
  renderNightList(); renderResultList(); srPreview();
}
function renderNightList(){
  if(!SD.nights.length){ $('#nightList').innerHTML=''; return; }
  $('#nightList').innerHTML = SD.nights.map(n=>{
    const cnt = SD.results.filter(r=>+r.snight_id===+n.id).length;
    return `<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">
      <span class="mono muted" style="flex:0 0 84px">${esc(n.date||'')}</span>
      <b style="flex:1">${esc(n.name)}</b>
      <span class="muted mono" style="flex:0 0 auto">${esc(n.type)} · N${n.field_size} · FSI ${(+n.fsi).toFixed(2)} · FDI ${(+n.fdi).toFixed(2)} · 1st ${(50*n.fsi).toFixed(1)} · ${cnt} results</span>
      <button class="btn danger" data-delnight="${n.id}" style="flex:0 0 auto;padding:6px 10px">Delete</button></div>`;
  }).join('');
  $('#nightList').querySelectorAll('[data-delnight]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this night and its results?')) return;
    const r=await api('season_delete_night',{id:+b.dataset.delnight}); if(r.ok){ toast('Night deleted'); loadSeason(); } else toast(r.error,true);
  });
}
function renderResultList(){
  const nid=+$('#srNight').value; const rows=SD.results.filter(r=>+r.snight_id===nid).sort((a,b)=>a.position-b.position);
  if(!nid || !rows.length){ $('#resultList').innerHTML='<p class="muted" style="font-size:13px">No results for this night yet.</p>'; return; }
  $('#resultList').innerHTML = rows.map(r=>`<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)">
      <span class="mono muted" style="flex:0 0 40px">#${r.position}</span>
      <b style="flex:1">${esc(r.player_name)}</b>
      <span class="mono" style="flex:0 0 auto;color:var(--gold-2)">${(+r.fwp).toFixed(1)} FWP</span>
      <button class="btn danger" data-delres="${r.id}" style="flex:0 0 auto;padding:6px 10px">Remove</button></div>`).join('');
  $('#resultList').querySelectorAll('[data-delres]').forEach(b=>b.onclick=async()=>{
    const r=await api('season_delete_result',{id:+b.dataset.delres}); if(r.ok){ loadSeason(); } else toast(r.error,true);
  });
}
function srPreview(){
  const n=nightById($('#srNight').value); const pos=+$('#srPos').value;
  $('#srFwp').textContent = (n&&pos) ? fwpCalc(pos,+n.field_size,+n.fsi,+n.fdi).toFixed(1) : '—';
}
$('#srNight').onchange=()=>{ renderResultList(); srPreview(); };
$('#srPos').oninput=srPreview;
$('#spAdd').onclick=async()=>{ const name=$('#spName').value.trim(); if(!name){toast('Name?',true);return;}
  const r=await api('season_add_player',{name}); if(r.ok){ $('#spName').value=''; toast('Player added'); loadSeason(); } else toast(r.error,true); };
$('#snAdd').onclick=async()=>{
  const r=await api('season_save_night',{season:$('#snSeason').value,name:$('#snName').value,date:$('#snDate').value,
    host:$('#snHost').value,type:$('#snType').value,field_size:+$('#snSize').value,fsi:+$('#snFsi').value,fdi:+$('#snFdi').value});
  if(r.ok){ $('#snName').value=''; toast('Night added'); loadSeason(); } else toast(r.error,true);
};
$('#srAdd').onclick=async()=>{
  const nid=+$('#srNight').value, pid=+$('#srPlayer').value, pos=+$('#srPos').value;
  if(!nid||!pid||!pos){ toast('Pick night, player and position',true); return; }
  const r=await api('season_add_result',{snight_id:nid,player_id:pid,position:pos});
  if(r.ok){ $('#srPos').value=''; toast('Result added ('+r.fwp+' FWP)'); loadSeason(); } else toast(r.error,true);
};

const _show=show; show=async function(){ await _show(); loadSeason(); };

boot();
</script>
</body></html>
