<?php define('CROK', 1); require __DIR__ . '/../src/brand.php'; ?>
<!doctype html><html lang="en"><head><?php crok_head('Crokinole — Score entry'); ?></head>
<body>
<div class="wrap" style="max-width:520px">
  <?= crok_nav('index.php') ?>
  <div class="topbar">
    <?= crok_mark(40) ?>
    <div class="titles"><div class="eyebrow" id="eyebrow">Score entry</div><h1 id="evName">Crokinole</h1></div>
    <div class="spacer"></div>
    <div class="roundchip" id="roundChip">—</div>
  </div>

  <div id="noEvent" class="card hidden center">
    <h2>No tournament running</h2>
    <p class="muted">Ask the organizer to open the event, then reload.</p>
  </div>

  <!-- 1. login: team account OR single match code -->
  <div id="login" class="card hidden">
    <div class="row" style="gap:8px;margin-bottom:14px">
      <button class="menu-btn on" id="modeTeam" style="flex:1">My team</button>
      <button class="menu-btn" id="modeMatch" style="flex:1">Match code</button>
    </div>
    <h2 id="loginTitle">Team login</h2>
    <p class="muted" id="loginHint" style="font-size:14px;margin-top:-4px">Sign in with your team code to see all your matches.</p>
    <label class="field"><span class="lab" id="loginLab">Team code</span>
      <input id="code" autocomplete="off" autocapitalize="characters" placeholder="e.g. 7QK4"
             style="font-family:var(--mono);font-size:22px;text-align:center;letter-spacing:.3em;text-transform:uppercase"></label>
    <button class="btn wide" id="loginBtn">Sign in</button>
    <p id="loginErr" class="center" style="color:var(--red);font-size:14px"></p>
  </div>

  <!-- 2. your match -->
  <div id="play" class="hidden">
    <div class="card matchcard" id="matchCard">
      <div id="tableBadge" class="tablebadge"><span class="lab">TABLE</span> <span id="tableNo">—</span></div>
      <div id="pouleLine" class="muted mono" style="font-size:12px;margin-top:8px"></div>

      <div class="teams2">
        <div class="tm a"><span class="dot"></span><span id="nameA">Team A</span><span id="youA" class="you-tag hidden">YOU</span></div>
        <div class="tm b"><span class="dot"></span><span id="nameB">Team B</span><span id="youB" class="you-tag hidden">YOU</span></div>
      </div>

      <!-- One set at a time: four sets side by side is unreadable on a phone and
           invites entering a score against the wrong set. -->
      <div class="setsteps" id="setSteps"></div>
      <div class="setcard" id="setCard"></div>
      <div class="setmove">
        <button class="menu-btn" id="prevSet">Back</button>
        <div class="matchscore mono" id="matchScore">0 – 0</div>
        <button class="menu-btn" id="nextSet">Next set</button>
      </div>

      <div id="banner" class="result-banner tie">Enter the points per set</div>
      <div id="shootout" class="hidden" style="margin-top:10px">
        <div class="t2lab" style="text-align:center;margin-bottom:8px">Level after 4 sets · shoot-out, then sudden death</div>
        <div id="soGrid" class="sogrid"></div>
        <div id="soResult" class="mono center" style="font-size:13px;margin-top:8px;color:var(--muted);height:16px"></div>
      </div>
      <button class="btn wide" id="confirmBtn" style="margin-top:12px" disabled>Confirm result</button>
      <div id="saveState" class="mono muted center" style="font-size:12px;height:16px;margin-top:6px"></div>
    </div>

    <div id="byeCard" class="card center hidden">
      <h2>Bye this round</h2><p class="muted">Your team sits out this round — it counts as a win.</p>
    </div>
    <div id="waitCard" class="card center hidden">
      <h2>No match yet</h2><p class="muted" id="waitMsg">The draw for this round isn’t up yet. Hang tight.</p>
    </div>

    <p class="center" style="font-size:13px"><button class="menu-btn" id="logoutBtn">Sign out</button></p>
  </div>

  <div id="tablesView" class="hidden"><div id="tables"></div></div>
  <div id="standView" class="hidden"><div id="stand"></div></div>

  <nav class="row" style="margin-top:8px">
    <button class="menu-btn" data-nav="play" style="flex:1">My match</button>
    <button class="menu-btn" data-nav="tablesView" style="flex:1">All tables</button>
    <button class="menu-btn" data-nav="standView" style="flex:1">Ranking</button>
  </nav>
