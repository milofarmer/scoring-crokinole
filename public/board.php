<?php define('CROK', 1); require __DIR__ . '/../src/brand.php'; ?>
<!doctype html><html lang="en"><head><?php crok_head('Crokinole — Big board', true); ?></head>
<body>
<div class="wrap board">
  <?= crok_nav('board.php') ?>
  <div class="topbar">
    <?= crok_mark(64) ?>
    <div class="titles"><div class="eyebrow" id="eyebrow">Big board</div><h1 id="evName">Crokinole</h1></div>
    <div class="spacer"></div>
    <div class="roundchip" id="roundChip">—</div>
    <span class="clock" id="clock"></span>
  </div>

  <div class="viewnav">
    <button data-view="rank" class="on">Ranking</button>
    <button data-view="tables">Per tafel</button>
    <button data-view="schema">Per schema</button>
    <label class="clock" style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" id="autocycle" style="width:auto" checked> auto-cycle</label>
    <div class="rounds" id="roundBtns"></div>
  </div>

  <div id="grid" class="board-grid"></div>
</div>
<div class="updated" id="updated"></div>

<script>
const $ = s => document.querySelector(s);
const pouleColors = ['var(--red)','var(--blue)','var(--green)','var(--gold-2)'];
let VIEW='rank', schemaRound=null, STATE=null, SCHED=null, cycleTimer=null;
const VIEWS=['rank','tables','schema'];

async function api(a, extra){ const q = extra? ('&'+extra):''; const r=await fetch('api.php?action='+a+q); return r.json(); }
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function pName(p){ return p.name?('Poule '+esc(p.name)):'Standings'; }

async function tick(){
  const clock=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('#clock').textContent=clock; $('#updated').textContent='updated '+clock;
  STATE=await api('state');
  if(!STATE.ok||!STATE.event){ $('#grid').innerHTML='<div class="card center muted" style="grid-column:1/-1">Waiting for the tournament to start…</div>'; return; }
  $('#evName').textContent=STATE.event.name||'Crokinole';
  $('#roundChip').textContent = STATE.event.is_knockout ? STATE.event.round_label : ('Round '+STATE.event.current_round+' / '+STATE.event.num_rounds);
  if(VIEW==='schema'){ SCHED=await api('schedule'); if(schemaRound===null) schemaRound=STATE.event.current_round; buildRoundBtns(); }
  render();
}

