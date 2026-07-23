'use strict';

// ─── Try Socket.IO (graceful fallback if not available) ─────
let socket = null;
try {
  socket = io({ transports: ['websocket', 'polling'] });
} catch(e) {
  console.log('[GenSight] Socket.IO not available, demo mode will run');
}

// ─── DOM helper ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Clock ───────────────────────────────────────────────────
setInterval(() => {
  const el = $('clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-IN', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}, 1000);

// ════════════════════════════════════════════════════════════════
//  PERF HELPERS  (declared ONCE here — used everywhere below)
// ════════════════════════════════════════════════════════════════
const CHART_INTERVAL = 4000;
const _chartLastUpdate = new Map();

function throttledChartUpdate(chart, mode = 'none') {
  const now = Date.now();
  if (now - (_chartLastUpdate.get(chart) || 0) < CHART_INTERVAL) return;
  _chartLastUpdate.set(chart, now);
  requestAnimationFrame(() => chart.update(mode));
}

// ─── Batched DOM helpers ──────────────────────────────────────
const _domQueue = new Map();
let   _domFlushPending = false;

function setText(id, val) {
  const el = $(id);
  if (!el) return;
  _domQueue.set(id + ':text', { el, prop: 'textContent', val: String(val) });
  _scheduleDomFlush();
}

function setF(id, val, dec = 1) {
  const el = $(id);
  if (!el) return;
  const str = isNaN(val) ? '—' : parseFloat(val).toFixed(dec);
  _domQueue.set(id + ':text', { el, prop: 'textContent', val: str });
  _scheduleDomFlush();
}

function _scheduleDomFlush() {
  if (_domFlushPending) return;
  _domFlushPending = true;
  requestAnimationFrame(() => {
    _domQueue.forEach(({ el, prop, val }) => { el[prop] = val; });
    _domQueue.clear();
    _domFlushPending = false;
  });
}

function bar(id, pct) {
  const el = $(id);
  if (!el) return;
  requestAnimationFrame(() => { el.style.width = Math.min(100, pct) + '%'; });
}

// ════════════════════════════════════════════════════════════════
//  CANVAS GAUGE ENGINE
// ════════════════════════════════════════════════════════════════
const gauges = {};
const _gaugeRAF = {};

function initGauge(id, cfg) {
  const canvas = $(id);
  if (!canvas) return;
  canvas.width = canvas.height = 160;
  gauges[id] = { ctx: canvas.getContext('2d'), cfg, current: 0 };
  paintGauge(id, 0);
}

function paintGauge(id, val) {
  const g = gauges[id];
  if (!g) return;
  const { ctx, cfg } = g;
  const W = 160, H = 160, cx = W / 2, cy = H / 2 + 12, R = 60;
  const START = Math.PI * 0.75, SPAN = Math.PI * 1.5;
  const pct = Math.min(1, Math.max(0, (val - cfg.min) / (cfg.max - cfg.min)));

  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(cx, cy, R, START, START + SPAN);
  ctx.strokeStyle = '#E2E8F5'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();

  const zones = cfg.zones || [
    { lo: 0, hi: .7, col: '#059669' }, { lo: .7, hi: .9, col: '#D97706' }, { lo: .9, hi: 1, col: '#DC2626' }
  ];
  zones.forEach(z => {
    if (pct <= z.lo) return;
    ctx.beginPath(); ctx.arc(cx, cy, R, START + z.lo * SPAN, START + Math.min(pct, z.hi) * SPAN);
    ctx.strokeStyle = z.col; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  });

  for (let i = 0; i <= 8; i++) {
    const a = START + (i / 8) * SPAN;
    ctx.beginPath();
    ctx.moveTo(cx + (R + 7) * Math.cos(a), cy + (R + 7) * Math.sin(a));
    ctx.lineTo(cx + (R + 13) * Math.cos(a), cy + (R + 13) * Math.sin(a));
    ctx.strokeStyle = '#C8D5EF'; ctx.lineWidth = 1.5; ctx.lineCap = 'butt'; ctx.stroke();
  }

  const na = START + pct * SPAN;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(na);
  ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(R - 16, 0);
  ctx.strokeStyle = '#1A2340'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#1A2340'; ctx.fill();
}

function animateGauge(id, target) {
  const g = gauges[id];
  if (!g) return;
  if (_gaugeRAF[id]) { cancelAnimationFrame(_gaugeRAF[id]); _gaugeRAF[id] = null; }
  const from = g.current, dur = 450, t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    g.current = from + (target - from) * e;
    paintGauge(id, g.current);
    if (p < 1) { _gaugeRAF[id] = requestAnimationFrame(tick); }
    else { g.current = target; _gaugeRAF[id] = null; }
  };
  _gaugeRAF[id] = requestAnimationFrame(tick);
}

initGauge('gRPM', {
  min: 0, max: 2000,
  zones: [{ lo: 0, hi: .4, col: '#D97706' }, { lo: .4, hi: .8, col: '#059669' }, { lo: .8, hi: .95, col: '#D97706' }, { lo: .95, hi: 1, col: '#DC2626' }]
});
initGauge('gTemp', {
  min: 0, max: 120,
  zones: [{ lo: 0, hi: .5, col: '#2563EB' }, { lo: .5, hi: .75, col: '#059669' }, { lo: .75, hi: .9, col: '#D97706' }, { lo: .9, hi: 1, col: '#DC2626' }]
});

// ════════════════════════════════════════════════════════════════
//  24-HOUR DATA STORE
// ════════════════════════════════════════════════════════════════
const TANK_CAPACITY = 785;

// ════════════════════════════════════════════════════════════════
//  TODAY'S ENGINE RUNTIME TRACKER (resets at local midnight IST)
// ════════════════════════════════════════════════════════════════
function _todayKeyIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ── Fetch the real start-of-day fuel level from server history ────
const _cachedFuelSession = _loadFuelSessionToday();
window._fuelDayKey          = _cachedFuelSession ? _todayKeyIST() : null;
window._fuelSessionStart    = _cachedFuelSession ? _cachedFuelSession.litres : null;
window._fuelSessionStartPct = _cachedFuelSession ? _cachedFuelSession.pct    : null;
window._fuelSessionFetching = false;

async function fetchTodayStartFuel() {
  if (window._fuelSessionFetching) return;
  window._fuelSessionFetching = true;
  const todayKey = _todayKeyIST();
  try {
    const r = await fetch(`/api/history?from=${todayKey}&to=${todayKey}`);
    const json = await r.json();
    const litresArr = json.fuelLevelL || [];
    const pctArr    = json.fuelLevelPct || [];
    const firstIdx  = litresArr.findIndex(v => typeof v === 'number' && v > 0);
    if (firstIdx !== -1) {
      window._fuelSessionStart    = litresArr[firstIdx];
      window._fuelSessionStartPct = pctArr[firstIdx] || 0;
      window._fuelDayKey          = todayKey;
      _saveFuelSessionToday(todayKey, window._fuelSessionStart, window._fuelSessionStartPct);
    }
  } catch (e) {
    console.warn('[Fuel] Could not fetch today start fuel:', e.message);
  } finally {
    window._fuelSessionFetching = false;
  }
}

const ENG_HOURS_STORAGE_KEY = 'gensight_engHoursToday';

function _loadEngHoursToday() {
  try {
    const raw = localStorage.getItem(ENG_HOURS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only trust the saved value if it's from *today* — otherwise it's stale
    if (parsed && parsed.dateKey === _todayKeyIST() && typeof parsed.seconds === 'number') {
      return parsed;
    }
  } catch (e) {
    console.warn('[EngHours] Could not read localStorage:', e.message);
  }
  return null;
}

const FUEL_SESSION_STORAGE_KEY = 'gensight_fuelSessionToday';

function _loadFuelSessionToday() {
  try {
    const raw = localStorage.getItem(FUEL_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.dateKey === _todayKeyIST()
        && typeof parsed.litres === 'number' && typeof parsed.pct === 'number') {
      return parsed;
    }
  } catch (e) {
    console.warn('[Fuel] Could not read session cache:', e.message);
  }
  return null;
}

function _saveFuelSessionToday(dateKey, litres, pct) {
  try {
    localStorage.setItem(FUEL_SESSION_STORAGE_KEY, JSON.stringify({ dateKey, litres, pct }));
  } catch (e) {
    console.warn('[Fuel] Could not write session cache:', e.message);
  }
}

function _saveEngHoursToday(dateKey, seconds) {
  try {
    localStorage.setItem(ENG_HOURS_STORAGE_KEY, JSON.stringify({ dateKey, seconds }));
  } catch (e) {
    console.warn('[EngHours] Could not write localStorage:', e.message);
  }
}

const _savedEngHours     = _loadEngHoursToday();
let _engTodayDateKey     = _savedEngHours ? _savedEngHours.dateKey : _todayKeyIST();
let _engTodaySeconds     = _savedEngHours ? _savedEngHours.seconds : 0;
let _engTodayLastTs      = null;
let _engTodayLastSaveMs  = 0;

function updateEngineHoursToday(isRunning) {
  const nowKey = _todayKeyIST();
  if (nowKey !== _engTodayDateKey) {
    // Midnight rollover — reset the counter for the new day
    _engTodayDateKey = nowKey;
    _engTodaySeconds = 0;
    _engTodayLastTs  = null;
    _saveEngHoursToday(_engTodayDateKey, _engTodaySeconds);
  }

  const now = Date.now();
  if (_engTodayLastTs !== null) {
    const deltaSec = (now - _engTodayLastTs) / 1000;
    // Ignore absurd gaps (tab backgrounded, laptop sleep, etc.)
    if (isRunning && deltaSec > 0 && deltaSec < 120) {
      _engTodaySeconds += deltaSec;
    }
  }
  _engTodayLastTs = now;

  // Throttle writes — once every ~10s is plenty, avoids hammering localStorage on every poll
  if (now - _engTodayLastSaveMs > 10000) {
    _engTodayLastSaveMs = now;
    _saveEngHoursToday(_engTodayDateKey, _engTodaySeconds);
  }

  return _engTodaySeconds / 3600; // hours
}

const dayStore = {
  timestamps: [],
  voltL1N: [], voltL2N: [], voltL3N: [],
  voltL1L2: [], voltL2L3: [], voltL3L1: [],
  currL1: [], currL2: [], currL3: [],
  calcAL1: [], calcAL2: [], calcAL3: [], calcAmpsTotal: [],
  currPctL1: [], currPctL2: [], currPctL3: [],
  kwTotal: [], kvaTotal: [], kvarTotal: [],
  freq: [], pf: [],
  rpm: [], coolantTempC: [],
  oilPressKPa: [], battV: [],
  coolantF: [], oilTempF: [], intakeTempF: [], fuelTempF: [], exhaustTempF: [],
  oilPsi: [], boostPsi: [], crankcasePsi: [], fuelSupplyPsi: [], coolantPsi: [],
  fuelPct: [], fuelLitres: [],
  uVL1N: [], uVL2N: [], uVL3N: [],
  uVL1L2: [], uVL2L3: [], uVL3L1: [],
  utilFreq: []
};

function pushDayStore(latest) {
  const ts   = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const ac   = latest.ac         || {};
  const eng  = latest.engine     || {};
  const elec = latest.electrical || {};
  const fuel = latest.fuel       || {};
  const util = latest.utility    || {};

  const vL1 = parseFloat(ac.voltL1N) || 0;
  const vL2 = parseFloat(ac.voltL2N) || 0;
  const vL3 = parseFloat(ac.voltL3N) || 0;
  const vAvg = (vL1 + vL2 + vL3) / 3 || 230;
  const kw   = parseFloat(ac.kwTotal) || 0;
  const kva  = parseFloat(ac.kvaTotal) || 0;
  const pf   = kva > 0.5 ? kw / kva : 0;
  const sqrt3 = 1.7321;
  const calcAmps = (kwVal, v, pfVal) => (!v || !pfVal) ? 0 : (kwVal * 1000) / (sqrt3 * v * pfVal);
  const kwL1 = parseFloat(ac.kwL1) || kw / 3;
  const kwL2 = parseFloat(ac.kwL2) || kw / 3;
  const kwL3 = parseFloat(ac.kwL3) || kw / 3;
  const aCalc1 = calcAmps(kwL1, vL1 || vAvg, pf || 0.88);
  const aCalc2 = calcAmps(kwL2, vL2 || vAvg, pf || 0.88);
  const aCalc3 = calcAmps(kwL3, vL3 || vAvg, pf || 0.88);
  const fuelPct = parseInt(fuel.pct) || 0;
const fuelLitresReal = (fuel.litres != null && !isNaN(parseFloat(fuel.litres)) && parseFloat(fuel.litres) > 0)
  ? Math.round(parseFloat(fuel.litres))
  : Math.round(fuelPct * TANK_CAPACITY / 100);
dayStore.fuelPct.push(fuelPct);
dayStore.fuelLitres.push(fuelLitresReal);

  dayStore.timestamps.push(ts);
  dayStore.voltL1N.push(vL1); dayStore.voltL2N.push(vL2); dayStore.voltL3N.push(vL3);
  dayStore.voltL1L2.push(parseFloat(ac.voltL1L2) || 0);
  dayStore.voltL2L3.push(parseFloat(ac.voltL2L3) || 0);
  dayStore.voltL3L1.push(parseFloat(ac.voltL3L1) || 0);
  dayStore.currL1.push(parseFloat(ac.currL1) || 0);
  dayStore.currL2.push(parseFloat(ac.currL2) || 0);
  dayStore.currL3.push(parseFloat(ac.currL3) || 0);
  dayStore.calcAL1.push(+aCalc1.toFixed(1));
  dayStore.calcAL2.push(+aCalc2.toFixed(1));
  dayStore.calcAL3.push(+aCalc3.toFixed(1));
  dayStore.calcAmpsTotal.push(+(aCalc1 + aCalc2 + aCalc3).toFixed(1));
  dayStore.currPctL1.push(parseFloat(ac.currPctL1) || 0);
  dayStore.currPctL2.push(parseFloat(ac.currPctL2) || 0);
  dayStore.currPctL3.push(parseFloat(ac.currPctL3) || 0);
  dayStore.kwTotal.push(kw);
  dayStore.kvaTotal.push(kva);
  dayStore.kvarTotal.push(parseFloat(ac.kvarTotal) || 0);
  dayStore.freq.push(parseFloat(ac.freq) || 0);
  dayStore.pf.push(+pf.toFixed(3));
  dayStore.rpm.push(parseFloat(eng.rpm) || 0);
  dayStore.coolantTempC.push(+((parseFloat(eng.coolantTempF) || 32 - 32) * 5 / 9).toFixed(1));
  dayStore.oilPressKPa.push(+(parseFloat(eng.oilPressPsi || 0) * 6.895).toFixed(0));
  dayStore.battV.push(parseFloat(elec.battV) || 0);
  dayStore.coolantF.push(parseFloat(eng.coolantTempF) || 0);
  dayStore.oilTempF.push(parseFloat(eng.oilTempF) || 0);
  dayStore.intakeTempF.push(parseFloat(eng.intakeTempF) || 0);
  dayStore.fuelTempF.push(parseFloat(eng.fuelTempF) || 0);
  dayStore.exhaustTempF.push(parseFloat(eng.exhaustTempF) || 0);
  dayStore.oilPsi.push(parseFloat(eng.oilPressPsi) || 0);
  dayStore.boostPsi.push(parseFloat(eng.boostPressPsi) || 0);
  dayStore.crankcasePsi.push(parseFloat(eng.crankPressPsi) || 0);
  dayStore.fuelSupplyPsi.push(parseFloat(eng.fuelPressPsi) || 0);
  dayStore.coolantPsi.push(parseFloat(eng.coolantPsi) || 0);
  dayStore.uVL1N.push(parseFloat(util.voltL1N) || 0);
  dayStore.uVL2N.push(parseFloat(util.voltL2N) || 0);
  dayStore.uVL3N.push(parseFloat(util.voltL3N) || 0);
  dayStore.uVL1L2.push(parseFloat(util.voltL1L2) || 0);
  dayStore.uVL2L3.push(parseFloat(util.voltL2L3) || 0);
  dayStore.uVL3L1.push(parseFloat(util.voltL3L1) || 0);
  dayStore.utilFreq.push(parseFloat(util.freq) || 0);

  const MAX = 4320;
  Object.keys(dayStore).forEach(k => {
    if (dayStore[k].length > MAX) dayStore[k].shift();
  });
}

// ════════════════════════════════════════════════════════════════
//  CHARTS
// ════════════════════════════════════════════════════════════════
const trendCtx = $('trendChart').getContext('2d');
const trendChart = new Chart(trendCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'kW',       data: [], borderColor: '#059669', borderWidth: 2, tension: .4, pointRadius: 0, fill: true,  backgroundColor: 'rgba(5,150,105,.06)', yAxisID: 'yL' },
      { label: '°C Cool.', data: [], borderColor: '#DC2626', borderWidth: 2, tension: .4, pointRadius: 0, fill: false, yAxisID: 'yR' },
      { label: 'RPMx10',   data: [], borderColor: '#2563EB', borderWidth: 1.5, tension: .4, pointRadius: 0, fill: false, yAxisID: 'yL' },
      { label: 'Fuel%',    data: [], borderColor: '#7C3AED', borderWidth: 1.5, tension: .4, pointRadius: 0, fill: false, yAxisID: 'yR' }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10, padding: 10, color: '#4A5568' } },
      tooltip: { bodyFont: { family: 'JetBrains Mono', size: 11 }, titleFont: { family: 'Nunito', size: 11, weight: '800' } }
    },
    scales: {
      x:  { ticks: { font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8, color: '#8A9BB5' }, grid: { color: 'rgba(0,0,0,.04)' } },
      yL: { position: 'left',  ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { color: 'rgba(0,0,0,.04)' } },
      yR: { position: 'right', ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { drawOnChartArea: false } }
    }
  }
});



