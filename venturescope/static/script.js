'use strict';

/* ═══════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, pts;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  function mkPt() {
    return { x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.3, r:Math.random()*1.5+0.5, a:Math.random() };
  }
  pts = Array.from({length:80}, mkPt);
  function draw() {
    ctx.clearRect(0,0,W,H);
    pts.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>W) p.vx*=-1;
      if(p.y<0||p.y>H) p.vy*=-1;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(124,92,252,${p.a*0.6})`; ctx.fill();
    });
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++) {
      const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
      if(d<120){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
        ctx.strokeStyle=`rgba(124,92,252,${0.08*(1-d/120)})`; ctx.lineWidth=0.5; ctx.stroke(); }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ═══════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════ */
function show(hideId, showId) {
  const h = document.getElementById(hideId);
  const s = document.getElementById(showId);
  if (h) { h.classList.remove('visible'); h.style.display = 'none'; }
  if (s) { s.style.display = 'flex'; requestAnimationFrame(() => s.classList.add('visible')); }
  window.scrollTo({top:0, behavior:'instant'});
}

/* ═══════════════════════════════════════
   TOAST
   ═══════════════════════════════════════ */
let toastTimer;
function showToast(msg, duration=3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ═══════════════════════════════════════
   AUTH
   ═══════════════════════════════════════ */
async function doLogin() {
  const u   = document.getElementById('username').value.trim();
  const p   = document.getElementById('password').value;
  const err = document.getElementById('login-error');
  const etxt= document.getElementById('login-error-text');
  const btn = document.getElementById('login-btn');

  if (!u || !p) {
    etxt.textContent = 'Please enter both username and password.';
    err.style.display = 'flex'; return;
  }

  btn.querySelector('span').textContent = 'Verifying...';
  btn.disabled = true;

  try {
    const res  = await fetch('/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p}) });
    const data = await res.json();
    if (data.success) {
      err.style.display = 'none';
      // fetch username for display
      document.querySelectorAll('#header-user').forEach(el => el.textContent = data.username || u);
      show('login-screen', 'input-screen');
      loadHistory(); // preload in background
    } else {
      etxt.textContent = data.error || 'Invalid credentials.';
      err.style.display = 'flex';
      shakeCard();
    }
  } catch {
    etxt.textContent = 'Network error. Please try again.';
    err.style.display = 'flex';
  } finally {
    btn.querySelector('span').textContent = 'Access Platform';
    btn.disabled = false;
  }
}

async function doLogout() {
  await fetch('/logout', {method:'POST'}).catch(()=>{});
  ['funding','team','revenue','burn','growth'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  historyData = [];
  show('output-screen', 'login-screen');
  show('input-screen',  'login-screen');
}

function shakeCard() {
  const card = document.querySelector('.login-card');
  let start = null;
  function step(ts) {
    if(!start) start = ts;
    const t = (ts - start)/1000;
    if(t < 0.4) { card.style.transform = `translateX(${Math.sin(t*60)*6*(1-t/0.4)}px)`; requestAnimationFrame(step); }
    else card.style.transform = '';
  }
  requestAnimationFrame(step);
}

document.getElementById('password').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('username').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('password').focus(); });

/* ═══════════════════════════════════════
   SLIDER
   ═══════════════════════════════════════ */
function syncGrowth(val) {
  document.getElementById('growth').value = val;
  updateSliderTrack(val);
}
function updateSliderTrack(val) {
  const slider = document.getElementById('growth-slider');
  if (!slider) return;
  const pct = ((val - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min))) * 100;
  slider.style.background = `linear-gradient(to right, var(--violet) 0%, var(--violet) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}
document.getElementById('growth')?.addEventListener('input', function() {
  const v = parseFloat(this.value)||0;
  const s = document.getElementById('growth-slider');
  if(s) { s.value = Math.min(Math.max(v,-20),100); updateSliderTrack(s.value); }
});
updateSliderTrack(15);

/* ═══════════════════════════════════════
   PREDICT
   ═══════════════════════════════════════ */
let lastResult = null;

async function predict() {
  const btn = document.getElementById('analyzeBtn');
  const bar = document.getElementById('loadingBar');
  const lt  = document.getElementById('loadingText');
  const err = document.getElementById('input-error');
  const etxt= document.getElementById('input-error-text');

  err.style.display = 'none';

  const fields = {
    funding:     parseFloat(document.getElementById('funding').value)  || 0,
    team_size:   parseFloat(document.getElementById('team').value)     || 0,
    revenue:     parseFloat(document.getElementById('revenue').value)  || 0,
    burn_rate:   parseFloat(document.getElementById('burn').value)     || 0,
    growth_rate: parseFloat(document.getElementById('growth').value)   || 0,
  };

  if (fields.funding <= 0 && fields.revenue <= 0) {
    etxt.textContent = 'Please enter at least funding or revenue data.';
    err.style.display = 'flex'; return;
  }

  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Analyzing...';
  bar.style.display = 'block';
  lt.style.display  = 'flex';

  try {
    const res  = await fetch('/predict', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(fields) });
    const data = await res.json();

    if (res.status === 401) { show('input-screen','login-screen'); return; }
    if (res.status === 429) { etxt.textContent='Too many requests. Please wait a moment.'; err.style.display='flex'; return; }
    if (data.error)         { etxt.textContent=data.error; err.style.display='flex'; return; }

    lastResult = data;
    renderOutput(data);
    show('input-screen', 'output-screen');
    loadHistory(); // refresh history after new analysis
  } catch(e) {
    etxt.textContent = 'Network error: ' + e.message;
    err.style.display = 'flex';
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Run Analysis';
    bar.style.display = 'none';
    lt.style.display  = 'none';
  }
}

function goBack() { show('output-screen','input-screen'); }

/* ═══════════════════════════════════════
   HISTORY
   ═══════════════════════════════════════ */
let historyData = [];
let historyFiltered = [];

async function loadHistory() {
  try {
    const res  = await fetch('/history');
    if (!res.ok) return;
    historyData = await res.json();
    historyFiltered = historyData;
    renderHistoryList(historyFiltered);
    updateHistoryCount();
  } catch(e) {
    console.error('History load failed:', e);
  }
}

function openHistory() {
  document.getElementById('history-drawer').classList.add('open');
  document.getElementById('history-overlay').classList.add('open');
  document.getElementById('history-search').value = '';
  historyFiltered = historyData;
  if (historyData.length === 0) loadHistory();
  else renderHistoryList(historyFiltered);
}

function closeHistory() {
  document.getElementById('history-drawer').classList.remove('open');
  document.getElementById('history-overlay').classList.remove('open');
}

function filterHistory(q) {
  q = q.toLowerCase();
  historyFiltered = q
    ? historyData.filter(h =>
        (h.decision||'').toLowerCase().includes(q) ||
        (h.stage||'').toLowerCase().includes(q) ||
        (h.investment_action||'').toLowerCase().includes(q))
    : historyData;
  renderHistoryList(historyFiltered);
  updateHistoryCount();
}

function updateHistoryCount() {
  const el = document.getElementById('history-count');
  if (el) el.textContent = `${historyFiltered.length} of ${historyData.length} analyses`;
}

const DECISION_COLORS = {
  'Strong Investment': '#a78bfa',
  'Good Startup':      '#10b981',
  'Watchlist':         '#f59e0b',
  'High Risk':         '#f43f5e',
};
const DECISION_EMOJIS = {
  'Strong Investment': '🔥',
  'Good Startup':      '🟢',
  'Watchlist':         '🟡',
  'High Risk':         '🔴',
};

function renderHistoryList(items) {
  const list = document.getElementById('history-list');
  if (!items.length) {
    list.innerHTML = `
      <div class="history-empty">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="1.5"/><path d="M20 12v8l5 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div>No analyses yet</div>
        <div style="font-size:11px;opacity:0.6">Run your first analysis to see history here</div>
      </div>`;
    return;
  }

  list.innerHTML = items.map(h => {
    const color = DECISION_COLORS[h.decision] || '#7c5cfc';
    const emoji = DECISION_EMOJIS[h.decision] || '📊';
    const date  = new Date(h.created_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'});
    return `
      <div class="history-item" style="--hi-color:${color}" onclick="loadAnalysisById(${h.id}, event)">
        <div class="hi-actions">
          <button class="hi-del-btn" onclick="deleteAnalysis(${h.id}, event)" title="Delete">✕</button>
        </div>
        <div class="hi-top">
          <div class="hi-decision">${emoji} ${h.decision}</div>
          <div class="hi-score">${h.score}</div>
        </div>
        <div class="hi-meta">
          <span class="hi-tag">${h.stage}</span>
          <span class="hi-tag">${h.investment_action}</span>
          <span class="hi-tag">Risk: ${h.risk}%</span>
          <span class="hi-tag">Runway: ${h.runway}mo</span>
        </div>
        <div class="hi-date">${date}</div>
      </div>`;
  }).join('');
}

async function loadAnalysisById(id, e) {
  if (e && e.target.classList.contains('hi-del-btn')) return;
  try {
    const res  = await fetch(`/history/${id}`);
    const data = await res.json();
    if (data.full) {
      lastResult = data.full;
      renderOutput(data.full);
      closeHistory();
      show('input-screen',  'output-screen');
      show('output-screen', 'output-screen');
      // make sure output is visible
      const out = document.getElementById('output-screen');
      out.style.display = 'flex';
      requestAnimationFrame(() => out.classList.add('visible'));
    }
  } catch(e) {
    showToast('Failed to load analysis');
  }
}

async function deleteAnalysis(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this analysis?')) return;
  try {
    await fetch(`/history/${id}`, {method:'DELETE'});
    historyData    = historyData.filter(h => h.id !== id);
    historyFiltered = historyFiltered.filter(h => h.id !== id);
    renderHistoryList(historyFiltered);
    updateHistoryCount();
    showToast('Analysis deleted');
  } catch {
    showToast('Delete failed');
  }
}

async function confirmClearAll() {
  if (!historyData.length) return;
  if (!confirm(`Delete all ${historyData.length} analyses? This cannot be undone.`)) return;
  const ids = historyData.map(h => h.id);
  await Promise.all(ids.map(id => fetch(`/history/${id}`, {method:'DELETE'}).catch(()=>{})));
  historyData = []; historyFiltered = [];
  renderHistoryList([]);
  updateHistoryCount();
  showToast('All analyses cleared');
}

/* ═══════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════ */
function exportReport() {
  if (!lastResult) return;
  const r   = lastResult;
  const now = new Date().toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'});
  const txt = `VENTURESCOPE INVESTMENT REPORT
Generated: ${now}
${'═'.repeat(52)}

VERDICT:           ${r.decision_emoji} ${r.decision}
COMPOSITE SCORE:   ${r.score} / 100
STAGE:             ${r.stage}
INVESTMENT ACTION: ${r.investment_action}

KEY METRICS
${'─'.repeat(40)}
Risk Level:        ${r.risk}%
Runway:            ${r.runway} months
Failure Risk:      ${r.failure_risk}%
6-Month Score:     ${r.future_score}
Future Outlook:    ${r.future_outlook}

SCORE BREAKDOWN
${'─'.repeat(40)}
${r.score_breakdown.map(s => `${s.factor.padEnd(24)} ${s.impact}%`).join('\n')}

RISK COMPONENTS
${'─'.repeat(40)}
Cash Risk:         ${r.risk_breakdown.cash_risk}%
Growth Risk:       ${r.risk_breakdown.growth_risk}%
Burn Risk:         ${r.risk_breakdown.burn_risk}%

AI ANALYSIS
${'─'.repeat(40)}
${r.summary}

${'═'.repeat(52)}
VentureScope AI · For informational purposes only.`;

  const blob = new Blob([txt], {type:'text/plain'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `venturescope-report-${Date.now()}.txt`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Report exported ✓');
}

/* ═══════════════════════════════════════
   RENDER OUTPUT
   ═══════════════════════════════════════ */
function renderOutput(r) {
  renderVerdict(r); renderKPI(r); renderSummary(r);
  renderScoreBars(r); renderInvestAction(r); renderRunway(r); renderFuture(r);
  destroyCharts();
  setTimeout(() => renderCharts(r), 100);
}

function renderVerdict(r) {
  const palettes = {
    'Strong Investment': {bg:'rgba(124,92,252,0.12)', border:'rgba(124,92,252,0.3)', text:'#c4b5fd', icon:'#7c5cfc20'},
    'Good Startup':      {bg:'rgba(16,185,129,0.1)',  border:'rgba(16,185,129,0.3)',  text:'#6ee7b7', icon:'#10b98120'},
    'Watchlist':         {bg:'rgba(245,158,11,0.1)',  border:'rgba(245,158,11,0.3)',  text:'#fcd34d', icon:'#f59e0b20'},
    'High Risk':         {bg:'rgba(244,63,94,0.1)',   border:'rgba(244,63,94,0.3)',   text:'#fda4af', icon:'#f43f5e20'},
  };
  const p  = palettes[r.decision] || palettes['Watchlist'];
  const el = document.getElementById('verdict-banner');
  el.style.background = p.bg; el.style.borderColor = p.border;
  el.innerHTML = `
    <div class="v-icon" style="background:${p.icon}">${r.decision_emoji}</div>
    <div class="v-text">
      <div class="v-decision" style="color:${p.text}">${r.decision}</div>
      <div class="v-sub" style="color:${p.text}">${r.stage} · Failure Risk: ${r.failure_risk}%</div>
      <div class="v-pill" style="color:${p.text}">${r.stage}</div>
    </div>
    <div class="v-score-block" style="color:${p.text}">
      <div class="v-score-num">${r.score}</div>
      <div class="v-score-label">Score / 100</div>
    </div>`;
}

function renderKPI(r) {
  const items = [
    {label:'Risk Level',    value:`${r.risk}%`,        sub:'Investment risk',  accent: r.risk>60?'var(--rose)':r.risk>35?'var(--amber)':'var(--emerald)'},
    {label:'Runway',        value:`${r.runway}mo`,      sub:'Months of capital',accent:'var(--violet)'},
    {label:'Failure Risk',  value:`${r.failure_risk}%`, sub:'Probability',      accent: r.failure_risk>60?'var(--rose)':r.failure_risk>35?'var(--amber)':'var(--emerald)'},
    {label:'6-Month Score', value:`${r.future_score}`,  sub:'Projected',        accent:'var(--sky)'},
  ];
  document.getElementById('metrics-row').innerHTML = items.map(m => `
    <div class="kpi-card" style="--kpi-accent:${m.accent}">
      <div class="kpi-label">${m.label}</div>
      <div class="kpi-value">${m.value}</div>
      <div class="kpi-sub">${m.sub}</div>
    </div>`).join('');
}

function renderSummary(r) {
  document.getElementById('summary-text').textContent = r.summary || 'No summary available.';
}

function renderScoreBars(r) {
  const colors = ['var(--violet)','var(--emerald)','var(--amber)','var(--sky)'];
  document.getElementById('score-total-badge').textContent = r.score + ' / 100';
  document.getElementById('score-bars').innerHTML = r.score_breakdown.map((s,i) => `
    <div class="prog-item">
      <div class="prog-row">
        <span class="prog-name">${s.factor}</span>
        <span class="prog-val" style="color:${colors[i]}">${s.impact}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="background:${colors[i]}" data-width="${s.impact}"></div>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => {
    document.querySelectorAll('.prog-fill').forEach(el => { el.style.width = el.dataset.width + '%'; });
  });
}