</div>

<script>
const $ = s => document.querySelector(s);
let STATE=null, team=null, myMatch=null, poll=null, dirty=false, saveTimer=null;
let sets=[], soShots=[null,null,null], renderedMatchId=null, currentSet=0;
let mode='team', matchCode='';
const ls={get:k=>localStorage.getItem('crok_'+k)||'',set:(k,v)=>localStorage.setItem('crok_'+k,v),del:k=>localStorage.removeItem('crok_'+k)};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(m,e){const t=document.createElement('div');t.className='toast'+(e?' err':'');t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2000);}
async function api(action,data){const r=await fetch('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action},data||{}))});return r.json();}
function pouleName(id){const p=(STATE&&STATE.poules||[]).find(p=>p.id===id);return p?p.name:'';}

async function boot(){
  const s=await api('state');
  if(!s.ok||!s.event){showOnly('noEvent');return;}
  STATE=s;
  $('#evName').textContent=s.event.name||'Crokinole';
  $('#roundChip').textContent = s.event.is_knockout ? s.event.round_label : ('Round '+s.event.current_round+' / '+s.event.num_rounds);
  const savedMode=ls.get('mode')||'team';
  if(savedMode==='match' && ls.get('match_code')){
    matchCode=ls.get('match_code');
    const r=await api('match_login',{code:matchCode});
    if(r.ok){ mode='match'; team=null; myMatch=r.match; afterLogin(); return; }
    ls.del('match_code');
  }
  const code=ls.get('team_code');
  if(code){
    const r=await api('team_login',{code});
    if(r.ok){ mode='team'; team=r.team; afterLogin(); return; }
    ls.del('team_code'); ls.del('team_id');
  }
  setMode('team'); showOnly('login');
}

function setMode(m){
  mode=m;
  $('#modeTeam').classList.toggle('on', m==='team');
  $('#modeMatch').classList.toggle('on', m==='match');
  $('#loginTitle').textContent = m==='team' ? 'Team login' : 'Enter a match';
  $('#loginHint').textContent = m==='team'
    ? 'Sign in with your team code to see all your matches.'
    : 'Type the match code shown on the big screen to enter that result.';
  $('#loginLab').textContent = m==='team' ? 'Team code' : 'Match code';
  $('#loginBtn').textContent = m==='team' ? 'Sign in' : 'Open match';
  $('#code').placeholder = m==='team' ? 'e.g. 7QK4' : 'e.g. 4KQ9';
  $('#code').value=''; $('#loginErr').textContent='';
}
$('#modeTeam').onclick=()=>setMode('team');
$('#modeMatch').onclick=()=>setMode('match');

$('#loginBtn').onclick=async ()=>{
  const code=$('#code').value.trim().toUpperCase(); if(!code){$('#loginErr').textContent='Enter a code';return;}
  if(mode==='team'){
    const r=await api('team_login',{code});
    if(!r.ok){$('#loginErr').textContent=r.error||'Unknown code';return;}
    ls.set('mode','team'); ls.set('team_code',code); ls.set('team_id',r.team.id); ls.del('match_code');
    team=r.team; $('#loginErr').textContent=''; afterLogin();
  } else {
    const r=await api('match_login',{code});
    if(!r.ok){$('#loginErr').textContent=r.error||'Unknown match code';return;}
    ls.set('mode','match'); ls.set('match_code',code); ls.del('team_code'); ls.del('team_id');
    matchCode=code; team=null; myMatch=r.match; $('#loginErr').textContent=''; afterLogin();
  }
};
$('#code').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
$('#logoutBtn').onclick=()=>{ls.del('team_code');ls.del('team_id');ls.del('match_code');team=null;matchCode='';setMode('team');showOnly('login');};

function afterLogin(){
  renderedMatchId=null; dirty=false;
  $('#eyebrow').textContent = mode==='match' ? ('Match '+matchCode) : team.name;
  $('#logoutBtn').textContent = mode==='match' ? 'Exit match' : 'Sign out';
  load(); go('play'); startPoll();
}

async function load(){
  const s=await api('state'); if(!s.ok||!s.event){showOnly('noEvent');return;}
  STATE=s;
  if(mode==='match'){
    if(!dirty){ const r=await api('match_login',{code:matchCode}); if(r.ok) myMatch=r.match; }
    $('#roundChip').textContent = '#'+matchCode;
  } else {
    $('#roundChip').textContent = s.event.is_knockout ? s.event.round_label : ('Round '+s.event.current_round+' / '+s.event.num_rounds);
    myMatch=(s.round_matches||[]).find(m=>(m.team_a&&m.team_a.id===team.id)||(m.team_b&&m.team_b.id===team.id))||null;
  }
  if(!dirty) renderPlay();
  renderTables(); renderStand();
}

/* ---- per-set (tennis-style) scoring ---- */
function blankSets(){ return [0,1,2,3].map(()=>({pa:'',pb:'',ta:0,tb:0})); }
/* Open on the set still to be played, so picking a match up mid-way lands in
   the right place instead of back at set 1. */
function firstUnfinishedSet(){ const i=sets.findIndex(s=>!setFilled(s)); return i<0?3:i; }
function isKo(){ return myMatch && myMatch.phase==='ko'; }

function renderPlay(){
  if(!myMatch){ $('#matchCard').classList.add('hidden'); $('#byeCard').classList.add('hidden'); $('#waitCard').classList.remove('hidden'); return; }
  if(!myMatch.team_b){ $('#matchCard').classList.add('hidden'); $('#waitCard').classList.add('hidden'); $('#byeCard').classList.remove('hidden'); return; }
  $('#byeCard').classList.add('hidden'); $('#waitCard').classList.add('hidden'); $('#matchCard').classList.remove('hidden');

  const A=myMatch.team_a, B=myMatch.team_b;
  $('#tableNo').textContent=myMatch.table_no;
  const rnd = myMatch.round || (STATE&&STATE.event.current_round);
  const ctx = myMatch.phase==='ko' ? (myMatch.bracket||'Knockout') : ((pouleName(myMatch.poule_id)?'Poule '+pouleName(myMatch.poule_id)+' · ':'')+'Round '+rnd);
  $('#pouleLine').textContent=ctx+(myMatch.match_code?' · #'+myMatch.match_code:'')+' · 4 sets';
  $('#nameA').textContent=A.name; $('#nameB').textContent=B.name;
  const myId = team ? team.id : null;
  $('#youA').classList.toggle('hidden', A.id!==myId); $('#youB').classList.toggle('hidden', B.id!==myId);

  // Rebuild the grid only when the match changes, so we never steal focus mid-entry.
  if(renderedMatchId!==myMatch.id || !$('#setCard').children.length){
    sets = (myMatch.sets&&myMatch.sets.length)
      ? [0,1,2,3].map(i=>{ const s=myMatch.sets[i]||{}; return {pa:s.pa==null?'':s.pa, pb:s.pb==null?'':s.pb, ta:s.ta||0, tb:s.tb||0}; })
      : blankSets();
    const sw0 = myMatch.shootout_winner||null;
    soShots = sw0 ? [ sw0===myMatch.team_a.id?'a':'b', sw0===myMatch.team_a.id?'a':'b', null ] : [null,null,null];
    currentSet = firstUnfinishedSet();
    buildSetCard(); buildShootout();
    renderedMatchId=myMatch.id;
  }
  refreshDerived();
}

/* Which side took a set, or null while it is level or unfinished. */
function setWinner(s){
  if(s.pa===''||s.pa==null||s.pb===''||s.pb==null) return null;
  if(+s.pa > +s.pb) return 'a';
  if(+s.pb > +s.pa) return 'b';
  return null;
}
function setFilled(s){ return s.pa!==''&&s.pa!=null&&s.pb!==''&&s.pb!=null; }

/* Match points, not points scored: every finished set pays 2 to its winner, or
   1 each when level. Four sets, eight points. */
function totals(){
  let pa=0,pb=0,filled=0;
  sets.forEach(s=>{
    if(!setFilled(s)) return;
    filled++;
    const w=setWinner(s);
    if(w==='a') pa+=2; else if(w==='b') pb+=2; else { pa++; pb++; }
  });
  return {pa,pb,filled};
}

/* ---- one set at a time ---- */

function buildSteps(){
  let h='';
  for(let i=0;i<4;i++){
    const s=sets[i], w=setWinner(s), done=setFilled(s);
    h+='<button class="step'+(i===currentSet?' on':'')+(done?' done':'')+'" data-i="'+i+'">'
      +'<span class="n">Set '+(i+1)+'</span>'
      +'<span class="sc">'+(done?(s.pa+'–'+s.pb):'–')+'</span>'
      +'<span class="who'+(w?' '+w:'')+'"></span></button>';
  }
  const el=$('#setSteps'); el.innerHTML=h;
  el.querySelectorAll('.step').forEach(b=>b.onclick=()=>goSet(+b.dataset.i));
}

function buildSetCard(){
  const A=myMatch.team_a, B=myMatch.team_b, s=sets[currentSet];
  $('#setCard').innerHTML =
      '<div class="setttl mono">SET '+(currentSet+1)+' OF 4</div>'
    + srow('a', A.name, s.pa, s.ta)
    + srow('b', B.name, s.pb, s.tb)
    + '<div class="setout" id="setOut"></div>';

  $('#setCard').querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{
    const side=inp.dataset.side, k=inp.dataset.k;
    const v = inp.value===''?'':Math.max(0,parseInt(inp.value,10)||0);
    const cur=sets[currentSet];
    if(k==='p') cur[side==='a'?'pa':'pb']=v; else cur[side==='a'?'ta':'tb']=(v===''?0:v);
    refreshDerived(); scheduleSave();
  }));
}