const fuelCtx = $('fuelChart').getContext('2d');
const fuelChart = new Chart(fuelCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'Fuel % (785L tank)',  data: [], borderColor: '#059669', borderWidth: 2, tension: .4, pointRadius: 0, fill: true,  backgroundColor: 'rgba(5,150,105,.08)', yAxisID: 'yL' },
      { label: 'Litres remaining',    data: [], borderColor: '#2563EB', borderWidth: 1.5, tension: .4, pointRadius: 0, fill: false, yAxisID: 'yR' }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
    plugins: { legend: { position: 'bottom', labels: { font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10, padding: 10, color: '#4A5568' } } },
    scales: {
      x:  { ticks: { font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8, color: '#8A9BB5' }, grid: { color: 'rgba(0,0,0,.04)' } },
      yL: { position: 'left',  min: 0, max: 100, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { color: 'rgba(0,0,0,.04)' } },
      yR: { position: 'right', min: 0, max: TANK_CAPACITY, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { drawOnChartArea: false } }
    }
  }
});

const LEGEND_TOGGLE_CHARTS = [trendChart, fuelChart];
 
LEGEND_TOGGLE_CHARTS.forEach(chart => {
  chart.options.plugins.legend.onClick = function (e, legendItem, legend) {
    const index   = legendItem.datasetIndex;
    const meta    = chart.getDatasetMeta(index);
 
    // Toggle hidden state
    meta.hidden = meta.hidden === null ? true : !meta.hidden;
 
    // Sync the dataset's own hidden flag so it persists across updates
    chart.data.datasets[index].hidden = meta.hidden;
 
    chart.update('none');   // instant — no animation lag
  };
 
  // Re-apply so the new onClick takes effect immediately
  chart.update('none');
});


function blockChartBubble(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var el = canvas.parentElement;
  while (el && !el.classList.contains('card')) {
    el = el.parentElement;
  }
  if (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }
}
 
blockChartBubble('trendChart');
blockChartBubble('fuelChart');
 
document.querySelectorAll('.chart-card').forEach(function (card) {
  card.addEventListener('click', function (e) { e.stopPropagation(); });
});
 

[trendChart, fuelChart].forEach(function (chart) {
  chart.options.plugins.legend.onClick = function (e, legendItem) {
    var index = legendItem.datasetIndex;
    var meta  = chart.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    chart.data.datasets[index].hidden = meta.hidden;
    chart.update('none');
  };
  chart.update('none');
});

// ════════════════════════════════════════════════════════════════
//  NFPA 110 GRID
// ════════════════════════════════════════════════════════════════
const NFPA_BITS = [
  { bit: 0,  name: '⛽ Low Fuel Level',            sev: 'warn' }, { bit: 1,  name: '💧 Low Coolant Level',         sev: 'warn' },
  { bit: 2,  name: '🔴 Overspeed',                 sev: 'shut' }, { bit: 3,  name: '🔴 Low Oil Pressure',          sev: 'shut' },
  { bit: 4,  name: '⚠️ Pre-Low Oil Pressure',      sev: 'warn' }, { bit: 5,  name: '🔴 High Engine Temp',          sev: 'shut' },
  { bit: 6,  name: '⚠️ Pre-High Engine Temp',      sev: 'warn' }, { bit: 7,  name: '🧊 Low Coolant Temp',          sev: 'warn' },
  { bit: 8,  name: '🔴 Fail to Start',             sev: 'shut' }, { bit: 9,  name: '⚡ Charger AC Failure',        sev: 'warn' },
  { bit: 10, name: '🔋 Low/Weak Battery',          sev: 'warn' }, { bit: 11, name: '🔋 High Battery Voltage',      sev: 'warn' },
  { bit: 12, name: '⚠️ Not in Auto Mode',          sev: 'warn' }, { bit: 13, name: '✅ Genset Running',            sev: 'info' },
  { bit: 14, name: '✅ Genset Supplying Load',     sev: 'info' }, { bit: 15, name: '🔔 Common Alarm',              sev: 'warn' },
  { bit: 16, name: '🔴 Emergency Stop',            sev: 'shut' }, { bit: 17, name: '⚡ Utility CB Tripped',        sev: 'warn' },
  { bit: 18, name: '⚡ Genset CB Tripped',         sev: 'warn' }, { bit: 19, name: '📊 Load Demand',              sev: 'info' },
  { bit: 20, name: '⚠️ Fail to Close',             sev: 'warn' }, { bit: 21, name: '⚠️ Fail to Sync',             sev: 'warn' },
  { bit: 22, name: '⚠️ Reverse kVAR',              sev: 'warn' }, { bit: 23, name: '⚠️ Reverse kW',               sev: 'warn' },
  { bit: 24, name: '🔴 Short Circuit',             sev: 'shut' }, { bit: 25, name: '🔴 Overcurrent',              sev: 'shut' },
  { bit: 26, name: '⚠️ Overload',                  sev: 'warn' }, { bit: 27, name: '⚠️ Under Frequency',          sev: 'warn' },
  { bit: 28, name: '⚠️ Low AC Voltage',            sev: 'warn' }, { bit: 29, name: '🔴 High AC Voltage',          sev: 'shut' },
  { bit: 30, name: '🔴 Ground Fault',              sev: 'shut' }, { bit: 31, name: '🔔 Check Genset',             sev: 'warn' }
];

function buildNFPAGrid() {
  const grid = $('nfpaGrid');
  if (!grid) return;
  NFPA_BITS.forEach(b => {
    const div = document.createElement('div');
    div.className = 'nfpa-bit'; div.id = `nfpa-bit-${b.bit}`;
    div.innerHTML = `<span class="nb-dot"></span><span>${b.name}</span>`;
    div.title = `Bit ${b.bit}`;
    grid.appendChild(div);
  });
}


function updateNFPA(bitmask) {
  const val = (bitmask >>> 0);
  setText('nfpaRaw', '0x' + val.toString(16).toUpperCase().padStart(8, '0'));
  NFPA_BITS.forEach(b => {
    const el = $(`nfpa-bit-${b.bit}`);
    if (!el) return;
    el.className = 'nfpa-bit' + ((val & (1 << b.bit)) !== 0 ? ` active-${b.sev}` : '');
  });
}

// ════════════════════════════════════════════════════════════════
//  PF RING
// ════════════════════════════════════════════════════════════════
function setPFRing(pf) {
  const arc = $('pfArc');
  if (!arc) return;
  const circ = 2 * Math.PI * 38;
  const fill = Math.min(1, Math.abs(pf)) * circ;
  arc.style.strokeDasharray = `${fill.toFixed(2)} ${(circ - fill).toFixed(2)}`;
  arc.style.stroke = pf >= 0.9 ? '#059669' : pf >= 0.75 ? '#D97706' : '#DC2626';
}

// ════════════════════════════════════════════════════════════════
//  EVENT LOG
// ════════════════════════════════════════════════════════════════
function logEvent(msg, type = 'info') {
  const ul = $('eventLog');
  if (!ul) return;
  const li = document.createElement('li');
  li.className = `log-entry log-${type}`;
  li.textContent = `${new Date().toLocaleTimeString('en-IN', { hour12: false })}  ${msg}`;
  ul.insertBefore(li, ul.firstChild);
  while (ul.children.length > 40) ul.removeChild(ul.lastChild);
}

// PS0600 Fault Code descriptions (from A029X159 datasheet)
const PS0600_FAULTS = {
  0x1234: 'Low Oil Pressure',
  0x1235: 'High Coolant Temp',
  0x1236: 'Overspeed',
  0x1237: 'Low Coolant Level',
  0x1238: 'Fail to Start',
  0x1239: 'Low Fuel Level',
  0x123A: 'High Battery Voltage',
  0x123B: 'Low Battery Voltage',
  0x123C: 'Emergency Stop',
  0x123D: 'Ground Fault',
  0x123E: 'Overcurrent',
  0x123F: 'Short Circuit'
  // Add more from your PS0600 fault code list
};