function renderInvestAction(r) {
  const map = {
    'INVEST':            {icon:'✅', label:'Invest Now',       color:'var(--emerald)', note:'Strong fundamentals justify capital allocation now.'},
    'WAIT':              {icon:'⏳', label:'Wait & Watch',      color:'var(--amber)',   note:'Promising — monitor for 60–90 days before committing.'},
    'REJECT':            {icon:'❌', label:'Do Not Invest',     color:'var(--rose)',    note:'Weak metrics and elevated risk. Pass at current stage.'},
    'EMERGENCY FUNDING': {icon:'🚨', label:'Emergency Funding', color:'var(--amber)',   note:'Critical — requires bridge capital urgently to survive.'},
  };
  const ac = map[r.investment_action] || map['WAIT'];
  document.getElementById('invest-action-panel').innerHTML = `
    <span class="invest-icon-wrap">${ac.icon}</span>
    <div class="invest-action-label" style="color:${ac.color}">${ac.label}</div>
    <div class="invest-note">${ac.note}</div>`;
}

function renderRunway(r) {
  const pct   = Math.min(r.runway/24*100, 100);
  const color = r.runway<3?'var(--rose)':r.runway<6?'var(--amber)':'var(--emerald)';
  const hint  = r.runway<3  ?'⚠️ Critical — raise immediately'
              : r.runway<6  ?'⚡ Short — begin fundraising now'
              : r.runway<12 ?'✅ Adequate — plan your next round'
              :              '✅ Healthy — focus on growth';
  document.getElementById('runway-display').innerHTML = `
    <div class="runway-num" style="color:${color}">${r.runway}<span class="runway-unit">mo</span></div>
    <div class="runway-sub">Capital remaining at current burn</div>
    <div class="runway-bar"><div class="runway-fill" style="background:${color}" data-width="${pct}"></div></div>
    <div class="runway-hint">${hint}</div>`;
  requestAnimationFrame(() => { const f=document.querySelector('.runway-fill'); if(f) f.style.width=f.dataset.width+'%'; });
}