function srow(side,name,pv,tv){
  return '<div class="serow '+side+'">'
    + '<div class="who"><span class="dot"></span><span class="nm">'+esc(name)+'</span></div>'
    + '<label class="fld"><span>Points</span>'
      + '<input class="pt" inputmode="numeric" data-side="'+side+'" data-k="p" value="'+(pv===''||pv==null?'':pv)+'" placeholder="–"></label>'
    + '<label class="fld tw"><span>20’s</span>'
      + '<input inputmode="numeric" data-side="'+side+'" data-k="t" value="'+(tv?tv:'')+'" placeholder="0"></label>'
    + '</div>';
}

/* Everything that follows from the numbers, without touching the inputs
   themselves — rebuilding those mid-entry would steal the keyboard. */
function refreshDerived(){
  const s=sets[currentSet], w=setWinner(s), A=myMatch.team_a, B=myMatch.team_b;
  const out=$('#setOut');
  if(out){
    if(!setFilled(s)) out.className='setout', out.textContent='Enter both scores for this set';
    else if(w) out.className='setout win', out.textContent=esc(w==='a'?A.name:B.name)+' win set '+(currentSet+1)+' · 2–0';
    else out.className='setout tie', out.textContent='Set '+(currentSet+1)+' is level · 1–1';
  }
  buildSteps();
  updateBanner();
}

