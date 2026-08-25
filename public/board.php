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
    <button data-view="poule" class="on">Poule Stages</button>
    <button data-view="ko">Knockout</button>
    <button data-view="tables">Per Table</button>
    <label class="clock" style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" id="autocycle" style="width:auto" checked> auto-cycle</label>
    <button id="minTop" class="menu-btn" style="margin-left:auto">Minimise</button>
  </div>

  <div id="grid" class="board-grid"></div>
</div>
<div class="updated" id="updated"></div>

<script>
const $ = s => document.querySelector(s);
const pouleColors = ['var(--red)','var(--blue)','var(--green)','var(--gold-2)'];
let VIEW='poule', STATE=null, SCHED=null, cycleTimer=null;
const VIEWS=['poule','ko','tables'];

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
  if(VIEW==='ko') SCHED=await api('schedule');
  render();
}

function setView(v){ VIEW=v; document.querySelectorAll('.viewnav [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v)); tick(); }
document.querySelectorAll('.viewnav [data-view]').forEach(b=>b.onclick=()=>{ stopCycle(); $('#autocycle').checked=false; setView(b.dataset.view); });

function render(){
  const g=$('#grid');
  const P = (STATE.poules&&STATE.poules.length) ? STATE.poules.length : 2;
  if(VIEW==='poule'){
    // Few poules → one row; many poules → ~3 rows (wider cards, fills the screen).
    const cols = P<=4 ? P : Math.ceil(P/3);
    g.className='board-grid'; g.style.setProperty('--cols',cols); g.innerHTML=renderRank(cols);
  } else if(VIEW==='ko'){
    g.className='ko-wrap'; g.innerHTML=renderKnockout();
  } else {
    g.className='board-grid'; const cols=STATE.event.is_knockout?1:Math.min(P,6); g.style.setProperty('--cols',cols); g.innerHTML=renderTables();
  }
  g.classList.remove('fade'); void g.offsetWidth; g.classList.add('fade');
}

/* ---- poule stages (ranking) ---- */
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
// Board leaderboard: name + points are the priority, so only #, Team, 20's, Pts.
function standTable(rows,start,compact){
  start=start||0;
  if(!rows.length) return '';
  let h='<table class="stand'+(compact?' compact':'')+'"><thead><tr><th></th><th class="l">Team</th><th>20s</th><th>Pts</th></tr></thead><tbody>';
  rows.forEach((r,i)=>{ const players=[r.player1,r.player2].filter(Boolean).map(esc).join(' · ');
    h+='<tr class="'+(start+i===0?'top1':'')+'"><td class="rank">'+(start+i+1)+'</td>'
      +'<td class="l"><span class="team">'+esc(r.name)+'</span>'+(!compact&&players?'<div class="players">'+players+'</div>':'')+'</td>'
      +'<td class="mono tw">'+r.twenties+'</td><td class="pts">'+r.points+'</td></tr>'; });
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

/* ---- knockout: World Cup-style bracket tree, teams on both sides, final in the centre ---- */
function renderKnockout(){
  if(!SCHED||!SCHED.ok) return '<div class="card center muted">Loading…</div>';
  const nR=SCHED.event.num_rounds;
  const koNums=Object.keys(SCHED.rounds).map(Number).filter(r=>r>nR).sort((a,b)=>a-b);
  if(!koNums.length) return '<div class="card center muted" style="grid-column:1/-1">The finals bracket hasn’t been drawn yet.</div>';
  const finalRound=koNums[koNums.length-1];
  const byT=r=>(SCHED.rounds[r]||[]).slice().sort((a,b)=>a.table_no-b.table_no);
  const winnersOf=r=>byT(r).filter(m=>m.bracket!=='Bronze final');
  const feeders=koNums.slice(0,-1);            // R16, QF, SF (ascending)
  const rounds=feeders.map(winnersOf);          // rounds[0]=R16 … last=SF
  const finalArr=byT(finalRound);
  const finalM=finalArr.find(m=>m.bracket!=='Bronze final')||finalArr[0];
  const bronzeM=finalArr.find(m=>m.bracket==='Bronze final');
  const top=rounds.length-1;
  function node(level,idx){
    const m=rounds[level][idx]; if(!m) return '';
    let kids=''; if(level>0) kids='<div class="tkids">'+node(level-1,idx*2)+node(level-1,idx*2+1)+'</div>';
    return '<div class="tnode'+(level>0?' haskids':'')+'">'+bmCard(m)+kids+'</div>';
  }
  let left='', right='';
  if(top>=0 && rounds[top] && rounds[top].length>=2){ left=node(top,0); right=node(top,1); }
  else if(rounds[0]){ const r=rounds[0], h=Math.ceil(r.length/2);
    left=r.slice(0,h).map(m=>'<div class="tnode">'+bmCard(m)+'</div>').join('');
    right=r.slice(h).map(m=>'<div class="tnode">'+bmCard(m)+'</div>').join(''); }
  let champ=''; if(finalM && finalM.win){ const w=finalM.win==='a'?finalM.a:finalM.b;
    champ='<div class="champ"><div class="lab">CHAMPION</div><div class="who">'+esc(w)+'</div></div>'; }
  let center='<div class="center"><div class="clabel">Final</div><div class="tnode final"><div class="bm big">'+bmInner(finalM)+'</div></div>'+champ;
  if(bronzeM) center+='<div class="clabel" style="margin-top:clamp(10px,1.6vw,26px)">Bronze final</div><div class="tnode"><div class="bm">'+bmInner(bronzeM)+'</div></div>';
  center+='</div>';
  return '<div class="bracket2"><div class="half left">'+left+'</div>'+center+'<div class="half right">'+right+'</div></div>';
}
function bmCard(m){ return '<div class="bm">'+bmInner(m)+'</div>'; }
function bmInner(m){
  if(!m) return '';
  const sa=m.sets_a==null?'':m.sets_a, sb=m.sets_b==null?'':m.sets_b;
  const so=(m.sets_a!=null && m.sets_a===m.sets_b && m.shootout_winner)?'<span class="so">SO</span>':'';
  return '<div class="bmt'+(m.win==='a'?' win':'')+'"><span class="dot" style="background:var(--red)"></span><b>'+esc(m.a||'—')+'</b>'+(m.win==='a'?so:'')+'<span class="sc">'+sa+'</span></div>'
    +'<div class="bmt'+(m.win==='b'?' win':'')+'"><span class="dot" style="background:var(--blue)"></span><b>'+(m.b?esc(m.b):'—')+'</b>'+(m.win==='b'?so:'')+'<span class="sc">'+sb+'</span></div>';
}

/* ---- auto-cycle ---- */
function startCycle(){ stopCycle(); cycleTimer=setInterval(()=>{ const i=VIEWS.indexOf(VIEW); setView(VIEWS[(i+1)%VIEWS.length]); }, 18000); }
function stopCycle(){ if(cycleTimer){clearInterval(cycleTimer);cycleTimer=null;} }
$('#autocycle').onchange=e=>{ if(e.target.checked){ startCycle(); } else stopCycle(); };

// collapsible header to free up screen space
const boardEl=document.querySelector('.wrap.board');
function applyMin(on){ boardEl.classList.toggle('min',on); $('#minTop').textContent=on?'Expand':'Minimise'; localStorage.setItem('crok_board_min',on?'1':''); }
$('#minTop').onclick=()=>applyMin(!boardEl.classList.contains('min'));
applyMin(localStorage.getItem('crok_board_min')==='1');

setView('poule'); if($('#autocycle').checked) startCycle();
setInterval(tick, 2500);
</script>
</body></html>