function setView(v){ VIEW=v; document.querySelectorAll('.viewnav [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  $('#roundBtns').style.display = v==='schema'?'flex':'none'; tick(); }
document.querySelectorAll('.viewnav [data-view]').forEach(b=>b.onclick=()=>{ stopCycle(); $('#autocycle').checked=false; setView(b.dataset.view); });

function koLabel(matches){ const n=matches.length; return {1:'Final',2:'SF',4:'QF',8:'R16',16:'R32'}[n]||('R'+(n*2)); }
function buildRoundBtns(){
  const n=SCHED.event.num_rounds;
  const rk=Object.keys(SCHED.rounds).map(Number).sort((a,b)=>a-b);
  let h='';
  rk.forEach(i=>{ const lab = i<=n ? ('R'+i) : koLabel(SCHED.rounds[i]);
    h+='<button data-r="'+i+'" class="'+(i===schemaRound?'on':'')+'">'+lab+'</button>'; });
  const el=$('#roundBtns'); el.innerHTML=h; el.style.display='flex';
  el.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{ schemaRound=+b.dataset.r; stopCycle(); $('#autocycle').checked=false; render(); buildRoundBtns(); });
}

function render(){
  const g=$('#grid');
  g.className='board-grid';
  const P = (STATE.poules&&STATE.poules.length) ? STATE.poules.length : 2;
  let cols = Math.min(P, 6);
  if(VIEW==='schema' && SCHED && schemaRound>SCHED.event.num_rounds) cols=1; // KO round = one wide card
  if(VIEW==='tables' && STATE.event.is_knockout) cols=1;
  g.style.setProperty('--cols', cols);
  if(VIEW==='rank') g.innerHTML = renderRank(cols);
  else if(VIEW==='tables') g.innerHTML = renderTables();
  else g.innerHTML = renderSchema();
  g.classList.remove('fade'); void g.offsetWidth; g.classList.add('fade');
}

/* ---- ranking ---- */
function renderRank(cols){
  const narrow = cols>=3; // narrow columns → compact single-line rows
  const poules = STATE.poules.length?STATE.poules:[{id:0,name:''}];
  let html='';
  poules.forEach((p,i)=>{
    const rows=STATE.standings[p.id]||[]; const color=pouleColors[i%pouleColors.length];
    html+='<div class="card"><h2><span class="dot" style="background:'+color+'"></span>'+pName(p)+'</h2>'+standSplit(rows,narrow)+'</div>';
  });
  return html||'<div class="card center muted">No teams yet.</div>';
}
// Split a long ranking into two side-by-side columns so every team stays on screen.
function standSplit(rows,narrow){
  if(!rows.length) return '<p class="muted center">No teams yet.</p>';
  if(rows.length<=12) return standTable(rows,0,!!narrow);
  const half=Math.ceil(rows.length/2);
  // compact (no player sub-line) so all teams fit on one screen
  return '<div class="standwrap">'+standTable(rows.slice(0,half),0,true)+standTable(rows.slice(half),half,true)+'</div>';
}
function standTable(rows,start,compact){
  start=start||0;
  if(!rows.length) return '';
  let h='<table class="stand'+(compact?' compact':'')+'"><thead><tr><th></th><th class="l">Team</th><th>Pl</th><th>W</th><th>T</th><th>L</th><th>20s</th><th>Pts</th></tr></thead><tbody>';
  rows.forEach((r,i)=>{ const players=[r.player1,r.player2].filter(Boolean).map(esc).join(' · ');
    h+='<tr class="'+(start+i===0?'top1':'')+'"><td class="rank">'+(start+i+1)+'</td>'
      +'<td class="l"><div class="teamline"><span class="team">'+esc(r.name)+'</span>'+(!compact&&players?'<div class="players">'+players+'</div>':'')+'</div></td>'
      +'<td>'+r.played+'</td><td>'+r.wins+'</td><td>'+r.ties+'</td><td>'+r.losses+'</td>'
      +'<td class="mono">'+r.twenties+'</td><td class="pts">'+r.points+'</td></tr>'; });
  return h+'</tbody></table>';
}

/* ---- per table (current round) ---- */
function renderTables(){
  if(STATE.event.is_knockout){
    const ms=(STATE.round_matches||[]).slice().sort((a,b)=>a.table_no-b.table_no);
    let html='<div class="card"><h2><span class="dot" style="background:var(--gold-2)"></span>Knockout · '+esc(STATE.event.round_label)+'</h2><div class="tablegrid">';
    ms.forEach(m=>html+=tcard(m)); return html+'</div></div>';
  }
  const byP={}; (STATE.round_matches||[]).forEach(m=>{(byP[m.poule_id]=byP[m.poule_id]||[]).push(m);});
  const poules = STATE.poules.length?STATE.poules:[{id:0,name:''}];
  let html='';
  poules.forEach((p,i)=>{
    const ms=(byP[p.id]||[]).sort((a,b)=>a.table_no-b.table_no);
    html+='<div class="card"><h2><span class="dot" style="background:'+pouleColors[i%pouleColors.length]+'"></span>'+pName(p)+' · Round '+STATE.event.current_round+'</h2><div class="tablegrid">';
    ms.forEach(m=>html+=tcard(m));
    html+='</div></div>';
  });
  return html||'<div class="card center muted">No matches drawn for this round.</div>';
}
function tcard(m){
  const a=m.team_a?esc(m.team_a.name):'—', b=m.team_b?esc(m.team_b.name):'bye';
  const sa=m.points_a==null?'':m.points_a, sb=m.points_b==null?'':m.points_b;
  const aWin=m.scored&&m.points_a>m.points_b, bWin=m.scored&&m.points_b>m.points_a;
  let st,cls; if(!m.team_b){st='bye';cls='pending';} else if(m.scored){st='final';cls='done';}
    else if(m.status==='progress'){st='playing…';cls='progress';} else {st='to play';cls='pending';}
  return '<div class="tcard'+(m.status==='progress'?' live':'')+'">'
    +'<div class="tnum">TABLE '+m.table_no+(m.match_code?' <span class="mcode">#'+m.match_code+'</span>':'')+'</div>'
    +'<div class="side'+(aWin?' win':'')+'"><span class="nm"><span class="dot" style="background:var(--red)"></span><b>'+a+'</b></span><span class="sc">'+sa+'</span></div>'
    +'<div class="side'+(bWin?' win':'')+'"><span class="nm"><span class="dot" style="background:var(--blue)"></span><b>'+b+'</b></span><span class="sc">'+sb+'</span></div>'
    +'<div class="st '+cls+'">'+st+'</div></div>';
}

/* ---- per schema (a chosen round) ---- */
function schemaCard(m){
  const aWin=m.scored&&(m.sets_a>m.sets_b||(m.sets_a===m.sets_b&&m.shootout_winner&&false)), bWin=m.scored&&m.sets_b>m.sets_a;
  const sa=m.sets_a==null?'':m.sets_a, sb=m.sets_b==null?'':m.sets_b;
  const so = m.sets_a===m.sets_b && m.shootout_winner ? ' <span class="mono" style="color:var(--gold-2)">(SO)</span>' : '';
  return '<div class="tcard'+(m.status==='progress'?' live':'')+'"><div class="tnum">TABLE '+m.table_no+(m.match_code?' <span class="mcode">#'+m.match_code+'</span>':'')+so+'</div>'
    +'<div class="side'+(aWin?' win':'')+'"><span class="nm"><span class="dot" style="background:var(--red)"></span><b>'+esc(m.a)+'</b></span><span class="sc">'+sa+'</span></div>'
    +'<div class="side'+(bWin?' win':'')+'"><span class="nm"><span class="dot" style="background:var(--blue)"></span><b>'+(m.b?esc(m.b):'bye')+'</b></span><span class="sc">'+sb+'</span></div></div>';
}
function renderSchema(){
  if(!SCHED||!SCHED.ok) return '<div class="card center muted">Loading…</div>';
  const ms=(SCHED.rounds[schemaRound]||[]);
  const isKo = schemaRound>SCHED.event.num_rounds;
  if(isKo){
    const label=(ms[0]&&ms[0].bracket)||koLabel(ms);
    let html='<div class="card"><h2><span class="dot" style="background:var(--gold-2)"></span>Knockout · '+esc(label)+'</h2><div class="tablegrid">';
    ms.slice().sort((a,b)=>a.table_no-b.table_no).forEach(m=>html+=schemaCard(m));
    return html+'</div></div>';
  }
  const byP={}; ms.forEach(m=>{(byP[m.poule_id]=byP[m.poule_id]||[]).push(m);});
  const poules = SCHED.poules.length?SCHED.poules:[{id:0,name:''}];
  let html='';
  poules.forEach((p,i)=>{
    const rows=(byP[p.id]||[]).sort((a,b)=>a.table_no-b.table_no);
    html+='<div class="card"><h2><span class="dot" style="background:'+pouleColors[i%pouleColors.length]+'"></span>'+pName(p)+' · Round '+schemaRound+'</h2><div class="tablegrid">';
    rows.forEach(m=>html+=schemaCard(m));
    html+='</div></div>';
  });
  return html||'<div class="card center muted">No matches for this round.</div>';
}

/* ---- auto-cycle ---- */
function startCycle(){ stopCycle(); cycleTimer=setInterval(()=>{ const i=VIEWS.indexOf(VIEW); setView(VIEWS[(i+1)%VIEWS.length]); }, 18000); }
function stopCycle(){ if(cycleTimer){clearInterval(cycleTimer);cycleTimer=null;} }
$('#autocycle').onchange=e=>{ if(e.target.checked){ startCycle(); } else stopCycle(); };

setView('rank'); if($('#autocycle').checked) startCycle();
setInterval(tick, 2500);
</script>
</body></html>