function renderFuture(r) {
  const oc = r.future_score>80?'var(--emerald)':r.future_score>60?'var(--amber)':'var(--rose)';
  document.getElementById('future-row').innerHTML = `
    <div class="future-stat">
      <div class="future-val" style="color:var(--violet-l)">${r.future_score}</div>
      <div class="future-lbl">Projected Score</div>
    </div>
    <div class="future-stat">
      <div class="future-val" style="color:${oc};font-size:13px;margin-top:4px;line-height:1.3">${r.future_outlook}</div>
      <div class="future-lbl">Outlook</div>
    </div>`;
}

/* ═══════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════ */
let charts = {};
function destroyCharts() { Object.values(charts).forEach(c => { try { c&&c.destroy(); } catch{} }); charts = {}; }

const TT = {
  backgroundColor:'rgba(12,11,20,0.95)', titleColor:'#9d9bbf', bodyColor:'#f0eeff',
  borderColor:'rgba(124,92,252,0.3)', borderWidth:1, padding:12, cornerRadius:8,
  titleFont:{family:'JetBrains Mono',size:11}, bodyFont:{family:'JetBrains Mono',size:12},
};

function renderCharts(r) {
  const c1 = document.getElementById('riskChart');
  if (c1) charts.risk = new Chart(c1, {
    type:'bar',
    data:{ labels:['Cash Risk','Growth Risk','Burn Risk'],
           datasets:[{ data:[r.risk_breakdown.cash_risk,r.risk_breakdown.growth_risk,r.risk_breakdown.burn_risk],
                       backgroundColor:['rgba(244,63,94,0.8)','rgba(245,158,11,0.8)','rgba(124,92,252,0.8)'],
                       borderRadius:6, borderSkipped:false, borderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:TT},
      scales:{ y:{beginAtZero:true,max:100, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#5f5d80',font:{family:'JetBrains Mono',size:10}}},
               x:{grid:{display:false}, ticks:{color:'#5f5d80',font:{family:'JetBrains Mono',size:10}}} } }
  });

  const c2 = document.getElementById('donutChart');
  if (c2) {
    charts.donut = new Chart(c2, {
      type:'doughnut',
      data:{ labels:['Risk','Safe'], datasets:[{ data:[r.risk, 100-r.risk],
               backgroundColor:['rgba(244,63,94,0.85)','rgba(16,185,129,0.75)'], borderWidth:0, hoverBorderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'76%',
        plugins:{legend:{display:false}, tooltip:TT},
        animation:{animateRotate:true, duration:1000, easing:'easeInOutQuart'} }
    });
    const rc = r.risk>60?'#f87171':r.risk>35?'#fcd34d':'#6ee7b7';
    document.getElementById('donut-center').innerHTML = `<div class="donut-pct" style="color:${rc}">${r.risk}%</div><div class="donut-lbl">Risk</div>`;
    document.getElementById('donut-legend').innerHTML = `
      <div class="legend-item"><div class="legend-dot" style="background:#f43f5e"></div>Risk ${r.risk}%</div>
      <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div>Safe ${100-r.risk}%</div>`;
  }

  const c3 = document.getElementById('trajectoryChart');
  if (c3) {
    const g   = parseFloat(document.getElementById('growth')?.value)||0;
    const mid = parseFloat((r.score + (r.future_score-r.score)*0.4 + g*0.05).toFixed(1));
    charts.traj = new Chart(c3, {
      type:'line',
      data:{ labels:['Now','3 Months','6 Months'],
             datasets:[{ label:'Score', data:[r.score, mid, r.future_score],
               borderColor:'rgba(124,92,252,1)', backgroundColor:'rgba(124,92,252,0.06)',
               pointBackgroundColor:'rgba(124,92,252,1)', pointBorderColor:'var(--dark)',
               pointBorderWidth:2, pointRadius:6, fill:true, tension:0.4, borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:TT},
        scales:{ y:{min:0,max:100, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#5f5d80',font:{family:'JetBrains Mono',size:10}}},
                 x:{grid:{display:false}, ticks:{color:'#5f5d80',font:{family:'JetBrains Mono',size:10}}} } }
    });
  }
}