function goSet(i){
  currentSet=Math.max(0,Math.min(3,i));
  buildSetCard(); refreshDerived();
  const first=$('#setCard input'); if(first) first.focus();
}
$('#prevSet').onclick=()=>goSet(currentSet-1);
$('#nextSet').onclick=()=>goSet(currentSet+1);
function updateBanner(){
  const {pa,pb,filled}=totals(); const A=myMatch.team_a, B=myMatch.team_b;
  const ms=$('#matchScore');
  if(ms){ ms.textContent=pa+' – '+pb;
    ms.classList.toggle('a', filled===4&&pa>pb); ms.classList.toggle('b', filled===4&&pb>pa); }
  const prev=$('#prevSet'), next=$('#nextSet');
  if(prev) prev.disabled = currentSet===0;
  if(next) next.disabled = currentSet===3;
  const needSO = isKo() && filled===4 && pa===pb;
  $('#shootout').classList.toggle('hidden', !needSO);
  const sw = soWinner();
  if(needSO && $('#soResult')){ $('#soResult').textContent = sw.id
    ? ((sw.id===A.id?esc(A.name):esc(B.name))+' win the shoot-out '+Math.max(sw.a,sw.b)+'–'+Math.min(sw.a,sw.b))
    : 'Best of 3 — tap the winner of each shot'; }
  const bn=$('#banner'); const sc=pa+'–'+pb;
  if(filled===0){ bn.className='result-banner tie'; bn.textContent='Enter the points per set'; }
  else if(filled<4){ const left='  ·  '+(4-filled)+' set'+(4-filled>1?'s':'')+' left';
    if(pa>pb){bn.className='result-banner win'; bn.textContent=esc(A.name)+' lead '+sc+left;}
    else if(pb>pa){bn.className='result-banner win'; bn.textContent=esc(B.name)+' lead '+sc+left;}
    else{bn.className='result-banner tie'; bn.textContent='Level '+sc+left;} }
  else { if(pa>pb){bn.className='result-banner win'; bn.textContent=esc(A.name)+' win '+sc;}
    else if(pb>pa){bn.className='result-banner win'; bn.textContent=esc(B.name)+' win '+sc;}
    else if(needSO&&sw.id){bn.className='result-banner win'; bn.textContent=esc(sw.id===A.id?A.name:B.name)+' win '+sc+' (shoot-out)';}
    else if(needSO){bn.className='result-banner tie'; bn.textContent='Equal '+sc+' — shoot-out (best of 3)';}
    else{bn.className='result-banner tie'; bn.textContent='Draw '+sc;} }
  const canConfirm = filled===4 && (!needSO || !!sw.id);
  $('#confirmBtn').disabled = !canConfirm;
  $('#confirmBtn').textContent = myMatch.status==='entered' ? 'Update result' : 'Confirm result';
}
function soWinner(){ let a=0,b=0; soShots.forEach(s=>{ if(s==='a')a++; else if(s==='b')b++; });
  return { id: a>=2?myMatch.team_a.id : (b>=2?myMatch.team_b.id : null), a, b }; }
