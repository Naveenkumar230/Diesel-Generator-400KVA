'use strict';

(function () {

  const TANK_CAPACITY = 780;

  // ── CSS ──────────────────────────────────────────────────────
  const STYLE = `
  #dsOverlay {
    display: none; position: fixed; inset: 0; z-index: 999997;
    background: rgba(15,23,42,.6); backdrop-filter: blur(5px);
    align-items: center; justify-content: center; padding: 14px;
    box-sizing: border-box;
  }
  #dsOverlay.open { display: flex; }

  .ds-box {
    background: #fff; border-radius: 18px; border: 2px solid #2563EB;
    box-shadow: 0 24px 64px rgba(37,99,235,.25);
    width: 100%; max-width: 720px; max-height: 92vh; overflow-y: auto;
    font-family: 'Nunito', sans-serif;
    animation: dsSlide .22s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes dsSlide { from{transform:translateY(24px) scale(.97);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }

  .ds-head {
    background: linear-gradient(135deg,#2563EB,#1D4ED8);
    padding: 16px 20px; display: flex; align-items: center; gap: 10px;
    position: sticky; top: 0; z-index: 2;
  }
  .ds-head-title { font-size: 1rem; font-weight: 900; color: #fff; flex: 1; }
  .ds-close-btn {
    background: rgba(255,255,255,.15); border: none; color: #fff;
    width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
    font-size: 1rem; line-height: 1;
  }
  .ds-close-btn:hover { background: rgba(255,255,255,.3); }

  .ds-datebar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 12px 20px; border-bottom: 1.5px solid #E2E8F5; background: #F8FAFF;
  }
  .ds-datebar input[type=date] {
    background: #fff; border: 1.5px solid #C8D5EF; color: #1A2340;
    padding: 6px 10px; border-radius: 8px; font-family: 'JetBrains Mono', monospace;
    font-size: .8rem; outline: none; cursor: pointer;
  }
  .ds-datebar input[type=date]:focus { border-color: #2563EB; }
  .ds-preset-btn {
    background: #F0F4FF; color: #4A5568; border: 1.5px solid #C8D5EF;
    padding: 6px 12px; border-radius: 7px; cursor: pointer; font-family: inherit;
    font-size: .72rem; font-weight: 700; transition: all .18s;
  }
  .ds-preset-btn:hover { background: #E2E8F5; color: #1A2340; }
  .ds-preset-btn.active { background: #2563EB; border-color: #2563EB; color: #fff; }

  .ds-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
  .ds-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:60px 20px; color:#8A9BB5; font-size:.85rem; }
  .ds-spinner { width:32px; height:32px; border:3px solid #E2E8F5; border-top-color:#2563EB; border-radius:50%; animation: dsSpin .7s linear infinite; }
  @keyframes dsSpin { to { transform: rotate(360deg); } }

  .ds-section { border: 1.5px solid #E2E8F5; border-radius: 12px; padding: 14px 16px; }
  .ds-section-title {
    font-size: .76rem; font-weight: 900; color: #1A2340;
    display: flex; align-items: center; gap: 7px; margin-bottom: 12px;
    text-transform: uppercase; letter-spacing: .05em;
  }
  .ds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px,1fr)); gap: 10px; }
  .ds-stat {
    background: #F8FAFF; border: 1px solid #E2E8F5; border-radius: 10px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 3px;
  }
  .ds-stat-lbl { font-size: .60rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #8A9BB5; }
  .ds-stat-val { font-size: 1.05rem; font-weight: 800; color: #1A2340; font-family: 'JetBrains Mono', monospace; }
  .ds-stat-sub { font-size: .62rem; color: #8A9BB5; }
  .ds-stat-val.green { color: #059669; } .ds-stat-val.amber { color: #D97706; } .ds-stat-val.red { color: #DC2626; }

  .ds-refill-table { width:100%; border-collapse: collapse; font-size: .78rem; }
  .ds-refill-table th {
    text-align: left; padding: 6px 8px; background: #F0F4FF; color: #4A5568;
    font-size: .64rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 800;
  }
  .ds-refill-table td { padding: 7px 8px; border-bottom: 1px solid #F0F4FF; font-family: 'JetBrains Mono', monospace; }
  .ds-refill-empty { text-align:center; color:#8A9BB5; font-size:.78rem; padding: 16px 0; }
  .ds-refill-badge { font-size:.62rem; font-weight:800; padding:2px 7px; border-radius:10px; background:#ECFDF5; color:#059669; border:1px solid #BBF7D0; }
  .ds-refill-badge.manual { background:#EFF6FF; color:#2563EB; border-color:#BFDBFE; }

  .ds-export-btn {
    background: #059669; color: #fff; border: none; padding: 7px 16px;
    border-radius: 8px; cursor: pointer; font-family: inherit; font-size: .76rem;
    font-weight: 800; margin-left: auto;
  }
  .ds-export-btn:hover { background: #047857; }

  .ds-note {
    font-size: .68rem; color: #8A9BB5; background: #F8FAFF; border-left: 3px solid #2563EB;
    padding: 8px 10px; border-radius: 6px; line-height: 1.5;
  }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Markup ─────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'dsOverlay';
  overlay.innerHTML = `
    <div class="ds-box">
      <div class="ds-head">
        <span style="font-size:1.4rem">📝</span>
        <span class="ds-head-title">Daily Summary Report</span>
        <button class="ds-close-btn" id="dsCloseBtn">✕</button>
      </div>
      <div class="ds-datebar">
        <label style="font-size:.68rem;font-weight:800;color:#8A9BB5;text-transform:uppercase;letter-spacing:.06em">Date</label>
        <input type="date" id="dsDate">
        <button class="ds-preset-btn" data-preset="today">Today</button>
        <button class="ds-preset-btn" data-preset="yesterday">Yesterday</button>
        <button class="ds-export-btn" id="dsExportBtn">⬇ Export CSV</button>
      </div>
      <div class="ds-body" id="dsBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function todayStr() { return new Date().toISOString().slice(0,10); }
  function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }

  function stats(arr) {
    const v = (arr || []).filter(x => typeof x === 'number' && !isNaN(x) && x !== 0);
    if (!v.length) return { min:0, max:0, avg:0, last:0 };
    return {
      min:  +Math.min(...v).toFixed(2),
      max:  +Math.max(...v).toFixed(2),
      avg:  +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2),
      last: +v[v.length-1].toFixed(2)
    };
  }

  function statCard(label, valStr, sub, colorClass) {
    return `<div class="ds-stat">
      <div class="ds-stat-lbl">${label}</div>
      <div class="ds-stat-val ${colorClass||''}">${valStr}</div>
      ${sub ? `<div class="ds-stat-sub">${sub}</div>` : ''}
    </div>`;
  }

  let currentReportData = null;
  let currentDate = todayStr();

  async function loadSummary(dateStr) {
    currentDate = dateStr;
    const body = document.getElementById('dsBody');
    body.innerHTML = `<div class="ds-loading"><div class="ds-spinner"></div><span>Building report for ${dateStr}…</span></div>`;

    let history = null;
    let refills = [];

    try {
      const r = await fetch(`/api/history?date=${dateStr}`);
      if (r.ok) {
        const json = await r.json();
        if (!json.noData) history = json;
      }
    } catch(e) { console.warn('[Summary] history fetch error:', e.message); }

    try {
      const r2 = await fetch('/api/refills');
      if (r2.ok) {
        const all = await r2.json();
        refills = all.filter(rf => (rf.time || '').slice(0,10) === dateStr);
      }
    } catch(e) { console.warn('[Summary] refills fetch error:', e.message); }

    currentReportData = { history, refills, date: dateStr };
    renderReport(currentReportData);
  }

  function renderReport({ history, refills, date }) {
    const body = document.getElementById('dsBody');

    if (!history) {
      body.innerHTML = `<div class="ds-note">⚠️ No PLC reading data found for ${date}. The genset may not have been monitored that day, or this date is outside stored history.</div>`;
      renderRefillSection(refills);
      return;
    }

    const v1 = stats(history.voltL1N), v2 = stats(history.voltL2N), v3 = stats(history.voltL3N);
    const c1 = stats(history.currL1),  c2 = stats(history.currL2),  c3 = stats(history.currL3);
    const kw  = stats(history.kwTotal);
    const kva = stats(history.kvaTotal);
    const freq = stats(history.frequency);
    const pf   = stats(history.pf);
    const fuelPct = stats(history.fuelLevelPct);
    const coolant = stats(history.coolantTempF);
    const oilP = stats(history.oilPressPsi);
    const battV = stats(history.battV);
    const rpm = stats(history.engineRPM);

    // Diesel consumption: start-of-day fuel % vs end-of-day fuel %
    const fuelArr = (history.fuelLevelPct || []).filter(x => x > 0);
    const startPct = fuelArr.length ? fuelArr[0] : 0;
    const endPct   = fuelArr.length ? fuelArr[fuelArr.length-1] : 0;
    const startL = Math.round(startPct/100*TANK_CAPACITY);
    const endL   = Math.round(endPct/100*TANK_CAPACITY);

    // Total refilled that day
    const totalRefilled = refills.reduce((sum, r) => sum + (r.addedL || 0), 0);

    // Net consumption = start + refilled - end
    const netConsumed = Math.max(0, (startL + totalRefilled) - endL);

    // Run hours estimate: count of points where kW > 1 * 2s / 3600
    const runningPoints = (history.kwTotal || []).filter(k => k > 1).length;
    const runHoursEst = +(runningPoints * 2 / 3600).toFixed(1);

    body.innerHTML = `
      <div class="ds-note">📅 <strong>${date}</strong> — ${(history.timestamps||[]).length.toLocaleString()} readings logged this day. All values below are computed from live Modbus data.</div>

      <div class="ds-section">
        <div class="ds-section-title">⚡ Voltage (L-N)</div>
        <div class="ds-grid">
          ${statCard('L1-N Avg', v1.avg + ' V', `Min ${v1.min} / Max ${v1.max}`)}
          ${statCard('L2-N Avg', v2.avg + ' V', `Min ${v2.min} / Max ${v2.max}`)}
          ${statCard('L3-N Avg', v3.avg + ' V', `Min ${v3.min} / Max ${v3.max}`)}
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-title">🔌 Current (Amps)</div>
        <div class="ds-grid">
          ${statCard('L1 Avg', c1.avg + ' A', `Min ${c1.min} / Max ${c1.max}`)}
          ${statCard('L2 Avg', c2.avg + ' A', `Min ${c2.min} / Max ${c2.max}`)}
          ${statCard('L3 Avg', c3.avg + ' A', `Min ${c3.min} / Max ${c3.max}`)}
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-title">🔋 Power & Frequency</div>
        <div class="ds-grid">
          ${statCard('Active Power (kW)', kw.avg + ' kW', `Peak ${kw.max} kW`)}
          ${statCard('Apparent Power (kVA)', kva.avg + ' kVA', `Peak ${kva.max} kVA`)}
          ${statCard('Frequency', freq.avg + ' Hz', `Min ${freq.min} / Max ${freq.max}`)}
          ${statCard('Power Factor', pf.avg, `Min ${pf.min} / Max ${pf.max}`)}
          ${statCard('Engine RPM', rpm.avg, `Min ${rpm.min} / Max ${rpm.max}`)}
          ${statCard('Est. Run Hours', runHoursEst + ' h', 'kW > 1 used as proxy')}
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-title">⛽ Diesel / Fuel Summary</div>
        <div class="ds-grid">
          ${statCard('Start of Day', startL + ' L', startPct + '%')}
          ${statCard('End of Day', endL + ' L', endPct + '%', endPct < 25 ? 'red' : endPct < 50 ? 'amber' : 'green')}
          ${statCard('Refilled Today', totalRefilled + ' L', refills.length + ' refill event(s)', totalRefilled>0 ? 'green' : '')}
          ${statCard('Net Consumed', netConsumed + ' L', 'start + refill − end', 'amber')}
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-title">🌡️ Engine Health</div>
        <div class="ds-grid">
          ${statCard('Coolant Temp', coolant.avg + ' °F', `Max ${coolant.max} °F`, coolant.max > 95*1.8+32 ? 'red' : '')}
          ${statCard('Oil Pressure', oilP.avg + ' psi', `Min ${oilP.min} psi`, oilP.min < 20 && oilP.min !== 0 ? 'red' : '')}
          ${statCard('Battery Voltage', battV.avg + ' V', `Min ${battV.min} / Max ${battV.max}`)}
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-title" style="justify-content:space-between;display:flex;align-items:center">
          <span>⛽ Refill Log — ${date}</span>
        </div>
        <div id="dsRefillTableWrap"></div>
      </div>
    `;
    renderRefillSection(refills);
  }

  function renderRefillSection(refills) {
    const wrap = document.getElementById('dsRefillTableWrap');
    if (!wrap) return;
    if (!refills || refills.length === 0) {
      wrap.innerHTML = `<div class="ds-refill-empty">No refill events recorded for this date.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="ds-refill-table">
        <thead>
          <tr><th>Time</th><th>Before</th><th>After</th><th>Added</th><th>Logged By</th></tr>
        </thead>
        <tbody>
          ${refills.map(r => `
            <tr>
              <td>${(r.time||'').replace('T',' ').slice(0,19)}</td>
              <td>${r.beforeL} L (${r.beforePct}%)</td>
              <td>${r.afterL} L (${r.afterPct}%)</td>
              <td style="color:#059669;font-weight:800">+${r.addedL} L</td>
              <td><span class="ds-refill-badge ${r.auto ? '' : 'manual'}">${r.person || (r.auto ? 'Auto-detected' : 'Manual entry')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function exportCSV() {
    if (!currentReportData) return;
    const { history, refills, date } = currentReportData;
    const rows = [];
    rows.push(`GenSight Daily Summary — ${date}`);
    rows.push('');
    if (history) {
      const v1 = stats(history.voltL1N), v2 = stats(history.voltL2N), v3 = stats(history.voltL3N);
      const c1 = stats(history.currL1),  c2 = stats(history.currL2),  c3 = stats(history.currL3);
      const kw = stats(history.kwTotal), freq = stats(history.frequency), pf = stats(history.pf);
      rows.push('Metric,Avg,Min,Max,Last');
      rows.push(`Voltage L1-N (V),${v1.avg},${v1.min},${v1.max},${v1.last}`);
      rows.push(`Voltage L2-N (V),${v2.avg},${v2.min},${v2.max},${v2.last}`);
      rows.push(`Voltage L3-N (V),${v3.avg},${v3.min},${v3.max},${v3.last}`);
      rows.push(`Current L1 (A),${c1.avg},${c1.min},${c1.max},${c1.last}`);
      rows.push(`Current L2 (A),${c2.avg},${c2.min},${c2.max},${c2.last}`);
      rows.push(`Current L3 (A),${c3.avg},${c3.min},${c3.max},${c3.last}`);
      rows.push(`Active Power kW,${kw.avg},${kw.min},${kw.max},${kw.last}`);
      rows.push(`Frequency Hz,${freq.avg},${freq.min},${freq.max},${freq.last}`);
      rows.push(`Power Factor,${pf.avg},${pf.min},${pf.max},${pf.last}`);
    }
    rows.push('');
    rows.push('Refill Log');
    rows.push('Time,Before(L),After(L),Added(L),Person');
    (refills||[]).forEach(r => rows.push(`${r.time},${r.beforeL},${r.afterL},${r.addedL},${r.person||''}`));

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `gensight_daily_summary_${date}.csv`;
    a.click();
  }

  // ── Open/close ───────────────────────────────────────────
  function openSummary() {
    overlay.classList.add('open');
    document.getElementById('dsDate').value = currentDate || todayStr();
    document.querySelectorAll('.ds-preset-btn').forEach(b => b.classList.remove('active'));
    loadSummary(currentDate || todayStr());
  }
  function closeSummary() {
    overlay.classList.remove('open');
  }

  document.getElementById('dsCloseBtn').addEventListener('click', closeSummary);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSummary(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeSummary(); });

  document.getElementById('dsDate').addEventListener('change', e => {
    document.querySelectorAll('.ds-preset-btn').forEach(b => b.classList.remove('active'));
    loadSummary(e.target.value);
  });

  overlay.querySelectorAll('.ds-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ds-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const d = btn.dataset.preset === 'today' ? todayStr() : daysAgoStr(1);
      document.getElementById('dsDate').value = d;
      loadSummary(d);
    });
  });

  document.getElementById('dsExportBtn').addEventListener('click', exportCSV);

  // ── Hook up the existing 📝 button ─────────────────────────
  function wireButton() {
    const btn = document.getElementById('dailySummaryBtn') || document.querySelector('.summary-card');
    if (!btn || btn.dataset.dsWired) return;
    btn.dataset.dsWired = '1';
    btn.addEventListener('click', openSummary);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButton);
  } else {
    setTimeout(wireButton, 300);
  }

})();