function renderFaultQueue(containerId, codes, cssClass) {
  const el = $(containerId);
  if (!el) return;
  const active = (codes || []).filter(c => c && c !== 0 && c !== 0xFFFF);
  if (active.length === 0) {
    el.innerHTML = `<div class="ft-empty">
      ✅ No ${cssClass === 'warn' ? 'warning' : 'shutdown'} faults
    </div>`;
    return;
  }
  el.innerHTML = active.map(c => {
    const hex = '0x' + c.toString(16).toUpperCase().padStart(4, '0');
    const desc = PS0600_FAULTS[c] || 'Unknown Fault';
    return `<div class="ft-item ${cssClass}">
      <span style="font-family:var(--mono)">${hex}</span>
      <span style="margin-left:8px;font-size:.65rem">${desc}</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
//  POWER QUALITY
// ════════════════════════════════════════════════════════════════
function renderPowerQuality(voltUnbal, currUnbal, kvar) {
  const vEl    = $('voltUnbalVal');
  const vFill  = $('voltUnbalFill');
  const vStat  = $('voltUnbalStatus');
  const vBadge = $('voltUnbalBadge');

  if (vEl) vEl.textContent = voltUnbal.toFixed(2);
  const vPct = Math.min(100, (voltUnbal / 3) * 100);
  if (vFill) {
    vFill.style.width = vPct + '%';
    vFill.className = 'pq-fill pq-v' + (voltUnbal >= 3 ? ' crit' : voltUnbal >= 1 ? ' warn' : '');
  }
  const vStatus = voltUnbal >= 3
    ? { cls: 'crit', txt: '🔴 EXCEEDS NEMA 3% limit — derate alternator!' }
    : voltUnbal >= 1
    ? { cls: 'warn', txt: '⚠️ Caution (>1%) — monitor closely' }
    : { cls: 'ok',   txt: '✅ Balanced (<1%)' };
  if (vStat)  { vStat.textContent = vStatus.txt; vStat.className = 'pq-status ' + vStatus.cls; }
  if (vBadge) { vBadge.textContent = voltUnbal.toFixed(2) + '%'; vBadge.className = 'ib-val ib-badge ' + (voltUnbal >= 3 ? 'crit' : voltUnbal >= 1 ? 'warn' : 'ok'); }

  const cEl    = $('currUnbalVal');
  const cFill  = $('currUnbalFill');
  const cStat  = $('currUnbalStatus');
  const cBadge = $('currUnbalBadge');

  if (cEl) cEl.textContent = currUnbal.toFixed(2);
  const cPct = Math.min(100, (currUnbal / 15) * 100);
  if (cFill) {
    cFill.style.width = cPct + '%';
    cFill.className = 'pq-fill pq-c' + (currUnbal >= 10 ? ' crit' : currUnbal >= 5 ? ' warn' : '');
  }
  const cStatus = currUnbal >= 10
    ? { cls: 'crit', txt: '🔴 EXCEEDS 10% — rotor heating risk!' }
    : currUnbal >= 5
    ? { cls: 'warn', txt: '⚠️ Elevated (>5%) — check load distribution' }
    : { cls: 'ok',   txt: '✅ Balanced (<5%)' };
  if (cStat)  { cStat.textContent = cStatus.txt; cStat.className = 'pq-status ' + cStatus.cls; }
  if (cBadge) { cBadge.textContent = currUnbal.toFixed(2) + '%'; cBadge.className = 'ib-val ib-badge ' + (currUnbal >= 10 ? 'crit' : currUnbal >= 5 ? 'warn' : 'ok'); }

  const dot = $('llDot');
  const txt = $('llText');
  if (dot && txt) {
    if (kvar > 1)      { dot.className = 'll-dot lagging'; txt.textContent = 'Lagging — inductive load (motors/transformers)'; }
    else if (kvar < -1){ dot.className = 'll-dot leading'; txt.textContent = 'Leading — capacitive load (PFC caps active)'; }
    else               { dot.className = 'll-dot unity';   txt.textContent = 'Unity — near-perfect power factor ✅'; }
  }
}


// ── PS0600 NFPA 110 bit descriptions ──────────────────────────
const NFPA_WARN_BITS = {
  0:  { txt: 'Low Fuel Level',          sev: 'warn' },
  1:  { txt: 'Low Coolant Level',       sev: 'warn' },
  2:  { txt: 'Overspeed',               sev: 'shut' },
  3:  { txt: 'Low Oil Pressure',        sev: 'shut' },
  4:  { txt: 'Pre-Low Oil Pressure',    sev: 'warn' },
  5:  { txt: 'High Engine Temp',        sev: 'shut' },
  6:  { txt: 'Pre-High Engine Temp',    sev: 'warn' },
  7:  { txt: 'Low Coolant Temp',        sev: 'warn' },
  8:  { txt: 'Fail to Start',           sev: 'shut' },
  9:  { txt: 'Charger AC Failure',      sev: 'warn' },
  10: { txt: 'Low / Weak Battery',      sev: 'warn' },
  11: { txt: 'High Battery Voltage',    sev: 'warn' },
  12: { txt: 'Not in Auto Mode',        sev: 'warn' },
  16: { txt: 'Emergency Stop',          sev: 'shut' },
  17: { txt: 'Utility CB Tripped',      sev: 'warn' },
  18: { txt: 'Genset CB Tripped',       sev: 'warn' },
  20: { txt: 'Fail to Close',           sev: 'warn' },
  21: { txt: 'Fail to Sync',            sev: 'warn' },
  22: { txt: 'Reverse kVAR',            sev: 'warn' },
  23: { txt: 'Reverse kW',              sev: 'warn' },
  24: { txt: 'Short Circuit',           sev: 'shut' },
  25: { txt: 'Overcurrent',             sev: 'shut' },
  26: { txt: 'Overload',                sev: 'warn' },
  27: { txt: 'Under Frequency',         sev: 'warn' },
  28: { txt: 'Low AC Voltage',          sev: 'warn' },
  29: { txt: 'High AC Voltage',         sev: 'shut' },
  30: { txt: 'Ground Fault',            sev: 'shut' },
  31: { txt: 'Check Genset',            sev: 'warn' }
};

function renderWarnStrip(latest) {
  const strip = $('warnStrip');
  const inner = $('warnStripInner');
  if (!strip || !inner) return;

  const warnings = [];

  // 1. Amber Warning Lamp (register 400228)
  if (parseInt(latest.amberWarn) === 1) {
    warnings.push({ txt: 'Amber Warning Lamp ON', sev: 'warn', src: 'Reg 400228' });
  }

  // 2. Active fault code (registers 400012 + 400013)
  const fc  = parseInt(latest.faultCode)     || 0;
  const fsv = parseInt(latest.faultSeverity) || 0;
  if (fc !== 0) {
    const sevTxt = fsv === 2 ? 'SHUTDOWN' : 'WARNING';
    const sev    = fsv === 2 ? 'shut' : 'warn';
    warnings.push({
      txt: `${sevTxt}: Fault Code 0x${fc.toString(16).toUpperCase().padStart(4,'0')}`,
      sev,
      src: 'Reg 400012'
    });
  }

  // 3. NFPA 110 bitmap (register 400016 — 32 bits)
  const nfpa = (parseInt(latest.nfpa110) || 0) >>> 0;
  Object.entries(NFPA_WARN_BITS).forEach(([bit, info]) => {
    // skip bits 13,14,15,19 — those are info/status not warnings
    if ([13, 14, 15, 19].includes(parseInt(bit))) return;
    if (nfpa & (1 << parseInt(bit))) {
      warnings.push({ txt: info.txt, sev: info.sev, src: `NFPA bit ${bit}` });
    }
  });

  // 4. Warning fault queue (registers 401012–401021)
  const warnFaults = latest.warningFaults || [];
  warnFaults.forEach((code, i) => {
    if (code && code !== 0 && code !== 0xFFFF) {
      warnings.push({
        txt: `Warning Fault 0x${code.toString(16).toUpperCase().padStart(4,'0')}`,
        sev: 'warn',
        src: `Reg 40${1012 + i}`
      });
    }
  });

  // 5. Shutdown fault queue (registers 401002–401011)
  const shutFaults = latest.shutdownFaults || [];
  shutFaults.forEach((code, i) => {
    if (code && code !== 0 && code !== 0xFFFF) {
      warnings.push({
        txt: `Shutdown Fault 0x${code.toString(16).toUpperCase().padStart(4,'0')}`,
        sev: 'shut',
        src: `Reg 40${1002 + i}`
      });
    }
  });

  // Hide strip if no warnings
  if (warnings.length === 0) {
    strip.style.display = 'none';
    return;
  }

  // Check if any shutdown
  const hasShutdown = warnings.some(w => w.sev === 'shut');
  strip.style.display = 'block';
  strip.className = hasShutdown ? 'has-shutdown' : '';

  const icon    = hasShutdown ? '🔴' : '🟡';
  const heading = hasShutdown ? 'SHUTDOWN FAULT' : 'ACTIVE WARNINGS';

  inner.className = 'ws-inner';
  inner.innerHTML = `
    <div class="ws-header">
      ${icon} ${heading} (${warnings.length})
    </div>
    <div class="ws-items">
      ${warnings.map(w => `
        <div class="ws-item ${w.sev === 'shut' ? 'shutdown-item' : ''}">
          <span class="ws-dot"></span>
          <span>${w.txt}</span>
          <span style="font-size:.60rem;opacity:.6;margin-left:3px">(${w.src})</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  OUTPUT ACTUATORS
// ════════════════════════════════════════════════════════════════
const EXERCISE_LABELS = ['💤 Inactive', '🏃 Active', '⛔ Aborted'];
const ATS_EXT_BITS = [
  'Source 1 Available', 'Source 2 Available', 'Load on Source 1',
  'Load on Source 2', 'Transfer Inhibit', 'Retransfer Inhibit'
];

function renderOutputStatus(latest, derived) {
  const fuelShutoff = parseInt(latest.fuelShutoffActive) || 0;
  const starter     = parseInt(latest.starterActive)     || 0;
  const exercise    = parseInt(latest.exerciseState)     || 0;
  const spn         = parseInt(latest.unrecognizedSPN)   || 0;
  const atsExt      = parseInt(latest.atsExtended)       || 0;

  const fsEl = $('fuelShutoffChip');
  if (fsEl) {
    const isRunning = (latest.stateCode === 8);
    if (fuelShutoff) { fsEl.textContent = isRunning ? '🔴 ACTIVE — SHUTTING DOWN' : '🟡 Active (stopped)'; fsEl.className = 'out-chip ' + (isRunning ? 'active' : 'warn'); }
    else             { fsEl.textContent = '✅ Inactive (open)'; fsEl.className = 'out-chip inactive'; }
  }
  const stEl = $('starterChip');
  if (stEl) {
    if (starter) { stEl.textContent = '⚡ CRANKING'; stEl.className = 'out-chip warn'; }
    else         { stEl.textContent = '✅ Inactive'; stEl.className = 'out-chip inactive'; }
  }
  const exEl = $('exerciseChip');
  if (exEl) { exEl.textContent = EXERCISE_LABELS[exercise] || '—'; exEl.className = 'out-chip ' + (exercise === 1 ? 'info' : exercise === 2 ? 'warn' : 'inactive'); }

  const spnEl = $('spnChip');
  if (spnEl) {
    if (spn) { spnEl.textContent = '⚠️ Unknown SPN/FMI'; spnEl.className = 'out-chip warn'; }
    else     { spnEl.textContent = '✅ All Recognized'; spnEl.className = 'out-chip inactive'; }
  }
  const atsEl = $('atsExtChip');
  if (atsEl) {
    if (atsExt > 0) {
      const activeBits = ATS_EXT_BITS.filter((_, i) => atsExt & (1 << i));
      atsEl.textContent = `0x${atsExt.toString(16).toUpperCase().padStart(4, '0')} — ${activeBits[0] || ''}`;
      atsEl.className = 'out-chip info';
      atsEl.title = activeBits.join(', ') || 'No active bits';
    } else { atsEl.textContent = '0x0000 — Clear'; atsEl.className = 'out-chip inactive'; }
  }
  if (derived && derived.gensetInfo) {
    const gi = derived.gensetInfo;
    if (gi.lowBattThreshold  != null) setText('thBattLow',  gi.lowBattThreshold.toFixed(1));
    if (gi.weakBattThreshold != null) setText('thBattWeak', gi.weakBattThreshold.toFixed(1));
    if (gi.highBattThreshold != null) setText('thBattHigh', gi.highBattThreshold.toFixed(1));
  }
}

// ════════════════════════════════════════════════════════════════
//  INFO BAR
// ════════════════════════════════════════════════════════════════
let _gensetInfoFetched = false;

function renderInfoBar(derived) {
  if (!derived) return;
  if (derived.gensetInfo && !_gensetInfoFetched) {
    const gi = derived.gensetInfo;
    if (gi.modelNumber)  { setText('infoModel',  gi.modelNumber); _gensetInfoFetched = true; }
    if (gi.serialNumber) setText('infoSerial', gi.serialNumber);
  }
  const xferBadge = $('lastTransferBadge');
  if (xferBadge) {
    if (derived.lastTransferSec != null) {
      const sec = derived.lastTransferSec;
      const pass = sec <= 10;
      xferBadge.textContent = sec.toFixed(1) + 's';
      xferBadge.className = 'ib-val ib-badge ' + (pass ? 'pass' : 'fail');
      xferBadge.title = pass ? 'NFPA 110 ✅ passed' : '⚠️ Exceeds 10s NFPA110 limit';
    // } else { xferBadge.textContent = ''; xferBadge.className = 'ib-val ib-badge'; }
    }
  }
  const crankBadge = $('lastCrankBadge');
  if (crankBadge) {
    if (derived.lastCrankSec != null) {
      const sec = derived.lastCrankSec;
      crankBadge.textContent = sec.toFixed(1) + 's';
      crankBadge.className = 'ib-val ib-badge ' + (sec > 15 ? 'warn' : 'ok');
      crankBadge.title = sec > 15 ? '⚠️ Hard start (>15s)' : '✅ Normal crank';
    // } else { crankBadge.textContent = ''; crankBadge.className = 'ib-val ib-badge'; }
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  TRANSFER & CRANK LOG
// ════════════════════════════════════════════════════════════════
let _activeTab = 'xfer';

function switchTCTab(tab) {
  _activeTab = tab;
  const tabXfer  = $('tcTabXfer');
  const tabCrank = $('tcTabCrank');
  const panelXfer  = $('tcPanelXfer');
  const panelCrank = $('tcPanelCrank');
  if (tabXfer)    tabXfer.classList.toggle('active',  tab === 'xfer');
  if (tabCrank)   tabCrank.classList.toggle('active', tab === 'crank');
  if (panelXfer)  panelXfer.style.display  = tab === 'xfer'  ? '' : 'none';
  if (panelCrank) panelCrank.style.display = tab === 'crank' ? '' : 'none';
}

function renderTCLog(derived) {
  if (!derived) return;
  const xferList = $('transferLogList');
  if (xferList && derived.transferLog) {
    if (derived.transferLog.length === 0) {
      xferList.innerHTML = '<div class="tc-empty">No transfer events recorded yet</div>';
    } else {
      xferList.innerHTML = derived.transferLog.map(e => `
        <div class="tc-row ${e.passed ? 'pass' : 'fail'}">
          <span>${e.ts}</span><span>${e.durationSec}s</span><span>${e.passed ? '✅ Pass' : '⚠️ FAIL'}</span>
        </div>`).join('');
    }
  }
  const crankList = $('crankLogList');
  if (crankList && derived.crankLog) {
    if (derived.crankLog.length === 0) {
      crankList.innerHTML = '<div class="tc-empty">No crank events recorded yet</div>';
    } else {
      crankList.innerHTML = derived.crankLog.map(e => `
        <div class="tc-row ${e.hardStart ? 'warn' : 'pass'}">
          <span>${e.ts}</span><span>${e.durationSec}s</span><span>${e.hardStart ? '⚠️ Hard Start' : '✅ Normal'}</span>
        </div>`).join('');
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  ALL NEW FEATURES — called from render() and demo tick
// ════════════════════════════════════════════════════════════════
function renderNewFeatures(latest, derived) {
  const ac   = latest.ac || {};
  const vL1  = parseFloat(ac.voltL1N) || 0;
  const vL2  = parseFloat(ac.voltL2N) || 0;
  const vL3  = parseFloat(ac.voltL3N) || 0;
  const vAvg = (vL1 + vL2 + vL3) / 3;
  const voltUnbal = vAvg > 0
    ? Math.max(Math.abs(vL1 - vAvg), Math.abs(vL2 - vAvg), Math.abs(vL3 - vAvg)) / vAvg * 100
    : 0;

  const cL1  = parseFloat(ac.currL1) || 0;
  const cL2  = parseFloat(ac.currL2) || 0;
  const cL3  = parseFloat(ac.currL3) || 0;
  const cAvg = (cL1 + cL2 + cL3) / 3;
  const currUnbal = cAvg > 1
    ? Math.max(Math.abs(cL1 - cAvg), Math.abs(cL2 - cAvg), Math.abs(cL3 - cAvg)) / cAvg * 100
    : 0;

  const kvar = parseFloat(ac.kvarTotal) || 0;

  renderPowerQuality(voltUnbal, currUnbal, kvar);
  renderOutputStatus(latest, derived);
  renderInfoBar(derived);
  renderTCLog(derived);
    renderWarnStrip(latest);
}

// ════════════════════════════════════════════════════════════════
//  MAIN RENDER
// ════════════════════════════════════════════════════════════════
let lastState = null, lastFaultCode = 0;

function render(latest, history) {
  if (!latest) return;
  pushDayStore(latest);

  const ac   = latest.ac         || {};
  const eng  = latest.engine     || {};
  const elec = latest.electrical || {};
  const fuel = latest.fuel       || {};
  const util = latest.utility    || {};

 // ── State ─────────────────────────────────────────────────
  const stateLabel = latest.stateLabel || 'UNKNOWN';
  const heroState = $('heroState');
  if (heroState) {
    const freq  = parseFloat(ac.freq)    || 0;
    const rpm   = parseFloat(eng.rpm)    || 0;
    const kw    = parseFloat(ac.kwTotal) || 0;
    const vL1   = parseFloat(ac.voltL1N) || 0;

    const activeSensors = [freq > 0, rpm > 0, kw > 0, vL1 > 0]
      .filter(Boolean).length;

    const isActive = activeSensors >= 2;

    heroState.textContent = isActive ? stateLabel : 'STANDBY';

    let cls;
    if      (isActive && stateLabel === 'RUNNING')     cls = 'running';
    else if (isActive && stateLabel.includes('FAULT')) cls = 'fault';
    else if (isActive)                                 cls = 'standby';
    else                                               cls = 'stopped';

    heroState.className = `hero-val state-chip ${cls}`;
  }

  // ── Hero bar ──────────────────────────────────────────────
  setText('heroKW',     (parseFloat(ac.kwTotal)  || 0).toFixed(1) + ' kW');
  setText('heroKVA',    (parseFloat(ac.kvaTotal) || 0).toFixed(1) + ' kVA');
  setText('heroRPM',    parseFloat(eng.rpm || 0).toFixed(0));
  setText('heroFreq',   (parseFloat(ac.freq) || 0).toFixed(2) + ' Hz');
  setText('heroHours',  (parseFloat(eng.hours) || 0).toFixed(0) + ' h');
  setText('heroFuelPct', (fuel.pct || 0) + '%');
  const fuelBarEl = $('heroFuelBar');
  if (fuelBarEl) fuelBarEl.style.width = Math.min(100, parseInt(fuel.pct) || 0) + '%';

  // ── Voltage L-N ───────────────────────────────────────────
  const vL1 = parseFloat(ac.voltL1N) || 0;
  const vL2 = parseFloat(ac.voltL2N) || 0;
  const vL3 = parseFloat(ac.voltL3N) || 0;
  setF('vL1N', vL1, 1); setF('vL2N', vL2, 1); setF('vL3N', vL3, 1);

  // ── Voltage L-L ───────────────────────────────────────────
  setF('vL1L2', ac.voltL1L2, 1); setF('vL2L3', ac.voltL2L3, 1); setF('vL3L1', ac.voltL3L1, 1);

  // ── Frequency ─────────────────────────────────────────────
  setF('freqVal', parseFloat(ac.freq) || 0, 2);

  // ── Line Current ──────────────────────────────────────────
  setF('cL1', ac.currL1, 1); setF('cL2', ac.currL2, 1); setF('cL3', ac.currL3, 1);

  // ── Calculated Amps ───────────────────────────────────────
  const kw    = parseFloat(ac.kwTotal)  || 0;
  const kva   = parseFloat(ac.kvaTotal) || 0;
  const pf    = kva > 0.5 ? kw / kva : 0;
  const vAvg  = (vL1 + vL2 + vL3) / 3 || 230;
  const sqrt3 = 1.7321;
  const kwL1  = parseFloat(ac.kwL1) || kw / 3;
  const kwL2  = parseFloat(ac.kwL2) || kw / 3;
  const kwL3  = parseFloat(ac.kwL3) || kw / 3;
  const calcA = (kwVal, v, pfVal) => (!v || !pfVal) ? 0 : (kwVal * 1000) / (sqrt3 * v * pfVal);
  const aCalc1 = calcA(kwL1, vL1 || vAvg, pf || 0.88);
  const aCalc2 = calcA(kwL2, vL2 || vAvg, pf || 0.88);
  const aCalc3 = calcA(kwL3, vL3 || vAvg, pf || 0.88);
  setText('calcAmpsVal', (aCalc1 + aCalc2 + aCalc3).toFixed(1));
  setText('calcAL1', aCalc1.toFixed(1));
  setText('calcAL2', aCalc2.toFixed(1));
  setText('calcAL3', aCalc3.toFixed(1));

  // ── Current % ─────────────────────────────────────────────
  const cpL1 = parseFloat(ac.currPctL1) || 0;
  const cpL2 = parseFloat(ac.currPctL2) || 0;
  const cpL3 = parseFloat(ac.currPctL3) || 0;
  setText('cpL1', cpL1.toFixed(1) + '%'); setText('cpL2', cpL2.toFixed(1) + '%'); setText('cpL3', cpL3.toFixed(1) + '%');
  bar('cpL1bar', cpL1); bar('cpL2bar', cpL2); bar('cpL3bar', cpL3);

  // ── Power kW ──────────────────────────────────────────────
  setText('kwTotal', kw.toFixed(1));
  setF('kwL1', ac.kwL1, 1); setF('kwL2', ac.kwL2, 1); setF('kwL3', ac.kwL3, 1);
  const kwPct = Math.min(100, Math.abs(kw) / 320 * 100);
  bar('kwBar', kwPct); setText('kwPct', kwPct.toFixed(0) + '%');

  // ── Power kVA ─────────────────────────────────────────────
  setText('kvaTotal', kva.toFixed(1));
  setF('kvaL1', ac.kvaL1, 1); setF('kvaL2', ac.kvaL2, 1); setF('kvaL3', ac.kvaL3, 1);
  const kvaPct = Math.min(100, kva / 400 * 100);
  bar('kvaBar', kvaPct); setText('kvaPct', kvaPct.toFixed(0) + '%');

  // ── Power kVAR ────────────────────────────────────────────
  const kvar = parseFloat(ac.kvarTotal) || 0;
  setText('kvarTotal', kvar.toFixed(1));
  setF('kvarL1', ac.kvarL1, 1); setF('kvarL2', ac.kvarL2, 1); setF('kvarL3', ac.kvarL3, 1);

  // ── Power Factor ──────────────────────────────────────────
  setText('pfNum', pf.toFixed(3));
  setPFRing(pf);
  setText('pfStatus', pf >= 0.95 ? '✅ Excellent PF (>0.95)' : pf >= 0.9 ? '✅ Good PF (>0.90)' : pf >= 0.8 ? '⚠️ Marginal PF' : '❌ Poor PF — needs correction');
  const pfEl = $('pfNum'); if (pfEl) pfEl.style.color = pf >= 0.9 ? '#059669' : pf >= 0.75 ? '#D97706' : '#DC2626';

  // ── Engine RPM ────────────────────────────────────────────
  const rpm = parseFloat(eng.rpm) || 0;
  animateGauge('gRPM', rpm);
  setText('gvRPM', rpm.toFixed(0));
  setText('rpmStatus', rpm > 1490 && rpm < 1510 ? '🎯 Perfect 50Hz sync — 1500 RPM' : rpm > 100 ? '⚠️ Off nominal (target: 1500 RPM)' : '💤 Standstill');

  // ── Coolant Temp ──────────────────────────────────────────
  const ctF = parseFloat(eng.coolantTempF) || 32;
  const ctC = (ctF - 32) * 5 / 9;
  animateGauge('gTemp', ctC);
  setText('gvTemp', ctC.toFixed(1));
  const tEl = $('gvTemp'); if (tEl) tEl.style.color = ctC > 95 ? '#DC2626' : ctC > 80 ? '#D97706' : '#1A2340';
  setText('tempStatus', ctC > 95 ? '🔴 OVERHEATING — URGENT!' : ctC > 80 ? '⚠️ Elevated (warn at 95°C)' : '✅ Normal range (70–95°C)');
  setF('coolantF', ctF, 1);

  // ── Other Temps ───────────────────────────────────────────
  setF('oilTempF', eng.oilTempF, 1); setF('intakeTempF', eng.intakeTempF, 1);
  setF('fuelTempF', eng.fuelTempF, 1); setF('exhaustTempF', eng.exhaustTempF, 1);

  // ── Oil Pressure ──────────────────────────────────────────
  const oilPsi = parseFloat(eng.oilPressPsi) || 0;
  const oilKPa = (oilPsi * 6.895).toFixed(0);
  setText('oilPressKPa', oilKPa);
  setF('oilPressPsi', oilPsi, 1); setF('oilP2', oilPsi, 1);
  bar('oilBar', Math.min(100, oilPsi / 90 * 100));
  const oilEl = $('oilPressKPa'); if (oilEl) oilEl.style.color = oilPsi < 20 ? '#DC2626' : oilPsi > 90 ? '#DC2626' : '#1A2340';
  setText('oilStatus', oilPsi < 20 ? '🔴 LOW — SHUTDOWN RISK!' : oilPsi > 90 ? '⚠️ HIGH pressure' : oilPsi > 0 ? '✅ Normal: 200–600 kPa' : '💤 Standstill');

  // ── Pressures ─────────────────────────────────────────────
  setF('boostPsi', eng.boostPressPsi, 1); setF('crankcasePsi', eng.crankPressPsi, 2);
  setF('fuelSupplyPsi', eng.fuelPressPsi, 1); setF('coolantPsi', eng.coolantPsi, 1);

  // ── Battery ───────────────────────────────────────────────
  const bv = parseFloat(elec.battV) || 0;
  setF('battV', bv, 3);
  const battPct = Math.min(100, Math.max(0, ((bv - 10.5) / (14.8 - 10.5)) * 100));
  const bfEl = $('battFill'); if (bfEl) bfEl.style.width = battPct.toFixed(0) + '%';
  setText('battStatus', bv < 11.0 ? '🔴 CRITICAL — low battery!' : bv < 11.8 ? '⚠️ Low battery' : bv > 14.8 ? '⬆️ High — charging' : '✅ Normal (12V system)');
  setF('chargeAltV', elec.chargeAltV, 3); setF('torquePct', eng.torquePct, 0);
  const awEl = $('amberWarn');
  if (awEl) { const aw = parseInt(latest.amberWarn || 0); awEl.textContent = aw ? '🟡 ACTIVE' : '✅ Inactive'; awEl.style.color = aw ? '#D97706' : '#059669'; }

  // ── Hours ─────────────────────────────────────────────────
  const hrs = parseFloat(eng.hours) || 0;
  setText('engineHours', hrs.toFixed(0).padStart(6, '0'));
  setText('heroHours', hrs.toFixed(0) + ' h');
  setF('startAttempts', latest.startAttempts || 0, 0);
  const nextSvc = Math.ceil((hrs + 1) / 500) * 500;
  setText('nextService', `${nextSvc}h (in ${(nextSvc - hrs).toFixed(0)}h)`);
  setText('canStatus', latest.canStatusLabel || '—');
  setText('ecmState', latest.engineOpStateLabel || '—');

  // ── Switch & ECM ──────────────────────────────────────────
  const swLabels = ['🔴 Off', '🟢 Auto', '🔵 Manual'];
  setText('switchPos', 'Switch: ' + (swLabels[parseInt(latest.switchPos || 0)] || '—'));
  setText('engineOpChip', 'ECM: ' + (latest.engineOpStateLabel || '—'));

  // ── State LED ─────────────────────────────────────────────
  const ledEl = $('stateLed');
  const cls2  = stateLabel === 'RUNNING' ? 'running' : stateLabel.includes('FAULT') ? 'fault' : 'stopped';
  if (ledEl) ledEl.className = `state-led ${cls2}`;
  setText('stateName', stateLabel);
  setText('stateNote', `Fault code: 0x${(latest.faultCode || 0).toString(16).toUpperCase().padStart(4, '0')}`);

  // ── Active Fault ──────────────────────────────────────────
  const fc   = parseInt(latest.faultCode) || 0;
  const fsev = parseInt(latest.faultSeverity) || 0;
  const hasFault = fc !== 0;
  const fb = $('faultBanner'); if (fb) fb.className = 'fault-banner' + (hasFault ? ' active' : '');
  setText('faultIcon', hasFault ? '🚨' : '✅');
  setText('faultText', hasFault ? `⚠️ FAULT ACTIVE — Code ${fc}` : '✅ No active faults — All good!');
  setText('faultCode', `0x${fc.toString(16).toUpperCase().padStart(4, '0')}`);
  const sevLabels = ['None', '⚠️ Warning', '🔴 Shutdown'];
  setText('faultSeverity', sevLabels[fsev] || 'Unknown');

// ════════════════════════════════════════════════════════════════
//  FUEL RENDER — Replace the entire "── Fuel ──" block in render()

const fpct    = parseInt(fuel.pct) || 0;
const fLitres = (fuel.litres != null && !isNaN(parseFloat(fuel.litres)) && parseFloat(fuel.litres) > 0)
  ? Math.round(parseFloat(fuel.litres))
  : Math.round(fpct * TANK_CAPACITY / 100); // fallback only if PLC litres register unavailable
const fEmpty  = TANK_CAPACITY - fLitres;

// --- Session tracking (stored in window so it persists across render() calls) ---
// --- Session tracking pinned to real midnight (server-sourced) ---
const todayKey = _todayKeyIST();
if (window._fuelDayKey !== todayKey) {
  fetchTodayStartFuel(); // async — fills in window._fuelSessionStart when ready
}

const sessionReady       = window._fuelSessionStart != null;
const sessionStartL      = sessionReady ? window._fuelSessionStart    : null;
const sessionStartPct    = sessionReady ? window._fuelSessionStartPct : null;
const sessionConsumed    = sessionReady ? Math.max(0, sessionStartL - fLitres)   : null;
const sessionConsumedPct = sessionReady ? Math.max(0, sessionStartPct - fpct)    : null;
// --- Current load ---
const kw_fuel = parseFloat(ac.kwTotal) || 0;
const loadPct_fuel = Math.min(100, Math.round(kw_fuel / 320 * 100));

// --- Expected burn rate based on load (OEM spec) ---
let expectedBurn = 10; // no load
let activeRow = 'lbtRow0';
if (loadPct_fuel >= 87) {
  expectedBurn = 87;
  activeRow = 'lbtRow100';
} else if (loadPct_fuel >= 62) {
  expectedBurn = 66;
  activeRow = 'lbtRow75';
} else if (loadPct_fuel >= 37) {
  expectedBurn = 43.2;
  activeRow = 'lbtRow50';
} else if (loadPct_fuel >= 12) {
  expectedBurn = 23.6;
  activeRow = 'lbtRow25';
}

// --- Actual burn rate calculation ---
// --- Actual burn rate calculation ---
const fuelHistory = dayStore.fuelPct;
const tsHistory   = dayStore.timestamps;
let actualBurnRate = 0;
if (fuelHistory.length > 10) {
  const windowSize = Math.min(30, fuelHistory.length);
  const oldest    = fuelHistory[fuelHistory.length - windowSize];
  const newest    = fuelHistory[fuelHistory.length - 1];
  const oldestTs  = tsHistory[tsHistory.length - windowSize];
  const newestTs  = tsHistory[tsHistory.length - 1];
  const deltaLitres = (oldest - newest) * TANK_CAPACITY / 100;
  const parseSec = s => {
    const p = String(s).split(':').map(Number);
    return (p.length >= 3 && !p.some(isNaN)) ? p[0] * 3600 + p[1] * 60 + p[2] : null;
  };
  const t0 = parseSec(oldestTs);
  const t1 = parseSec(newestTs);
  let deltaHrs = 0;
  if (t0 !== null && t1 !== null) {
    let diff = t1 - t0;
    if (diff < 0) diff += 86400;
    deltaHrs = diff / 3600;
  }
  actualBurnRate = deltaHrs > 0.001 && deltaLitres > 0 ? deltaLitres / deltaHrs : 0;
}

const burnForRuntime = actualBurnRate > 0 ? actualBurnRate : expectedBurn;
const hoursLeft = burnForRuntime > 0 ? fLitres / burnForRuntime : 0;
const engHours = parseFloat(eng.hours) || 0; // lifetime meter — kept for other fields, do not remove


const acOutputPresent = vL1 > 5 || vL2 > 5 || vL3 > 5 || kw_fuel > 0.5;
const isRunningNow = acOutputPresent;
const engHoursToday = updateEngineHoursToday(isRunningNow);

// Push to the "Engine Hours Today" card
const engHrsWhole = Math.floor(engHoursToday);
const engMinsPart = Math.round((engHoursToday - engHrsWhole) * 60);
setText('fuelEngHours', `${engHrsWhole}h ${engMinsPart}m`);

// ── Session Strip ──────────────────────────────────────────────
setText('fuelSessionStart',    sessionReady ? sessionStartL + ' L' : '— (loading baseline)');
setText('fuelSessionStartPct', sessionReady ? sessionStartPct + '%' : '—');
setText('fuelCurrentStock',    fLitres          + ' L');
setText('fuelCurrentPct',      fpct             + '%');
setText('fuelConsumedSession', sessionReady ? sessionConsumed + ' L' : '—');
setText('fuelConsumedPct',     sessionReady ? sessionConsumedPct.toFixed(0) + '%' : '—');

// ── Tank Visual ────────────────────────────────────────────────
const tank3dEl = $('tank3dFill');
if (tank3dEl) {
  const fillH = 174 * Math.min(100, fpct) / 100;
  tank3dEl.setAttribute('y', 197 - fillH);
  tank3dEl.setAttribute('height', fillH);
}
setText('tank3dPct',   fpct + '%');
setText('tank3dLitres', fLitres + ' L');

// Horizontal bar
const tlbEl = $('tankLevelBar');
if (tlbEl) tlbEl.style.width = Math.min(100, fpct) + '%';
if (tlbEl) {
  tlbEl.style.background = fpct < 25
    ? 'linear-gradient(90deg,#DC2626,#F87171)'
    : fpct < 50
    ? 'linear-gradient(90deg,#D97706,#FCD34D)'
    : 'linear-gradient(90deg,#059669,#34D399)';
}

// Stats column
const tscPctEl = $('tscPct');
if (tscPctEl) { tscPctEl.textContent = fpct + '%'; tscPctEl.className = 'tsc-val mono' + (fpct < 25 ? ' red' : fpct < 50 ? ' amber' : ' green'); }
const tscLEl = $('tscLitres');
if (tscLEl) { tscLEl.textContent = fLitres + ' L'; tscLEl.className = 'tsc-val mono' + (fpct < 25 ? ' red' : fpct < 50 ? ' amber' : ' green'); }
setText('tscEmpty', fEmpty + ' L');
const badge = $('tscStatusBadge');
if (badge) {
  if (fpct < 25) {
    badge.textContent = '🔴 Critical — Refuel Immediately!';
    badge.className = 'tsc-status-badge danger';
  } else if (fpct < 50) {
    badge.textContent = '⚠️ Low — Schedule Refuel Soon';
    badge.className = 'tsc-status-badge warn';
  } else {
    badge.textContent = '✅ Normal Level — Sufficient Fuel';
    badge.className = 'tsc-status-badge ok';
  }
}

// ── Burn Rate ──────────────────────────────────────────────────
setText('burnRateVal', actualBurnRate > 0 ? actualBurnRate.toFixed(1) : '—');
setText('burnRateExpected', expectedBurn.toFixed(1));

// Highlight active load row
['lbtRow0','lbtRow25','lbtRow50','lbtRow75','lbtRow100'].forEach(id => {
  const el = $(id);
  if (el) el.className = 'lbt-row' + (id === activeRow ? ' active-row' : '');
});

const brdStatus = $('burnRateStatus');
if (brdStatus && actualBurnRate > 0) {
  const ratio = actualBurnRate / expectedBurn;
  if (ratio > 1.2) {
    brdStatus.textContent = '🔴 High — ' + ((ratio - 1) * 100).toFixed(0) + '% above expected';
    brdStatus.className = 'brd-status danger';
  } else if (ratio > 1.05) {
    brdStatus.textContent = '⚠️ Slightly elevated burn';
    brdStatus.className = 'brd-status warn';
  } else {
    brdStatus.textContent = '✅ Normal — within OEM spec';
    brdStatus.className = 'brd-status ok';
  }
} else if (brdStatus) {
  brdStatus.textContent = 'Calculating…';
  brdStatus.className = 'brd-status';
}

// ── Runtime Estimate ──────────────────────────────────────────
const rtbEl = $('rtb-number') || $('runtimeHours');
if ($('runtimeHours')) {
  $('runtimeHours').textContent = hoursLeft > 0 ? Math.round(hoursLeft) + '' : '—';
  $('runtimeHours').style.color = hoursLeft < 2 ? '#DC2626' : hoursLeft < 4 ? '#D97706' : '#2563EB';
}
setText('runtimeSub', actualBurnRate > 0
  ? `at ${actualBurnRate.toFixed(1)} L/hr actual burn`
  : `at ${expectedBurn.toFixed(1)} L/hr expected burn`);

setText('rbdFuelLeft',     fLitres + '');
setText('rbdBurnActual',   actualBurnRate > 0 ? actualBurnRate.toFixed(1) : '—');
setText('rbdBurnExpected', expectedBurn.toFixed(1));
setText('rbdLoad',         kw_fuel.toFixed(1));
setText('rbdHours',        engHours.toFixed(0));

// Update rbd-unit for load row
const rbdLoadRow = $('rbdLoad');
if (rbdLoadRow && rbdLoadRow.parentElement) {
  const unitEl = rbdLoadRow.parentElement.querySelector('.rbd-unit');
  if (unitEl) unitEl.textContent = 'kW (' + loadPct_fuel + '% of rated)';
}

// Refuel alerts
const alertEl = $('refuelAlert');
const warnEl  = $('refuelWarn');
if (alertEl) alertEl.style.display = hoursLeft > 0 && hoursLeft < 2  ? '' : 'none';
if (warnEl)  warnEl.style.display  = hoursLeft > 0 && hoursLeft >= 2 && hoursLeft < 4 ? '' : 'none';

// ── Legacy fields (keep for detail overlay compatibility) ──────
setF('fuelPct', fpct, 0);
setText('fuelLitres', fLitres);
setText('tankPctLabel', fpct + '%');
const tfEl2 = $('tankFill'); if (tfEl2) tfEl2.style.height = Math.min(100, fpct) + '%';
setText('fuelRemainL', fLitres);
setText('fuelBurnRate', actualBurnRate > 0 ? actualBurnRate.toFixed(1) : '—');
setText('fuelHrsLeft',  hoursLeft > 0 ? Math.round(hoursLeft) + '' : '—');

// ── Fuel Charts ────────────────────────────────────────────────
if (dayStore.fuelPct.length > 1) {
  fuelChart.data.labels = dayStore.timestamps.slice(-60);
  fuelChart.data.datasets[0].data = dayStore.fuelPct.slice(-60);
  fuelChart.data.datasets[1].data = dayStore.fuelLitres.slice(-60);
  throttledChartUpdate(fuelChart);
}
  // ── Trend Charts ──────────────────────────────────────────
  if (history) {
    trendChart.data.labels = history.timestamps;
    trendChart.data.datasets[0].data = history.kwTotal;
    trendChart.data.datasets[1].data = history.coolantTempF.map(f => +((f - 32) * 5 / 9).toFixed(1));
    trendChart.data.datasets[2].data = history.engineRPM.map(r => r / 10);
    trendChart.data.datasets[3].data = history.fuelLevelPct;
    throttledChartUpdate(trendChart);
  } else if (dayStore.kwTotal.length > 1) {
    trendChart.data.labels = dayStore.timestamps.slice(-60);
    trendChart.data.datasets[0].data = dayStore.kwTotal.slice(-60);
    trendChart.data.datasets[1].data = dayStore.coolantTempC.slice(-60);
    trendChart.data.datasets[2].data = dayStore.rpm.slice(-60).map(r => r / 10);
    trendChart.data.datasets[3].data = dayStore.fuelPct.slice(-60);
    throttledChartUpdate(trendChart);
  }

  if (dayStore.fuelPct.length > 1) {
    fuelChart.data.labels = dayStore.timestamps.slice(-60);
    fuelChart.data.datasets[0].data = dayStore.fuelPct.slice(-60);
    fuelChart.data.datasets[1].data = dayStore.fuelLitres.slice(-60);
    throttledChartUpdate(fuelChart);
  }

  // ── Footer ────────────────────────────────────────────────
  setText('lastUpdate', '⏱️ Last update: ' + new Date(latest.serverTime || Date.now()).toLocaleTimeString('en-IN', { hour12: false }));

  // ── Log state changes ─────────────────────────────────────
  if (stateLabel !== lastState) {
    logEvent(`⚙️ State → ${stateLabel}`, stateLabel === 'RUNNING' ? 'ok' : stateLabel.includes('FAULT') ? 'error' : 'warn');
    lastState = stateLabel;
  }
  if (hasFault && fc !== lastFaultCode) {
    logEvent(`🚨 Fault 0x${fc.toString(16).toUpperCase()} (${sevLabels[fsev]})`, 'error');
    lastFaultCode = fc;
  }

  // Push to detail overlay if open
  if (window.gsDetailPush) window.gsDetailPush(latest);
}
    
// ════════════════════════════════════════════════════════════════
//  SOCKET.IO EVENTS
// ════════════════════════════════════════════════════════════════
if (socket) {
  socket.on('connect', () => {
    const b = $('connBadge'); if (b) b.className = 'conn-badge live';
    setText('connLabel', '🟢 Live');
    logEvent('🔌 WebSocket connected', 'ok');
  });
  socket.on('disconnect', () => {
    const b = $('connBadge'); if (b) b.className = 'conn-badge err';
    setText('connLabel', '🔴 Disconnected');
    logEvent('❌ WebSocket disconnected', 'error');
  });
  socket.on('genset:update', ({ latest, history, derived }) => {
    try {
      render(latest, history);
      renderNewFeatures(latest, derived);
    } catch(e) { console.error('[render]', e); }
  });
  socket.on('clients:count', c => setText('clientCount', `👥 Clients: ${c}`));
}

// ════════════════════════════════════════════════════════════════
//  DETAIL OVERLAY — Full-page drill-down with date-range graphs
// ════════════════════════════════════════════════════════════════
(function () {

  const STYLE = `
  #gsDetailOverlay {
    display: none; position: fixed; inset: 0; z-index: 9999;
    background: #F0F4FF; font-family: 'Nunito','Segoe UI',sans-serif;
    color: #1A2340; overflow-y: auto;
  }
  #gsDetailOverlay.open { display: flex; flex-direction: column; }
  .gsd-topbar {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 28px; background: #fff;
    border-bottom: 2px solid #E2E8F5;
    position: sticky; top: 0; z-index: 10;
    box-shadow: 0 2px 12px rgba(37,99,235,.07);
    flex-wrap: wrap; gap: 10px;
  }
  .gsd-back-btn {
    display: flex; align-items: center; gap: 7px;
    background: #F0F4FF; border: 1.5px solid #C8D5EF;
    color: #4A5568; padding: 8px 16px; border-radius: 8px;
    cursor: pointer; font-family: inherit; font-size: .82rem;
    font-weight: 800; transition: all .18s; white-space: nowrap;
  }
  .gsd-back-btn:hover { background: #E2E8F5; color: #1A2340; }
  .gsd-section-title { font-size: 1.1rem; font-weight: 900; flex: 1; color: #1A2340; }
  .gsd-live-badge {
    display: flex; align-items: center; gap: 6px;
    background: rgba(5,150,105,.1); border: 1.5px solid #059669;
    color: #059669; padding: 5px 12px; border-radius: 20px;
    font-size: .72rem; font-weight: 800;
  }
  .gsd-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #059669; animation: gsPulse 1.4s infinite; }
  @keyframes gsPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .gsd-datebar {
    display: flex; align-items: center; gap: 10px;
    flex-wrap: wrap; padding: 12px 28px;
    background: #fff; border-bottom: 1.5px solid #E2E8F5;
  }
  .gsd-datebar label { font-size: .70rem; font-weight: 800; color: #8A9BB5; letter-spacing: .08em; text-transform: uppercase; }
  .gsd-datebar input[type=date] {
    background: #F8FAFF; border: 1.5px solid #C8D5EF;
    color: #1A2340; padding: 7px 12px; border-radius: 8px;
    font-family: 'JetBrains Mono', monospace; font-size: .82rem; outline: none; cursor: pointer;
  }
  .gsd-datebar input[type=date]:focus { border-color: #2563EB; }
  .gsd-fetch-btn { background: #2563EB; color: #fff; border: none; padding: 8px 20px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: .82rem; font-weight: 800; transition: background .18s; }
  .gsd-fetch-btn:hover { background: #1D4ED8; }
  .gsd-preset-btn { background: #F0F4FF; color: #4A5568; border: 1.5px solid #C8D5EF; padding: 7px 13px; border-radius: 7px; cursor: pointer; font-family: inherit; font-size: .75rem; font-weight: 700; transition: all .18s; }
  .gsd-preset-btn:hover { background: #E2E8F5; color: #1A2340; }
  .gsd-pts-label { margin-left: auto; font-size: .72rem; font-family: 'JetBrains Mono', monospace; color: #8A9BB5; }
  .gsd-trend-bar { display: flex; align-items: center; gap: 8px; padding: 12px 28px; background: #F8FAFF; border-bottom: 1.5px solid #E2E8F5; flex-wrap: wrap; }
  .gsd-trend-lbl { font-size: .68rem; font-weight: 800; color: #8A9BB5; text-transform: uppercase; letter-spacing: .08em; margin-right: 4px; white-space: nowrap; }
  .gsd-trend-btn { padding: 5px 14px; border-radius: 20px; border: 1.5px solid #C8D5EF; background: #fff; color: #4A5568; font-family: inherit; font-size: .75rem; font-weight: 700; cursor: pointer; transition: all .18s; white-space: nowrap; }
  .gsd-trend-btn:hover { border-color: #2563EB; color: #2563EB; }
  .gsd-trend-btn.active { background: #2563EB; border-color: #2563EB; color: #fff; }
  .gsd-stats-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; padding: 20px 28px; }
  .gsd-stat-card { background: #fff; border: 1.5px solid #E2E8F5; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 6px rgba(37,99,235,.05); }
  .gsd-stat-param { font-size: .68rem; font-weight: 800; color: #8A9BB5; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
  .gsd-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
  .gsd-sv { font-size: .68rem; color: #8A9BB5; }
  .gsd-sn { font-size: .88rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: #1A2340; }
  .gsd-sn.cur { color: #059669; font-size: 1rem; }
  .gsd-charts-area { padding: 0 28px 80px; display: flex; flex-direction: column; gap: 20px; }
  .gsd-chart-panel { background: #fff; border: 1.5px solid #E2E8F5; border-radius: 16px; padding: 20px 22px; box-shadow: 0 1px 8px rgba(37,99,235,.05); }
  .gsd-chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .gsd-chart-title { font-size: .92rem; font-weight: 900; color: #1A2340; }
  .gsd-chart-wrap { position: relative; height: 240px; }
  .gsd-chart-wrap.tall { height: 300px; }
  .gsd-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px; color: #8A9BB5; font-size: .9rem; }
  .gsd-spinner { width: 36px; height: 36px; border: 3px solid #E2E8F5; border-top-color: #2563EB; border-radius: 50%; animation: gsSpin .7s linear infinite; }
  @keyframes gsSpin { to { transform: rotate(360deg) } }
  @media (max-width: 768px) {
    .gsd-topbar, .gsd-datebar, .gsd-stats-row, .gsd-charts-area, .gsd-trend-bar { padding-left: 14px; padding-right: 14px; }
    .gsd-chart-wrap { height: 200px; }
    .gsd-chart-wrap.tall { height: 240px; }
    .gsd-stats-row { grid-template-columns: repeat(2, 1fr); }
    .gsd-section-title { font-size: .95rem; }
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  const overlayEl = document.getElementById('gsDetailOverlay');
  overlayEl.innerHTML = `
    <div class="gsd-topbar">
      <button class="gsd-back-btn" id="gsdBackBtn">← Back</button>
      <span class="gsd-section-icon" id="gsdIcon"></span>
      <span class="gsd-section-title" id="gsdTitle"></span>
      <span class="gsd-live-badge"><span class="gsd-live-dot"></span>LIVE</span>
      <button class="gsd-csv-btn" id="gsdCsvBtn"></button></button>
    </div>
    <div class="gsd-datebar">
      <label>FROM</label><input type="date" id="gsdFrom">
      <label>TO</label><input type="date" id="gsdTo">
      <button class="gsd-preset-btn" data-preset="today">Today</button>
      <button class="gsd-preset-btn" data-preset="7d">Last 7d</button>
      <button class="gsd-preset-btn" data-preset="30d">Last 30d</button>
      <button class="gsd-fetch-btn" id="gsdFetchBtn">⬇ Fetch</button>
      <span class="gsd-pts-label" id="gsdPtsLabel"></span>
    </div>
    <div class="gsd-trend-bar">
      <span class="gsd-trend-lbl">📊 Show trend:</span>
      <div id="gsdTrendBtns"></div>
    </div>
    <div id="gsdBody"></div>
  `;

  // ── Section definitions ────────────────────────────────────
  const SECTIONS = {
    alternator: {
      icon: '⚡', title: 'Alternator Output',
      statsKeys: [
        { key: 'voltL1N',   label: 'Voltage L1-N',  unit: 'V',    dec: 1 },
        { key: 'voltL2N',   label: 'Voltage L2-N',  unit: 'V',    dec: 1 },
        { key: 'voltL3N',   label: 'Voltage L3-N',  unit: 'V',    dec: 1 },
        { key: 'kwTotal',   label: 'Active Power',   unit: 'kW',   dec: 1 },
        { key: 'kvaTotal',  label: 'Apparent Power', unit: 'kVA',  dec: 1 },
        { key: 'kvarTotal', label: 'Reactive Power', unit: 'kVAR', dec: 1 },
        { key: 'frequency', label: 'Frequency',      unit: 'Hz',   dec: 2 },
        { key: 'pf',        label: 'Power Factor',   unit: '',     dec: 3 }
      ],
      trends: [
        { id: 'all', label: 'All Trends' }, { id: 'volt', label: 'Voltage L-N' },
        { id: 'voltll', label: 'Voltage L-L' }, { id: 'curr', label: 'Current (A)' },
        { id: 'power', label: 'kW / kVA / kVAR' }, { id: 'freqpf', label: 'Freq & PF' }
      ],
      charts: [
        { id: 'alt_volt_ln',  trendId: 'volt',   title: 'Voltage L-N (V)',              tall: false, datasets: [{ label: 'L1-N', key: 'voltL1N', color: '#2563EB' }, { label: 'L2-N', key: 'voltL2N', color: '#7C3AED' }, { label: 'L3-N', key: 'voltL3N', color: '#EA580C' }] },
        { id: 'alt_volt_ll',  trendId: 'voltll', title: 'Voltage L-L (V)',              tall: false, datasets: [{ label: 'L1-L2', key: 'voltL1L2', color: '#2563EB' }, { label: 'L2-L3', key: 'voltL2L3', color: '#7C3AED' }, { label: 'L3-L1', key: 'voltL3L1', color: '#EA580C' }] },
        { id: 'alt_curr',     trendId: 'curr',   title: 'Line Current (A)',             tall: false, datasets: [{ label: 'L1', key: 'currL1', color: '#2563EB' }, { label: 'L2', key: 'currL2', color: '#7C3AED' }, { label: 'L3', key: 'currL3', color: '#EA580C' }] },
        { id: 'alt_power',    trendId: 'power',  title: 'Power kW / kVA / kVAR',       tall: true,  datasets: [{ label: 'kW', key: 'kwTotal', color: '#059669' }, { label: 'kVA', key: 'kvaTotal', color: '#2563EB' }, { label: 'kVAR', key: 'kvarTotal', color: '#7C3AED' }] },
        { id: 'alt_freq_pf',  trendId: 'freqpf', title: 'Frequency (Hz) & Power Factor', tall: false, dualAxis: true, datasets: [{ label: 'Freq (Hz)', key: 'frequency', color: '#D97706', yAxis: 'yL' }, { label: 'PF', key: 'pf', color: '#059669', yAxis: 'yR' }] }
      ]
    },
    engine: {
      icon: '🔧', title: 'Engine Health',
      statsKeys: [
        { key: 'engineRPM',     label: 'Engine RPM',     unit: 'RPM', dec: 0 },
        { key: 'coolantTempF',  label: 'Coolant Temp',   unit: '°F',  dec: 1 },
        { key: 'oilPressPsi',   label: 'Oil Pressure',   unit: 'psi', dec: 1 },
        { key: 'exhaustTempF',  label: 'Exhaust Temp',   unit: '°F',  dec: 1 },
        { key: 'oilTempF',      label: 'Oil Temp',       unit: '°F',  dec: 1 },
        { key: 'boostPressPsi', label: 'Boost Pressure', unit: 'psi', dec: 1 },
        { key: 'battV',         label: 'Battery Voltage',unit: 'V',   dec: 3 },
        { key: 'torquePct',     label: 'Torque %',       unit: '%',   dec: 0 }
      ],
      trends: [
        { id: 'all', label: 'All Trends' }, { id: 'rpm', label: 'RPM' },
        { id: 'temps', label: 'Temperatures' }, { id: 'press', label: 'Pressures' },
        { id: 'torque', label: 'Torque & Battery' }
      ],
      charts: [
        { id: 'eng_rpm',    trendId: 'rpm',    title: 'Engine Speed (RPM)',          tall: false, datasets: [{ label: 'RPM', key: 'engineRPM', color: '#D97706' }] },
        { id: 'eng_temps',  trendId: 'temps',  title: 'All Temperature Sensors (°F)', tall: true,  datasets: [{ label: 'Coolant', key: 'coolantTempF', color: '#2563EB' }, { label: 'Oil', key: 'oilTempF', color: '#D97706' }, { label: 'Intake', key: 'intakeTempF', color: '#059669' }, { label: 'Fuel', key: 'fuelTempF', color: '#7C3AED' }, { label: 'Exhaust', key: 'exhaustTempF', color: '#DC2626' }] },
        { id: 'eng_press',  trendId: 'press',  title: 'Pressure Sensors (psi)',     tall: false, datasets: [{ label: 'Oil', key: 'oilPressPsi', color: '#D97706' }, { label: 'Boost', key: 'boostPressPsi', color: '#2563EB' }, { label: 'Crankcase', key: 'crankPressPsi', color: '#7C3AED' }, { label: 'Fuel', key: 'fuelSupplyPsi', color: '#059669' }, { label: 'Coolant', key: 'coolantPsi', color: '#DC2626' }] },
        { id: 'eng_torque', trendId: 'torque', title: 'Torque % & Battery Voltage', tall: false, dualAxis: true, datasets: [{ label: 'Torque (%)', key: 'torquePct', color: '#D97706', yAxis: 'yL' }, { label: 'Batt V', key: 'battV', color: '#059669', yAxis: 'yR' }] }
      ]
    },
   fuel: {
      icon: '⛽', title: 'Fuel System — Tank: 785 L',
      statsKeys: [
        { key: 'fuelLevelPct',  label: 'Tank Level',          unit: '%',   dec: 0 },
        { key: 'fuelLevelL',    label: 'Volume (Litres)',      unit: 'L',   dec: 0 },
        { key: 'fuelSupplyPsi', label: 'Supply Pressure',      unit: 'psi', dec: 1 },
        { key: 'fuelTempF',     label: 'Fuel Temperature',     unit: '°F',  dec: 1 },
        { key: 'kwTotal',       label: 'Generator Load',       unit: 'kW',  dec: 1 },
      ],
      trends: [
        { id: 'all',    label: 'All Trends'    },
        { id: 'level',  label: 'Tank Level'    },
        { id: 'litres', label: 'Volume (L)'    },
        { id: 'press',  label: 'Fuel Pressure' },
        { id: 'temp',   label: 'Fuel Temp'     },
        { id: 'load',   label: 'Generator Load'},
      ],
      charts: [
        {
          id: 'fuel_level_pct',
          trendId: 'level',
          title: 'Tank Level % — How full is the 785L tank over time',
          tall: false, fill: true,
          datasets: [{ label: 'Fuel Level (%)', key: 'fuelLevelPct', color: '#059669', fill: true }]
        },
        {
          id: 'fuel_litres',
          trendId: 'litres',
          title: 'Fuel Volume (Litres) — Actual litres remaining in tank',
          tall: false, fill: true,
          datasets: [{ label: 'Litres remaining', key: 'fuelLevelL', color: '#2563EB', fill: true }]
        },
        {
          id: 'fuel_press',
          trendId: 'press',
          title: 'Fuel Supply Pressure (psi) — Pressure from tank to engine',
          tall: false,
          datasets: [{ label: 'Supply pressure (psi)', key: 'fuelSupplyPsi', color: '#D97706' }]
        },
        {
          id: 'fuel_temp',
          trendId: 'temp',
          title: 'Fuel Temperature (°F) — Higher temp = lower energy density',
          tall: false,
          datasets: [{ label: 'Fuel temp (°F)', key: 'fuelTempF', color: '#7C3AED' }]
        },
        {
          id: 'fuel_load',
          trendId: 'load',
          title: 'Generator Load (kW) — Higher load = faster fuel consumption',
          tall: false,
          datasets: [{ label: 'Load (kW)', key: 'kwTotal', color: '#DC2626' }]
        },
      ]
    },
    mains: {
      icon: '🏙️', title: 'Mains / City Power',
      statsKeys: [
        { key: 'utilVoltL1N',   label: 'Utility L1-N', unit: 'V',  dec: 1 },
        { key: 'utilVoltL2N',   label: 'Utility L2-N', unit: 'V',  dec: 1 },
        { key: 'utilVoltL3N',   label: 'Utility L3-N', unit: 'V',  dec: 1 },
        { key: 'utilFrequency', label: 'Utility Freq', unit: 'Hz', dec: 3 },
        { key: 'amfState',      label: 'AMF State',    unit: '',   dec: 0 },
        { key: 'xferSwStatus',  label: 'Transfer SW',  unit: '',   dec: 0 }
      ],
      trends: [
        { id: 'all', label: 'All Trends' }, { id: 'voltln', label: 'Voltage L-N' },
        { id: 'voltll', label: 'Voltage L-L' }, { id: 'freq', label: 'Frequency' },
        { id: 'amf', label: 'AMF / Transfer' }
      ],
      charts: [
        { id: 'util_volt_ln', trendId: 'voltln', title: 'Utility Voltage L-N (V)', tall: false, datasets: [{ label: 'L1-N', key: 'utilVoltL1N', color: '#2563EB' }, { label: 'L2-N', key: 'utilVoltL2N', color: '#7C3AED' }, { label: 'L3-N', key: 'utilVoltL3N', color: '#EA580C' }] },
        { id: 'util_volt_ll', trendId: 'voltll', title: 'Utility Voltage L-L (V)', tall: false, datasets: [{ label: 'L1-L2', key: 'utilVoltL1L2', color: '#2563EB' }, { label: 'L2-L3', key: 'utilVoltL2L3', color: '#7C3AED' }, { label: 'L3-L1', key: 'utilVoltL3L1', color: '#EA580C' }] },
        { id: 'util_freq',    trendId: 'freq',   title: 'Utility Frequency (Hz)',  tall: false, datasets: [{ label: 'Utility Hz', key: 'utilFrequency', color: '#059669' }] },
        { id: 'util_amf',     trendId: 'amf',    title: 'AMF State & Transfer Switch', tall: false, datasets: [{ label: 'AMF State', key: 'amfState', color: '#D97706' }, { label: 'Transfer SW', key: 'xferSwStatus', color: '#DC2626' }] }
      ]
    },
    status: {
      icon: '🚨', title: 'Status & Faults',
      statsKeys: [
        { key: 'gensetState',  label: 'Genset State', unit: '', dec: 0 },
        { key: 'faultCode',    label: 'Fault Code',   unit: '', dec: 0 },
        { key: 'amfState',     label: 'AMF State',    unit: '', dec: 0 },
        { key: 'xferSwStatus', label: 'Transfer SW',  unit: '', dec: 0 }
      ],
      trends: [
        { id: 'all', label: 'All Trends' }, { id: 'state', label: 'Genset State' },
        { id: 'fault', label: 'Fault Code' }, { id: 'amf', label: 'AMF / Transfer' }
      ],
      charts: [
        { id: 'st_state', trendId: 'state', title: 'Genset State Over Time',   tall: false, bar: true, datasets: [{ label: 'State Code',  key: 'gensetState',  color: '#2563EB' }] },
        { id: 'st_fault', trendId: 'fault', title: 'Fault Code Over Time',     tall: false, bar: true, datasets: [{ label: 'Fault Code',  key: 'faultCode',    color: '#DC2626' }] },
        { id: 'st_amf',   trendId: 'amf',   title: 'AMF State & Transfer SW', tall: false, bar: true, datasets: [{ label: 'AMF State', key: 'amfState', color: '#D97706' }, { label: 'Transfer SW', key: 'xferSwStatus', color: '#7C3AED' }] }
      ]
    }
  };

 function applyEngTrend(trend) {
  const btn = document.querySelector(`.gsd-trend-btn[data-trend="${trend}"]`);
  if (btn) btn.click();
}

  // ── Chart instances ────────────────────────────────────────
  const detailCharts = {};
  function destroyDetailCharts() {
    Object.values(detailCharts).forEach(c => c.destroy());
    Object.keys(detailCharts).forEach(k => delete detailCharts[k]);
  }

  let currentSection = null;
  let currentData    = null;
  let activeTrend    = 'all';
  let currentIsRange = false;

 function xScale() {
    return { ticks: { font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 48, color: '#8A9BB5' }, grid: { color: 'rgba(37,99,235,.06)' } };
  }

  function yScale(pos = 'left') {
    return { position: pos, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { color: pos === 'left' ? 'rgba(37,99,235,.06)' : 'transparent' } };
  }

  function computeStats(arr) {
    const v = (arr || []).filter(x => typeof x === 'number' && !isNaN(x) && x !== 0);
    if (!v.length) return { min: 0, max: 0, avg: 0, last: 0 };
    return { min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3), avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3), last: +v[v.length - 1].toFixed(3) };
  }

  function elapsedHoursFromTimestamps(ts) {
  if (!ts || ts.length < 2) return 0;
  const parseSec = s => {
    const p = String(s).split(':').map(Number);
    return (p.length >= 3 && !p.some(isNaN)) ? p[0] * 3600 + p[1] * 60 + p[2] : null;
  };
  const first = parseSec(ts[0]);
  const last  = parseSec(ts[ts.length - 1]);
  if (first === null || last === null) return 0;
  let diff = last - first;
  if (diff < 0) diff += 86400; // safety for midnight wraparound
  return diff / 3600;
}

function buildStatsHTML(section, data) {
  const TANK = 785;

  // ════════════════════════════════════════════════════════════════
//  REPLACE the entire fuel block inside buildStatsHTML()
//  Find:  if (currentSection === 'fuel') {
//  Replace everything from that if-block down to
//  the closing }  (before the default return)
// ════════════════════════════════════════════════════════════════

  if (currentSection === 'fuel') {
    const TANK = 785;

    const pctArr      = data.fuelLevelPct   || [];
    const litresArr   = data.fuelLevelL     || [];
    const fuelPsiArr  = data.fuelSupplyPsi  || [];
    const fuelTempArr = data.fuelTempF      || [];
    const kwArr       = data.kwTotal        || [];
    const rpmArr      = data.engineRPM      || [];
    const hoursArr    = data.torquePct      || []; // fallback — hours not in history keys directly

    // ── Core values ──────────────────────────────────────────
const haveStableStart = !currentIsRange
      && window._fuelSessionStart != null
      && typeof window._fuelSessionStart === 'number';

    const endPct    = pctArr.length    ? pctArr[pctArr.length - 1]         : 0;
    const endL      = litresArr.length ? litresArr[litresArr.length - 1]   : Math.round(endPct * TANK / 100);
    // If the real midnight baseline hasn't loaded yet, do NOT fall back to
    // litresArr[0] — that's a sliding 120-point window that changes on every
    // render and produces a fake, drifting "consumed" number. Show unknown instead.
    const startPct  = haveStableStart ? window._fuelSessionStartPct : null;
    const startL    = haveStableStart ? window._fuelSessionStart    : null;
    const consumedL   = haveStableStart ? Math.max(0, startL - endL)   : null;
    const consumedPct = haveStableStart ? Math.max(0, startPct - endPct) : null;
    const remainPct   = Math.min(100, Math.round(endPct));
    const usedPct     = Math.min(100, Math.round(consumedPct));
    const emptyL      = TANK - endL;

    // ── Burn rate ────────────────────────────────────────────
   // ── Burn rate ────────────────────────────────────────────
    // Use real elapsed clock time from the timestamps array instead of
    // assuming a fixed 2s/point interval — the ESP32 actually polls every
    // 5s (POLL_INTERVAL_MS), and that mismatch was making the burn rate
    // (and everything derived from it) drift every time new data arrived.
    const hrs         = elapsedHoursFromTimestamps(data.timestamps);
    const burnRateLHr = hrs > 0.01 && consumedL > 0 ? +(consumedL / hrs).toFixed(1) : 0;


    // ── Load & expected burn ─────────────────────────────────
    const curKW     = kwArr.length  ? kwArr[kwArr.length - 1]   : 0;
    const loadPct   = Math.min(100, Math.round(curKW / 320 * 100));
    let   expBurn   = 10;
    let   loadLabel = 'No Load';
    if      (loadPct >= 87) { expBurn = 87;   loadLabel = '100% (320 kW)'; }
    else if (loadPct >= 62) { expBurn = 66;   loadLabel = '75% (~240 kW)'; }
    else if (loadPct >= 37) { expBurn = 43.2; loadLabel = '50% (~160 kW)'; }
    else if (loadPct >= 12) { expBurn = 23.6; loadLabel = '25% (~80 kW)';  }

    const burnRatio    = burnRateLHr > 0 && expBurn > 0 ? burnRateLHr / expBurn : 0;
    const hrsLeft      = burnRateLHr > 0 ? +(endL / burnRateLHr).toFixed(1) : 0;

    // ── Current pressure & temp ──────────────────────────────
    const curPsi   = fuelPsiArr.length  ? fuelPsiArr[fuelPsiArr.length - 1]   : 0;
    const curTemp  = fuelTempArr.length ? fuelTempArr[fuelTempArr.length - 1] : 0;

    // ── Status helpers ───────────────────────────────────────
    const levelColor  = remainPct > 50 ? '#059669' : remainPct > 25 ? '#D97706' : '#DC2626';
    const levelBg     = remainPct > 50 ? 'rgba(5,150,105,.1)' : remainPct > 25 ? 'rgba(217,119,6,.1)' : 'rgba(220,38,38,.1)';
    const levelStatus = remainPct > 50 ? '✅ Normal Level'
                      : remainPct > 25 ? '⚠️ Low — Schedule Refuel'
                      :                  '🔴 Critical — Refuel Immediately!';

    const burnColor  = burnRatio > 1.2 ? '#DC2626' : burnRatio > 1.05 ? '#D97706' : '#059669';
    const burnBg     = burnRatio > 1.2 ? 'rgba(220,38,38,.1)' : burnRatio > 1.05 ? 'rgba(217,119,6,.1)' : 'rgba(5,150,105,.1)';
    const burnStatus = burnRatio > 1.2 ? `🔴 High burn — ${((burnRatio-1)*100).toFixed(0)}% above OEM spec`
                     : burnRatio > 1.05 ? '⚠️ Slightly elevated'
                     : burnRateLHr > 0  ? '✅ Normal — within OEM spec'
                     :                    '⏳ Calculating...';

    const runtimeColor = hrsLeft < 2 ? '#DC2626' : hrsLeft < 4 ? '#D97706' : '#2563EB';
    const runtimeAlert = hrsLeft > 0 && hrsLeft < 2
      ? `<div style="background:rgba(220,38,38,.12);border:1.5px solid #DC2626;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:800;color:#DC2626;margin-top:10px">🚨 CRITICAL — Less than 2 hours remaining! Refuel immediately.</div>`
      : hrsLeft > 0 && hrsLeft < 4
      ? `<div style="background:rgba(217,119,6,.12);border:1.5px solid #D97706;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:800;color:#D97706;margin-top:10px">⚠️ Plan Refuel — Less than 4 hours remaining.</div>`
      : '';

    // ── OEM burn reference table rows ────────────────────────
    const oem = [
      { pct: '0%',   kw: '0 kW',    burn: '~10',  note: 'Idle — no electrical output', active: loadPct < 12 },
      { pct: '25%',  kw: '~80 kW',  burn: '~23.6',note: 'Light load — offices, lighting', active: loadPct >= 12 && loadPct < 37 },
      { pct: '50%',  kw: '~160 kW', burn: '~43.2',note: 'Medium load — mixed equipment', active: loadPct >= 37 && loadPct < 62 },
      { pct: '75%',  kw: '~240 kW', burn: '~66',  note: 'Heavy load — most equipment ON', active: loadPct >= 62 && loadPct < 87 },
      { pct: '100%', kw: '320 kW',  burn: '~87',  note: 'Full load — everything running', active: loadPct >= 87 },
    ];

    const oemRows = oem.map(r => `
      <div style="display:grid;grid-template-columns:60px 80px 80px 1fr;gap:8px;padding:8px 12px;border-radius:8px;border:1.5px solid ${r.active ? '#2563EB' : '#E2E8F5'};background:${r.active ? 'rgba(37,99,235,.06)' : '#F8FAFF'};transition:all .2s">
        <span style="font-size:12px;font-weight:800;color:${r.active ? '#2563EB' : '#4A5568'}">${r.pct} Load</span>
        <span style="font-size:12px;font-weight:700;color:${r.active ? '#2563EB' : '#1A2340'};font-family:'JetBrains Mono',monospace">${r.kw}</span>
        <span style="font-size:12px;font-weight:800;color:${r.active ? '#2563EB' : '#1A2340'};font-family:'JetBrains Mono',monospace">${r.burn} L/hr</span>
        <span style="font-size:11px;color:#8A9BB5">${r.note}${r.active ? ' ← <strong style="color:#2563EB">Current</strong>' : ''}</span>
      </div>`).join('');

    // ── Stat card helper ─────────────────────────────────────
    function sc(icon, label, val, unit, sub, valColor) {
      return `
        <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:4px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5">${icon} ${label}</div>
          <div style="display:flex;align-items:baseline;gap:5px">
            <span style="font-size:22px;font-weight:800;color:${valColor || '#1A2340'};font-family:'JetBrains Mono',monospace;line-height:1">${val}</span>
            <span style="font-size:11px;color:#8A9BB5;font-weight:600">${unit}</span>
          </div>
          ${sub ? `<div style="font-size:11px;color:#8A9BB5;font-weight:600">${sub}</div>` : ''}
        </div>`;
    }

    // ── Row separator ─────────────────────────────────────────
    function rowLabel(txt) {
      return `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#8A9BB5;padding:4px 2px;margin-top:4px;border-bottom:1.5px solid #E2E8F5">${txt}</div>`;
    }

    // ── Session KV row ────────────────────────────────────────
    function kv(label, val, unit, valColor) {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F0F4FF">
          <span style="font-size:12px;color:#64748B;font-weight:700">${label}</span>
          <div style="display:flex;align-items:baseline;gap:4px">
            <span style="font-size:14px;font-weight:800;color:${valColor||'#1A2340'};font-family:'JetBrains Mono',monospace">${val}</span>
            ${unit ? `<span style="font-size:11px;color:#8A9BB5">${unit}</span>` : ''}
          </div>
        </div>`;
    }

    // ── Tank bar ──────────────────────────────────────────────
    function tankBar(pct, color) {
      return `
        <div style="position:relative;height:14px;background:#E2E8F5;border-radius:7px;overflow:hidden;margin:8px 0">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:7px;transition:width .8s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#8A9BB5;font-weight:700">
          <span>0%</span><span style="color:#D97706">25% ⚠</span><span>50%</span><span>75%</span><span>100%</span>
        </div>`;
    }

    return `
    <div style="font-family:'Nunito',sans-serif;width:100%;display:flex;flex-direction:column;gap:16px">

      <!-- ── EXPLAIN BANNER ──────────────────────────────── -->
      <div style="background:rgba(37,99,235,.05);border:1.5px solid rgba(37,99,235,.2);border-radius:12px;padding:12px 16px;font-size:12px;color:#1A2340;line-height:1.7">
        💡 <strong>How to read this page:</strong> The fuel system tracks how much diesel is in the 785L tank, how fast the DG is consuming it (burn rate), and how long you can run before refueling is needed. All values update live from Modbus sensors.
      </div>

      <!-- ── ROW 1: KEY STATS (6 cards) ──────────────────── -->
      ${rowLabel('📊 Live Snapshot')}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">
        ${sc('📊', 'Tank Level', remainPct + '%', 'full', `${endL} L of ${TANK} L`, levelColor)}
        ${sc('🪣', 'Volume Now', endL + '', 'litres', `${emptyL} L empty space`, levelColor)}
        ${sc('🔥', 'Consumed', consumedL > 0 ? consumedL + '' : '—', 'litres', usedPct > 0 ? usedPct + '% used this session' : 'Session data accumulating', '#D97706')}
        ${sc('⚡', 'Current Load', curKW.toFixed(1), 'kW', loadPct + '% of 320 kW rated', '#2563EB')}
        ${sc('💧', 'Burn Rate', burnRateLHr > 0 ? burnRateLHr.toFixed(1) : '—', 'L/hr actual', burnStatus, burnColor)}
        ${sc('🕐', 'Runtime Left', hrsLeft > 0 ? Math.round(hrsLeft) + '' : '—', 'hours', hrsLeft > 0 ? `at ${burnRateLHr > 0 ? burnRateLHr.toFixed(1) : expBurn} L/hr` : 'Calculating...', runtimeColor)}
      </div>

      ${runtimeAlert}

      <!-- ── ROW 2: TANK VISUAL + SESSION BREAKDOWN ───────── -->
      ${rowLabel('⛽ Tank Status & Session Detail')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

        <!-- Tank Visual Card -->
        <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:18px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:12px">⛽ Tank Level — 785 L Capacity</div>

          <!-- Big % display -->
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
            <div style="position:relative;width:80px;height:130px;border:2.5px solid #C8D5EF;border-radius:8px 8px 10px 10px;overflow:hidden;background:#F8FAFF;flex-shrink:0">
              <div style="position:absolute;bottom:0;left:0;right:0;height:${remainPct}%;background:linear-gradient(to top,${levelColor},${levelColor}88);transition:height 1s ease"></div>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2">
                <span style="font-size:18px;font-weight:900;color:#1A2340;font-family:'JetBrains Mono',monospace;text-shadow:0 1px 3px rgba(255,255,255,.9)">${remainPct}%</span>
                <span style="font-size:10px;color:#4A5568;font-weight:700;text-shadow:0 1px 3px rgba(255,255,255,.9)">${endL} L</span>
              </div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:8px">
              ${kv('Start fuel (session)', startL + ' L', `${Math.round(startPct)}%`, '#1A2340')}
              ${kv('Now', endL + ' L', `${remainPct}%`, levelColor)}
              ${kv('Consumed', consumedL + ' L', `${usedPct}%`, '#D97706')}
              ${kv('Empty space', emptyL + ' L', 'can refill', '#8A9BB5')}
            </div>
          </div>

          <!-- Level bar -->
          ${tankBar(remainPct, levelColor)}

          <!-- Status badge -->
          <div style="margin-top:12px;padding:8px 14px;border-radius:10px;background:${levelBg};border:1.5px solid ${levelColor};font-size:12px;font-weight:800;color:${levelColor};text-align:center">
            ${levelStatus}
          </div>
        </div>

        <!-- Session Breakdown Card -->
        <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:18px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:12px">📋 Session Breakdown</div>

          <!-- Session bar (consumed vs remaining) -->
          <div style="height:18px;border-radius:9px;overflow:hidden;background:#F0F4FF;display:flex;margin-bottom:8px">
            <div style="width:${remainPct}%;background:${levelColor};min-width:${remainPct > 0 ? 2 : 0}px;transition:width .8s"></div>
            <div style="width:${usedPct}%;background:#D97706;min-width:${usedPct > 0 ? 2 : 0}px;transition:width .8s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:11px">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="width:9px;height:9px;border-radius:50%;background:${levelColor};display:inline-block"></span>
              <span style="color:${levelColor};font-weight:800">${endL} L remaining</span>
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="width:9px;height:9px;border-radius:50%;background:#D97706;display:inline-block"></span>
              <span style="color:#D97706;font-weight:800">${consumedL} L consumed</span>
            </div>
          </div>

          ${kv('🏁 Session start fuel', startL + ' L', Math.round(startPct) + '%', '#1A2340')}
          ${kv('📍 Current stock', endL + ' L', remainPct + '%', levelColor)}
          ${kv('🔥 Total consumed', consumedL + ' L', usedPct + '%', '#D97706')}
          ${kv('⚡ Current load', curKW.toFixed(1) + ' kW', loadPct + '% rated', '#2563EB')}
          ${kv('💧 Fuel supply pressure', curPsi.toFixed(1) + ' psi', '', '#1A2340')}
          ${kv('🌡️ Fuel temperature', curTemp.toFixed(1) + ' °F', '', '#1A2340')}
        </div>
      </div>

      <!-- ── ROW 3: BURN RATE + RUNTIME ───────────────────── -->
      ${rowLabel('🔥 Burn Rate & Runtime Estimate')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

        <!-- Burn Rate Card -->
        <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:18px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:12px">🔥 Fuel Burn Rate</div>
          <div style="font-size:11px;color:#4A5568;line-height:1.6;margin-bottom:14px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.1);border-radius:8px;padding:8px 12px">
            💡 <strong>Burn rate</strong> = litres per hour the DG is consuming diesel. Higher electrical load → faster burn → less runtime remaining.
          </div>

          <div style="display:flex;gap:12px;margin-bottom:14px">
            <div style="flex:1;text-align:center;background:#F8FAFF;border:1.5px solid #E2E8F5;border-radius:12px;padding:14px">
              <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:4px">Actual</div>
              <div style="font-size:32px;font-weight:800;color:${burnColor};font-family:'JetBrains Mono',monospace;line-height:1">${burnRateLHr > 0 ? burnRateLHr.toFixed(1) : '—'}</div>
              <div style="font-size:11px;color:#8A9BB5;margin-top:2px">L / hour</div>
            </div>
            <div style="flex:1;text-align:center;background:#F8FAFF;border:1.5px solid #E2E8F5;border-radius:12px;padding:14px">
              <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:4px">OEM Expected</div>
              <div style="font-size:32px;font-weight:800;color:#2563EB;font-family:'JetBrains Mono',monospace;line-height:1">${expBurn}</div>
              <div style="font-size:11px;color:#8A9BB5;margin-top:2px">L / hour</div>
            </div>
          </div>

          <div style="padding:8px 12px;border-radius:10px;background:${burnBg};border:1.5px solid ${burnColor};font-size:12px;font-weight:800;color:${burnColor};text-align:center;margin-bottom:14px">
            ${burnStatus}
          </div>

          <!-- Current load label -->
          <div style="font-size:11px;color:#64748B;font-weight:700;margin-bottom:8px">Current load: <strong style="color:#2563EB">${loadLabel}</strong></div>

          <!-- OEM reference table -->
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:6px">OEM Burn Reference (Cummins 400 kVA)</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:grid;grid-template-columns:60px 80px 80px 1fr;gap:8px;padding:5px 12px;background:#F0F4FF;border-radius:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#8A9BB5">
              <span>Load</span><span>Power</span><span>Burn</span><span>Typical use</span>
            </div>
            ${oemRows}
          </div>
        </div>

        <!-- Runtime Card -->
        <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:18px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-bottom:12px">🕐 Runtime Estimate</div>
          <div style="font-size:11px;color:#4A5568;line-height:1.6;margin-bottom:14px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.1);border-radius:8px;padding:8px 12px">
            💡 <strong>Runtime estimate</strong> = how many hours the DG can run before the tank is empty, calculated from current fuel level ÷ actual burn rate.
          </div>

          <!-- Big hours number -->
          <div style="text-align:center;background:#F0F6FF;border-radius:14px;padding:20px;margin-bottom:14px">
            <div style="font-size:64px;font-weight:800;color:${runtimeColor};font-family:'JetBrains Mono',monospace;line-height:1">${hrsLeft > 0 ? Math.round(hrsLeft) : '—'}</div>
            <div style="font-size:13px;color:#2563EB;margin-top:6px;font-weight:700;opacity:.8">hours remaining</div>
            <div style="font-size:11px;color:#8A9BB5;margin-top:3px">@ ${burnRateLHr > 0 ? burnRateLHr.toFixed(1) : expBurn} L/hr ${burnRateLHr > 0 ? 'actual' : 'expected'} burn</div>
          </div>

          ${kv('⛽ Fuel remaining', endL + ' L', remainPct + '%', levelColor)}
          ${kv('🔥 Actual burn rate', burnRateLHr > 0 ? burnRateLHr.toFixed(1) + ' L/hr' : '— (calculating)', '', burnColor)}
          ${kv('📐 OEM expected burn', expBurn + ' L/hr', 'at ' + loadLabel, '#2563EB')}
          ${kv('⚡ Generator load', curKW.toFixed(1) + ' kW', loadPct + '% of 320 kW', '#2563EB')}
          ${kv('💧 Fuel supply pressure', curPsi.toFixed(1) + ' psi', '', '#1A2340')}
          ${kv('🌡️ Fuel temperature', curTemp.toFixed(1) + ' °F', '', '#1A2340')}

          ${runtimeAlert}

          <!-- Runtime at different loads forecast -->
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#8A9BB5;margin-top:14px;margin-bottom:6px">Runtime forecast with ${endL} L remaining</div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${[
              { label: 'No load (idle)', burn: 10 },
              { label: '25% load',       burn: 23.6 },
              { label: '50% load',       burn: 43.2 },
              { label: '75% load',       burn: 66 },
              { label: '100% load',      burn: 87 },
            ].map(r => {
              const h = endL > 0 ? Math.round(endL / r.burn) : 0;
              const col = h < 2 ? '#DC2626' : h < 4 ? '#D97706' : '#059669';
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:7px;background:#F8FAFF;border:1px solid #E2E8F5">
                <span style="font-size:11px;color:#64748B;font-weight:700">${r.label}</span>
                <span style="font-size:12px;font-weight:800;color:${col};font-family:'JetBrains Mono',monospace">${h} hrs</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

    </div>`;
  }

  // ── Default for all other sections ────────────────────────
  return section.statsKeys.map(sk => {
    const arr   = data[sk.key] || [];
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x) && x !== 0);
    const fmt   = n => parseFloat(n).toFixed(sk.dec);
    const s     = valid.length
      ? { min: Math.min(...valid), max: Math.max(...valid),
          avg: valid.reduce((a, b) => a + b, 0) / valid.length,
          last: valid[valid.length - 1] }
      : { min: 0, max: 0, avg: 0, last: 0 };
    return `
      <div class="gsd-stat-card">
        <div class="gsd-stat-param">${sk.label}${sk.unit ? ' (' + sk.unit + ')' : ''}</div>
        <div class="gsd-stat-grid">
          <span class="gsd-sv">Current</span><span class="gsd-sn cur">${fmt(s.last)}</span>
          <span class="gsd-sv">Max</span>    <span class="gsd-sn">${fmt(s.max)}</span>
          <span class="gsd-sv">Min</span>    <span class="gsd-sn">${fmt(s.min)}</span>
          <span class="gsd-sv">Avg</span>    <span class="gsd-sn">${fmt(s.avg)}</span>
        </div>
      </div>`;
  }).join('');
}

  function applyTrendFilter(trend) {
    activeTrend = trend;
    const section = SECTIONS[currentSection];
    document.querySelectorAll('.gsd-trend-btn').forEach(b => b.classList.toggle('active', b.dataset.trend === trend));
    section.charts.forEach(ch => {
      const panel = document.getElementById('panel_' + ch.id);
      if (panel) panel.style.display = (trend === 'all' || ch.trendId === trend) ? '' : 'none';
    });
  }

  // ── 24-HOUR GRID HELPERS ──────────────────────────────────────
const DAY_GRID_INTERVAL_SEC = 120; // one slot every 2 min = 720 points/day

function buildDayGridLabels(intervalSec = DAY_GRID_INTERVAL_SEC) {
  const labels = [];
  for (let s = 0; s < 86400; s += intervalSec) {
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    labels.push(`${hh}:${mm}:${ss}`);
  }
  return labels;
}

function alignSeriesToDayGrid(gridLabels, rawTimestamps, rawValues, intervalSec = DAY_GRID_INTERVAL_SEC) {
  const sums   = new Array(gridLabels.length).fill(0);
  const counts = new Array(gridLabels.length).fill(0);
  (rawTimestamps || []).forEach((ts, i) => {
    const p = String(ts).split(':').map(Number);
    if (p.length < 3 || p.some(isNaN)) return;
    const secs = p[0] * 3600 + p[1] * 60 + p[2];
    const idx = Math.min(gridLabels.length - 1, Math.floor(secs / intervalSec));
    const v = rawValues ? rawValues[i] : null;
    if (typeof v === 'number' && !isNaN(v)) { sums[idx] += v; counts[idx] += 1; }
  });
  return gridLabels.map((_, i) => counts[i] > 0 ? +(sums[i] / counts[i]).toFixed(2) : null);
}


 function renderDetailCharts(section, data, isRange) {
    let labels = data.timestamps || [];
    let getSeries = (key) => data[key] || [];

    if (!isRange) {
      // Single-day view → force a full 00:00:00–23:59:xx axis, downsampled
      // so we're not asking Chart.js to draw tens of thousands of points.
      const rawGridLabels = buildDayGridLabels(); // e.g. 720 pts at 2-min resolution
      labels = downsample(rawGridLabels, 400);
      getSeries = (key) => {
        const aligned = alignSeriesToDayGrid(rawGridLabels, data.timestamps, data[key]);
        return downsample(aligned, 400);
      };
    }
    section.charts.forEach(ch => {
      const canvas = document.getElementById(ch.id);
      if (!canvas) return;
      const useBar = isRange || ch.bar;
      const datasets = ch.datasets.map(ds => ({
        label: ds.label, data: getSeries(ds.key),
        borderColor: ds.color,
        backgroundColor: useBar ? ds.color + 'BB' : ds.color + '18',
        borderWidth: useBar ? 0 : 2,
        borderRadius: useBar ? 6 : 0,
        tension: 0.35, pointRadius: (!useBar && labels.length < 120) ? 2 : 0,
        spanGaps: false,
        fill: ds.fill || false, yAxisID: ds.yAxis || 'y'
      }));
      const scales = ch.dualAxis
        ? { x: xScale(), yL: yScale('left'), yR: yScale('right') }
        : { x: xScale(), y: yScale() };
      if (!ch.dualAxis) datasets.forEach(d => { d.yAxisID = 'y'; });
      detailCharts[ch.id] = new Chart(canvas.getContext('2d'), {
        type: useBar ? 'bar' : 'line',
        data: { labels, datasets },
        options: {
responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10, padding: 12, color: '#4A5568' } },
            tooltip: { backgroundColor: '#1A2340', titleColor: '#fff', bodyColor: '#CBD5E1', bodyFont: { family: 'JetBrains Mono', size: 11 }, titleFont: { family: 'Nunito', size: 11, weight: '800' } }
          },
          scales
        }
      });
    });
    applyTrendFilter(activeTrend);
  }

  function buildChartsHTML(section) {
    return section.charts.map(ch => `
      <div class="gsd-chart-panel" id="panel_${ch.id}">
        <div class="gsd-chart-header"><span class="gsd-chart-title">${ch.title}</span></div>
        <div class="gsd-chart-wrap${ch.tall ? ' tall' : ''}"><canvas id="${ch.id}"></canvas></div>
      </div>`).join('');
  }

  function buildTrendButtons(section) {
    const container = document.getElementById('gsdTrendBtns');
    container.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    container.innerHTML = section.trends.map(t =>
      `<button class="gsd-trend-btn${t.id === 'all' ? ' active' : ''}" data-trend="${t.id}">${t.label}</button>`
    ).join('');
    container.querySelectorAll('.gsd-trend-btn').forEach(btn => {
      btn.addEventListener('click', () => applyTrendFilter(btn.dataset.trend));
    });
  }

  function renderDetailBody(section, data, isRange = false) {
    const pts = (data.timestamps || []).length;
    document.getElementById('gsdPtsLabel').textContent = pts ? `${pts.toLocaleString()} data points` : '';
    const body = document.getElementById('gsdBody');
    body.innerHTML = `
      <div class="gsd-stats-row">${buildStatsHTML(section, data)}</div>
      <div class="gsd-charts-area">${buildChartsHTML(section)}</div>`;
    destroyDetailCharts();
    renderDetailCharts(section, data, isRange);
  }

  function compressToDailyAverages(data, from, to) {
    const labels = [];
    const cursor = new Date(from + 'T00:00:00');
    const endD   = new Date(to   + 'T00:00:00');
    while (cursor <= endD) { labels.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
    const keys = Object.keys(data).filter(k => k !== 'timestamps' && k !== 'pointCount' && k !== 'noData');
    const buckets = {};
    labels.forEach(lbl => { buckets[lbl] = {}; keys.forEach(k => { buckets[lbl][k] = []; }); });
    (data.timestamps || []).forEach((ts, i) => {
      const dateKey = String(ts).slice(0, 10);
      if (!buckets[dateKey]) return;
      keys.forEach(k => { const v = data[k] && data[k][i]; if (typeof v === 'number' && !isNaN(v) && v !== 0) buckets[dateKey][k].push(v); });
    });
    const result = { timestamps: labels };
    keys.forEach(k => { result[k] = labels.map(lbl => { const vals = buckets[lbl][k]; if (!vals || !vals.length) return 0; return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2); }); });
    return result;
  }

async function loadDetailData(from, to) {
    const requestedSection = currentSection;   // snapshot — guards against races
    const body = document.getElementById('gsdBody');
    const isRange = from !== to;
    body.innerHTML = `<div class="gsd-loading"><div class="gsd-spinner"></div><span>Fetching data for ${from}${isRange ? ' → ' + to : ''}…</span></div>`;
    destroyDetailCharts();

    let data;
    try {
      const json = await fetchHistoryCached(from, to);

      // If the overlay was closed or switched sections while this was in flight,
      // drop the response — rendering it now would crash (stale section) or
      // show the wrong section's data.
      if (currentSection !== requestedSection) return;

      if (!json.timestamps || json.timestamps.length === 0 || json.noData) {
        data = seedFromDayStore(requestedSection);
      } else {
        data = isRange ? compressToDailyAverages(json, from, to) : json;
      }
    } catch(e) {
      console.error('[Detail] Fetch error:', e.message);
      if (currentSection !== requestedSection) return;
      data = seedFromDayStore(requestedSection);
    }

    if (currentSection !== requestedSection) return; // final guard
    currentData    = data;
    currentIsRange = isRange;
    renderDetailBody(SECTIONS[requestedSection], data, isRange);
}


function seedFromDayStore(sectionKey) {
  const ts = dayStore.timestamps.slice(-120);
  const n  = ts.length;
  const z  = (arr) => arr ? arr.slice(-120) : new Array(n).fill(0);

  return {
    timestamps:   ts,
    voltL1N:      z(dayStore.voltL1N),
    voltL2N:      z(dayStore.voltL2N),
    voltL3N:      z(dayStore.voltL3N),
    voltL1L2:     z(dayStore.voltL1L2),
    voltL2L3:     z(dayStore.voltL2L3),
    voltL3L1:     z(dayStore.voltL3L1),
    currL1:       z(dayStore.currL1),
    currL2:       z(dayStore.currL2),
    currL3:       z(dayStore.currL3),
    currPctL1:    z(dayStore.currPctL1),
    currPctL2:    z(dayStore.currPctL2),
    currPctL3:    z(dayStore.currPctL3),
    kwTotal:      z(dayStore.kwTotal),
    kwL1:         z(dayStore.calcAL1),
    kwL2:         z(dayStore.calcAL2),
    kwL3:         z(dayStore.calcAL3),
    kvaTotal:     z(dayStore.kvaTotal),
    kvarTotal:    z(dayStore.kvarTotal),
    frequency:    z(dayStore.freq),
    pf:           z(dayStore.pf),
    engineRPM:    z(dayStore.rpm),
    coolantTempF: z(dayStore.coolantF),
    oilTempF:     z(dayStore.oilTempF),
    intakeTempF:  z(dayStore.intakeTempF),
    fuelTempF:    z(dayStore.fuelTempF),
    exhaustTempF: z(dayStore.exhaustTempF),
    oilPressPsi:  z(dayStore.oilPsi),
    boostPressPsi:z(dayStore.boostPsi),
    crankPressPsi:z(dayStore.crankcasePsi),
    fuelSupplyPsi:z(dayStore.fuelSupplyPsi),
    coolantPsi:   z(dayStore.coolantPsi),
    torquePct:    new Array(n).fill(0),
    battV:        z(dayStore.battV),
    fuelLevelPct: z(dayStore.fuelPct),
    fuelLevelL:   z(dayStore.fuelLitres),
    utilVoltL1N:  z(dayStore.uVL1N),
    utilVoltL2N:  z(dayStore.uVL2N),
    utilVoltL3N:  z(dayStore.uVL3N),
    utilVoltL1L2: z(dayStore.uVL1L2),
    utilVoltL2L3: z(dayStore.uVL2L3),
    utilVoltL3L1: z(dayStore.uVL3L1),
    utilFrequency:z(dayStore.utilFreq),
    gensetState:  new Array(n).fill(0),
    amfState:     new Array(n).fill(0),
    xferSwStatus: new Array(n).fill(0),
    faultCode:    new Array(n).fill(0),
  };
}

  function exportCSV() {
    if (!currentData || !currentData.timestamps) return;
    const section = SECTIONS[currentSection];
    const keys = ['timestamps', ...section.statsKeys.map(s => s.key), ...section.charts.flatMap(c => c.datasets.map(d => d.key))];
    const unique = [...new Set(keys)];
    const rows = [unique.join(',')];
    for (let i = 0; i < currentData.timestamps.length; i++) {
      rows.push(unique.map(k => { const v = currentData[k]; return v && v[i] !== undefined ? v[i] : ''; }).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `gensight_${currentSection}_${document.getElementById('gsdFrom').value}_${document.getElementById('gsdTo').value}.csv`;
    a.click();
  }

function todayStr()    { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
  function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }

  function openDetail(sectionKey) {
    const section = SECTIONS[sectionKey];
    if (!section) return;
    currentSection = sectionKey;
    activeTrend    = 'all';
    sessionStorage.setItem('gsDetailOpen', sectionKey); // ← ADD THIS
    document.getElementById('gsdIcon').textContent  = section.icon;
    document.getElementById('gsdTitle').textContent = section.title;
    const today = todayStr();
    document.getElementById('gsdFrom').value = today;
    document.getElementById('gsdTo').value   = today;
    buildTrendButtons(section);
    overlayEl.classList.add('open');
    overlayEl.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    loadDetailData(today, today);
  }

  

 function closeDetail() {
    sessionStorage.removeItem('gsDetailOpen'); // ← ADD THIS
    overlayEl.classList.remove('open');
    document.body.style.overflow = '';
    destroyDetailCharts();
    currentSection = null;
    currentData    = null;
}

  document.getElementById('gsdBackBtn').addEventListener('click', closeDetail);
  document.getElementById('gsdFetchBtn').addEventListener('click', () => {
    const from = document.getElementById('gsdFrom').value;
    const to   = document.getElementById('gsdTo').value;
    if (!from || !to) return;
    if (from > to) { alert('From date must be before To date'); return; }
    loadDetailData(from, to);
  });
  document.getElementById('gsdCsvBtn').addEventListener('click', exportCSV);

  overlayEl.querySelectorAll('.gsd-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset, today = todayStr();
      if (p === 'today')     { document.getElementById('gsdFrom').value = today;        document.getElementById('gsdTo').value = today; }
      else if (p === '7d')   { document.getElementById('gsdFrom').value = daysAgoStr(6); document.getElementById('gsdTo').value = today; }
      else if (p === '30d')  { document.getElementById('gsdFrom').value = daysAgoStr(29); document.getElementById('gsdTo').value = today; }
      loadDetailData(document.getElementById('gsdFrom').value, document.getElementById('gsdTo').value);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeDetail();
  });

  // ── Live push from main render() ───────────────────────────
  window.gsDetailPush = function(latest) {
    if (!overlayEl.classList.contains('open') || !currentSection || !currentData) return;
    const section = SECTIONS[currentSection];
    const ac = latest.ac || {}, eng = latest.engine || {}, elec = latest.electrical || {};
    const fuel = latest.fuel || {}, util = latest.utility || {};
    const map = {
      voltL1N: parseFloat(ac.voltL1N) || 0, voltL2N: parseFloat(ac.voltL2N) || 0, voltL3N: parseFloat(ac.voltL3N) || 0,
      voltL1L2: parseFloat(ac.voltL1L2) || 0, voltL2L3: parseFloat(ac.voltL2L3) || 0, voltL3L1: parseFloat(ac.voltL3L1) || 0,
      currL1: parseFloat(ac.currL1) || 0, currL2: parseFloat(ac.currL2) || 0, currL3: parseFloat(ac.currL3) || 0,
      kwTotal: parseFloat(ac.kwTotal) || 0, kvaTotal: parseFloat(ac.kvaTotal) || 0, kvarTotal: parseFloat(ac.kvarTotal) || 0,
      frequency: parseFloat(ac.freq) || 0, pf: parseFloat(ac.pf) || 0,
      engineRPM: parseFloat(eng.rpm) || 0, coolantTempF: parseFloat(eng.coolantTempF) || 0,
      oilTempF: parseFloat(eng.oilTempF) || 0, intakeTempF: parseFloat(eng.intakeTempF) || 0,
      fuelTempF: parseFloat(eng.fuelTempF) || 0, exhaustTempF: parseFloat(eng.exhaustTempF) || 0,
      oilPressPsi: parseFloat(eng.oilPressPsi) || 0, boostPressPsi: parseFloat(eng.boostPressPsi) || 0,
      crankPressPsi: parseFloat(eng.crankPressPsi) || 0, fuelSupplyPsi: parseFloat(eng.fuelPressPsi) || 0,
      coolantPsi: parseFloat(eng.coolantPsi) || 0, torquePct: parseFloat(eng.torquePct) || 0,
      battV: parseFloat(elec.battV) || 0,
      fuelLevelPct: parseFloat(fuel.pct) || 0, fuelLevelL: Math.round((parseFloat(fuel.pct) || 0) * 785 / 100),
      utilVoltL1N: parseFloat(util.voltL1N) || 0, utilVoltL2N: parseFloat(util.voltL2N) || 0, utilVoltL3N: parseFloat(util.voltL3N) || 0,
      utilVoltL1L2: parseFloat(util.voltL1L2) || 0, utilVoltL2L3: parseFloat(util.voltL2L3) || 0, utilVoltL3L1: parseFloat(util.voltL3L1) || 0,
      utilFrequency: parseFloat(util.freq) || 0,
      gensetState: latest.stateCode || 0, faultCode: latest.faultCode || 0,
      amfState: latest.amfState || 0, xferSwStatus: latest.xferSwStatus || 0
    };
    const MAX = 43200; // full 24h @ 2s poll interval
    currentData.timestamps.push(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    if (currentData.timestamps.length > MAX) currentData.timestamps.shift();
    Object.keys(map).forEach(k => {
      if (!currentData[k]) currentData[k] = [];
      currentData[k].push(map[k]);
      if (currentData[k].length > MAX) currentData[k].shift();
    });
    const gridLabels = currentIsRange ? null : buildDayGridLabels();
    section.charts.forEach(ch => {
      const chart = detailCharts[ch.id];
      if (!chart) return;
      if (gridLabels) {
        chart.data.labels = gridLabels;
        ch.datasets.forEach((ds, i) => {
          if (chart.data.datasets[i]) chart.data.datasets[i].data = alignSeriesToDayGrid(gridLabels, currentData.timestamps, currentData[ds.key]);
        });
      } else {
        chart.data.labels = currentData.timestamps;
        ch.datasets.forEach((ds, i) => { if (chart.data.datasets[i]) chart.data.datasets[i].data = currentData[ds.key] || []; });
      }
      chart.update('none');
    });
    const statsRow = document.querySelector('.gsd-stats-row');
    if (statsRow) statsRow.innerHTML = buildStatsHTML(section, currentData);
  };

  // ── Restore on page refresh ────────────────────────────────
  const _savedSection = sessionStorage.getItem('gsDetailOpen');
  if (_savedSection && SECTIONS[_savedSection]) {
    openDetail(_savedSection);
  }

  // ── Response cache — avoid re-fetching the same date range repeatedly ──
  const _historyCache = new Map(); // key: "from|to" -> { json, ts }
  const CACHE_TTL_MS = 60000; // 1 minute — live data still needs refreshing eventually

  async function fetchHistoryCached(from, to) {
    const key = `${from}|${to}`;
    const cached = _historyCache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return cached.json;
    }
    const r = await fetch(`/api/history?from=${from}&to=${to}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    _historyCache.set(key, { json, ts: Date.now() });
    return json;
  }

  function downsample(arr, maxPoints = 400) {
    if (!arr || arr.length <= maxPoints) return arr;
    const stride = Math.ceil(arr.length / maxPoints);
    const out = [];
    for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
    return out;
  }

// ── Expose globally ────────────────────────────────────────
  window.gsDetail = { open: openDetail, close: closeDetail };
  window.applyEngTrend = applyEngTrend;   // ← ADD THIS LINE
})();