function buildShootout(){
  if(!myMatch || !myMatch.team_b) return;
  const A=myMatch.team_a.name, B=myMatch.team_b.name;
  let h='<div class="sohead"><span></span><span>'+esc(A)+'</span><span>'+esc(B)+'</span></div>';
  for(let i=0;i<3;i++) h+='<div class="sn">Shot '+(i+1)+'</div>'+soCell(i,'a')+soCell(i,'b');
  const g=$('#soGrid'); g.innerHTML=h;
  g.querySelectorAll('.socell').forEach(c=>c.onclick=()=>{
    const i=+c.dataset.i; soShots[i]=(soShots[i]===c.dataset.v?null:c.dataset.v);
    buildShootout(); updateBanner(); scheduleSave();
  });
}
function soCell(i,v){ const sel=soShots[i]===v?(' sel-'+v):''; return '<div class="socell'+sel+'" data-i="'+i+'" data-v="'+v+'">'+(soShots[i]===v?'✓':'')+'</div>'; }
$('#confirmBtn').onclick=()=>save(true);

function scheduleSave(){ dirty=true; $('#saveState').textContent='Saving…'; clearTimeout(saveTimer); saveTimer=setTimeout(()=>save(false),700); }
async function save(complete){
  if(!myMatch) return;
  const {pa,pb,filled}=totals();
  const needSO = isKo() && filled===4 && pa===pb;
  const so = needSO ? soWinner().id : null;
  const isFinal = !!complete && filled===4 && (!needSO || !!so);
  const payload = sets.map(s=>({pa:s.pa===''?'':+s.pa, pb:s.pb===''?'':+s.pb, ta:+s.ta||0, tb:+s.tb||0}));
  const authCode = mode==='match' ? matchCode : ls.get('team_code');
  const r=await api('submit_score',{ match_id:myMatch.id, code:authCode, sets:payload, shootout_winner:so, complete:isFinal, entered_by:team?team.name:'' });
  if(!r.ok){ $('#saveState').textContent=''; toast(r.error||'Save failed',true); return; }
  myMatch.status=r.status; myMatch.points_a=pa; myMatch.points_b=pb; myMatch.shootout_winner=so;
  myMatch.sets = payload.map(s=>({pa:s.pa===''?null:s.pa, pb:s.pb===''?null:s.pb, ta:s.ta, tb:s.tb}));
  dirty=false;
  $('#saveState').textContent = isFinal ? 'Confirmed ✓ · final'
    : (filled<4 ? 'Saved · '+(4-filled)+' set'+(4-filled>1?'s':'')+' left' : 'Saved · tap Confirm to finalise');
  updateBanner(); renderTables(); renderStand();
}

/* ---- secondary views ---- */
function renderTables(){
  const byP={}; (STATE.round_matches||[]).forEach(m=>{(byP[m.poule_id]=byP[m.poule_id]||[]).push(m);});
  let h='';
  Object.keys(byP).forEach(pid=>{
    h+='<div class="card"><h2>'+(pouleName(+pid)?'Poule '+esc(pouleName(+pid)):'Matches')+'</h2>';
    byP[pid].sort((a,b)=>a.table_no-b.table_no).forEach(m=>{
      const a=m.team_a?esc(m.team_a.name):'—', b=m.team_b?esc(m.team_b.name):'<span class="muted">bye</span>';
      const right=!m.team_b?'<span class="pill done">bye</span>':m.scored?('<span class="mono">'+m.points_a+'–'+m.points_b+'</span> <span class="pill done">✓</span>'):(m.status==='progress'?'<span class="pill wait">'+m.points_a+'–'+m.points_b+'…</span>':'<span class="pill wait">—</span>');
      const mine=team&&((m.team_a&&m.team_a.id===team.id)||(m.team_b&&m.team_b.id===team.id));
      h+='<div style="display:flex;gap:10px;align-items:center;padding:11px 4px;border-bottom:1px solid var(--line)'+(mine?';background:var(--gold-soft);border-radius:8px':'')+'">'
        +'<span class="mono muted" style="width:30px">T'+m.table_no+'</span>'
        +'<span style="flex:1"><span class="team">'+a+'</span> <span class="muted">vs</span> <span class="team">'+b+'</span></span>'
        +'<span style="white-space:nowrap">'+right+'</span></div>';
    });
    h+='</div>';
  });
  $('#tables').innerHTML=h||'<div class="card center muted">No matches drawn yet.</div>';
}
function renderStand(){
  let h='';
  (STATE.poules.length?STATE.poules:[{id:0,name:''}]).forEach(p=>{
    const rows=STATE.standings[p.id]||[];
    h+='<div class="card"><h2>'+(p.name?'Poule '+esc(p.name):'Ranking')+'</h2><table class="stand"><thead><tr><th></th><th class="l">Team</th><th>Pl</th><th>Pts</th><th>20s</th></tr></thead><tbody>';
    rows.forEach((r,i)=>{ const me=team&&r.team_id===team.id; h+='<tr class="'+(i===0?'top1':'')+'" '+(me?'style="background:var(--gold-soft)"':'')+'><td class="rank">'+(i+1)+'</td><td class="l team">'+esc(r.name)+'</td><td>'+r.played+'</td><td class="pts">'+r.points+'</td><td class="mono">'+r.twenties+'</td></tr>'; });
    h+='</tbody></table></div>';
  });
  $('#stand').innerHTML=h||'<div class="card center muted">No ranking yet.</div>';
}

const VIEWS=['noEvent','login','play','tablesView','standView'];
function showOnly(id){VIEWS.forEach(v=>$('#'+v).classList.toggle('hidden',v!==id));}
function currentView(){return VIEWS.find(v=>!$('#'+v).classList.contains('hidden'));}
function go(id){showOnly(id);}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ if(team||matchCode) go(b.dataset.nav); });

function startPoll(){stopPoll();poll=setInterval(()=>{if(!dirty)load();},4000);}
function stopPoll(){if(poll){clearInterval(poll);poll=null;}}

boot();
</script>
</body></html>
