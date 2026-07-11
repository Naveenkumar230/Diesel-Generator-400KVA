'use strict';

// ════════════════════════════════════════════════════════════════
//  GenSight Refill Tracker  — fully responsive rewrite
// ════════════════════════════════════════════════════════════════

(function () {

  const TANK_CAPACITY = 780;

  // ── CSS ──────────────────────────────────────────────────────
  const STYLE = `

  /* ══ POPUP ══════════════════════════════════════════════════ */
  #refillPopupOverlay {
    display: none; position: fixed; inset: 0; z-index: 999999;
    background: rgba(15,23,42,.65); backdrop-filter: blur(6px);
    align-items: center; justify-content: center;
    padding: 12px;
    box-sizing: border-box;
  }
  #refillPopupOverlay.open { display: flex; }

  .rp-box {
    background: #fff; border-radius: 20px;
    border: 2px solid #059669;
    box-shadow: 0 24px 64px rgba(5,150,105,.25), 0 0 0 4px rgba(5,150,105,.08);
    width: 100%; max-width: 480px;
    font-family: 'Nunito', sans-serif;
    animation: rpSlide .28s cubic-bezier(.34,1.56,.64,1);
    overflow: hidden;
  }
  @keyframes rpSlide {
    from { transform: translateY(40px) scale(.94); opacity: 0; }
    to   { transform: translateY(0) scale(1);      opacity: 1; }
  }
  .rp-head {
    background: linear-gradient(135deg, #059669, #047857);
    padding: 16px 20px;
    display: flex; align-items: center; gap: 12px;
  }
  .rp-icon { font-size: 2rem; line-height: 1; }
  .rp-head-text { flex: 1; min-width: 0; }
  .rp-title { font-size: 1rem; font-weight: 900; color: #fff; }
  .rp-subtitle { font-size: .74rem; color: rgba(255,255,255,.8); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .rp-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }

  .rp-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  }
  .rp-stat {
    background: #F0FDF4; border: 1.5px solid #BBF7D0;
    border-radius: 10px; padding: 10px 8px; text-align: center;
  }
  .rp-stat-icon { font-size: 1.1rem; }
  .rp-stat-val {
    font-size: 1.15rem; font-weight: 900; color: #059669;
    font-family: 'JetBrains Mono', monospace; margin: 2px 0 1px;
  }
  .rp-stat-lbl { font-size: .60rem; font-weight: 800; color: #6B7280; text-transform: uppercase; letter-spacing: .06em; }

  .rp-added-banner {
    background: linear-gradient(135deg, #ECFDF5, #D1FAE5);
    border: 2px solid #059669; border-radius: 10px;
    padding: 12px; text-align: center;
  }
  .rp-added-num {
    font-size: 2rem; font-weight: 900; color: #059669;
    font-family: 'JetBrains Mono', monospace; line-height: 1;
  }
  .rp-added-lbl { font-size: .74rem; font-weight: 800; color: #047857; margin-top: 2px; }

  .rp-person-lbl {
    font-size: .68rem; font-weight: 800; color: #6B7280;
    text-transform: uppercase; letter-spacing: .08em; margin-bottom: 7px;
  }
  .rp-person-input {
    width: 100%; padding: 10px 12px; border-radius: 10px;
    border: 2px solid #D1D5DB; background: #F9FAFB;
    font-family: 'Nunito', sans-serif; font-size: .9rem;
    font-weight: 700; color: #1A2340; outline: none;
    box-sizing: border-box; transition: border-color .18s;
  }
  .rp-person-input:focus { border-color: #059669; background: #fff; }
  .rp-person-input::placeholder { color: #9CA3AF; font-weight: 600; }

  .rp-quick-names {
    display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;
  }
  .rp-qname {
    padding: 5px 12px; border-radius: 20px;
    border: 1.5px solid #D1D5DB; background: #F9FAFB;
    color: #4B5563; font-family: inherit; font-size: .72rem;
    font-weight: 700; cursor: pointer; transition: all .15s;
  }
  .rp-qname:hover  { border-color: #059669; color: #059669; background: #F0FDF4; }
  .rp-qname.selected { border-color: #059669; background: #059669; color: #fff; }

  .rp-footer {
    display: flex; gap: 10px; padding: 0 20px 18px;
  }
  .rp-btn-confirm {
    flex: 1; padding: 11px; border-radius: 10px;
    background: linear-gradient(135deg, #059669, #047857);
    color: #fff; border: none; font-family: inherit;
    font-size: .88rem; font-weight: 900; cursor: pointer;
    box-shadow: 0 2px 8px rgba(5,150,105,.35); transition: all .18s;
  }
  .rp-btn-confirm:hover { background: linear-gradient(135deg, #047857, #065F46); }
  .rp-btn-skip {
    padding: 11px 16px; border-radius: 10px;
    border: 1.5px solid #D1D5DB; background: #F9FAFB;
    color: #6B7280; font-family: inherit; font-size: .8rem;
    font-weight: 800; cursor: pointer; transition: all .15s;
  }
  .rp-btn-skip:hover { background: #F3F4F6; }

  /* ══ REFILL TRACKER CARD ════════════════════════════════════ */
  .refill-tracker-card {
    background: #fff;
    border: 1.5px solid #E2E8F5;
    border-radius: 14px;
    padding: 16px;
    box-shadow: 0 1px 8px rgba(37,99,235,.05);
    margin-top: 14px;
    font-family: 'Nunito', sans-serif;
    box-sizing: border-box;
    width: 100%;
    overflow: hidden;
  }

  /* header row */
  .rtc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .rtc-title {
    font-size: .88rem; font-weight: 900; color: #1A2340;
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  }
  .rtc-badge {
    background: #ECFDF5; border: 1.5px solid #BBF7D0;
    color: #059669; font-size: .62rem; font-weight: 800;
    padding: 2px 9px; border-radius: 20px; letter-spacing: .05em;
    text-transform: uppercase; white-space: nowrap;
  }
  .rtc-actions { display: flex; gap: 7px; flex-wrap: wrap; }
  .rtc-btn {
    padding: 6px 12px; border-radius: 8px; border: 1.5px solid #C8D5EF;
    background: #F8FAFF; color: #4A5568; font-family: inherit;
    font-size: .72rem; font-weight: 800; cursor: pointer; transition: all .15s;
    white-space: nowrap;
  }
  .rtc-btn:hover { border-color: #2563EB; color: #2563EB; background: #EFF6FF; }
  .rtc-btn.green { border-color: #BBF7D0; color: #059669; background: #F0FDF4; }
  .rtc-btn.green:hover { background: #DCFCE7; }

  /* ── summary grid — 2 cols on mobile, 4 on wide ── */
  .rtc-summary {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  @media (min-width: 540px) {
    .rtc-summary { grid-template-columns: repeat(4, 1fr); }
  }
  .rtc-sum-item {
    background: #F8FAFF; border: 1.5px solid #E2E8F5;
    border-radius: 10px; padding: 10px 12px;
    min-width: 0;
  }
  .rtc-sum-lbl {
    font-size: .60rem; font-weight: 800; color: #8A9BB5;
    text-transform: uppercase; letter-spacing: .07em; margin-bottom: 4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .rtc-sum-val {
    font-size: 1rem; font-weight: 900; color: #1A2340;
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .rtc-sum-sub { font-size: .60rem; color: #8A9BB5; margin-top: 2px; }

  /* ── chart ── */
  .rtc-chart-wrap {
    position: relative;
    height: 180px;
    margin-bottom: 14px;
    width: 100%;
  }

  /* ── table — scroll on small screens ── */
  .rtc-table-wrap {
    overflow-x: auto;
    border-radius: 10px;
    border: 1.5px solid #E2E8F5;
    -webkit-overflow-scrolling: touch;
  }
  .rtc-table {
    width: 100%;
    min-width: 520px;   /* allows horizontal scroll on mobile */
    border-collapse: collapse;
    font-size: .72rem;
  }
  .rtc-table th {
    background: #1A2340; color: #fff; padding: 7px 10px;
    text-align: left; font-size: .60rem; font-weight: 800;
    letter-spacing: .06em; text-transform: uppercase; white-space: nowrap;
  }
  .rtc-table td {
    padding: 7px 10px; border-bottom: 1px solid #F0F4FF;
    color: #1A2340; white-space: nowrap;
  }
  .rtc-table tr:last-child td { border-bottom: none; }
  .rtc-table tr:nth-child(even) td { background: #F8FAFF; }
  .rtc-table tr:hover td { background: #EFF6FF; }
  .rtc-added-cell { font-weight: 900; color: #059669; font-family: 'JetBrains Mono', monospace; }
  .rtc-person-cell { display: flex; align-items: center; gap: 5px; }
  .rtc-person-edit {
    background: none; border: none; cursor: pointer;
    font-size: .68rem; color: #8A9BB5; padding: 2px 4px;
    border-radius: 4px; transition: all .15s; flex-shrink: 0;
  }
  .rtc-person-edit:hover { background: #F0F4FF; color: #2563EB; }
  .rtc-auto-badge {
    font-size: .56rem; background: #FEF3C7; color: #92400E;
    padding: 1px 5px; border-radius: 8px; font-weight: 700;
    white-space: nowrap;
  }
  .rtc-empty {
    text-align: center; padding: 28px 16px; color: #8A9BB5;
    font-size: .80rem; font-style: italic; line-height: 1.6;
  }

  /* ── threshold config ── */
  .rtc-config {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; background: #F8FAFF;
    border: 1.5px solid #E2E8F5; border-radius: 10px;
    margin-top: 10px; flex-wrap: wrap;
  }
  .rtc-config-lbl { font-size: .68rem; font-weight: 800; color: #6B7280; white-space: nowrap; }
  .rtc-config input[type=range] { flex: 1; min-width: 80px; accent-color: #059669; }
  .rtc-config-val {
    font-size: .80rem; font-weight: 900; color: #059669;
    font-family: 'JetBrains Mono', monospace; min-width: 56px;
    white-space: nowrap;
  }
  .rtc-config-hint {
    font-size: .60rem; color: #9CA3AF; width: 100%;
  }

  /* ══ TOAST ══════════════════════════════════════════════════ */
  #refillToast {
    display: none; position: fixed; bottom: 16px; right: 16px;
    left: 16px;
    z-index: 99998; background: #1A2340;
    border: 2px solid #059669; border-radius: 14px;
    padding: 14px 18px; max-width: 360px;
    margin-left: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,.35);
    animation: rtToast .3s ease;
    font-family: 'Nunito', sans-serif;
    box-sizing: border-box;
  }
  @media (min-width: 420px) {
    #refillToast { left: auto; }
  }
  @keyframes rtToast {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .rt-toast-title { font-size: .86rem; font-weight: 900; color: #34D399; margin-bottom: 4px; }
  .rt-toast-body  { font-size: .74rem; color: #CBD5E1; line-height: 1.5; }
  .rt-toast-btn {
    margin-top: 10px; padding: 7px 14px; border-radius: 8px;
    background: #059669; border: none; color: #fff;
    font-family: inherit; font-size: .74rem; font-weight: 800;
    cursor: pointer; width: 100%;
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── State ────────────────────────────────────────────────────
  let refillRecords = [];
  let pendingRefill = null;
  let refillChart   = null;
  let thresholdL = 30; // fallback until settings load
  fetch('/api/settings').then(r => r.json()).then(s => { if (s.refillThresholdL) thresholdL = s.refillThresholdL; }).catch(()=>{});

  const QUICK_NAMES = ['Naveen', 'Ravi', 'Suresh', 'Kumar', 'Contractor'];

  // ── Popup ────────────────────────────────────────────────────
  const popupEl = document.createElement('div');
  popupEl.id = 'refillPopupOverlay';
  popupEl.innerHTML = `
    <div class="rp-box">
      <div class="rp-head">
        <div class="rp-icon">⛽</div>
        <div class="rp-head-text">
          <div class="rp-title">🚨 Refill Detected!</div>
          <div class="rp-subtitle" id="rpSubtitle">Fuel level jumped — recording refill event</div>
        </div>
      </div>
      <div class="rp-body">
        <div class="rp-stats">
          <div class="rp-stat">
            <div class="rp-stat-icon">📉</div>
            <div class="rp-stat-val" id="rpBefore">—</div>
            <div class="rp-stat-lbl">Before (L)</div>
          </div>
          <div class="rp-stat">
            <div class="rp-stat-icon">📈</div>
            <div class="rp-stat-val" id="rpAfter">—</div>
            <div class="rp-stat-lbl">After (L)</div>
          </div>
          <div class="rp-stat">
            <div class="rp-stat-icon">📊</div>
            <div class="rp-stat-val" id="rpPct">—</div>
            <div class="rp-stat-lbl">Level Now</div>
          </div>
        </div>
        <div class="rp-added-banner">
          <div class="rp-added-num" id="rpAdded">—</div>
          <div class="rp-added-lbl">Litres Added to Tank</div>
        </div>
        <div>
          <div class="rp-person-lbl">👤 Who refilled the tank?</div>
          <input type="text" class="rp-person-input" id="rpPersonInput"
            placeholder="Enter name or select below…" autocomplete="off">
          <div class="rp-quick-names" id="rpQuickNames">
            ${QUICK_NAMES.map(n => `<button class="rp-qname" data-name="${n}">${n}</button>`).join('')}
            <button class="rp-qname" data-name="Auto-detected">Skip / Auto</button>
          </div>
        </div>
      </div>
      <div class="rp-footer">
        <button class="rp-btn-skip" id="rpSkipBtn">Skip</button>
        <button class="rp-btn-confirm" id="rpConfirmBtn">✅ Save Refill Record</button>
      </div>
    </div>
  `;
  document.body.appendChild(popupEl);

  // ── Toast ────────────────────────────────────────────────────
  const toastEl = document.createElement('div');
  toastEl.id = 'refillToast';
  toastEl.innerHTML = `
    <div class="rt-toast-title">⛽ Refill Detected!</div>
    <div class="rt-toast-body" id="refillToastBody">—</div>
    <button class="rt-toast-btn" id="refillToastBtn">👤 Add Name & View Details</button>
  `;
  document.body.appendChild(toastEl);

  // ── Popup wiring ─────────────────────────────────────────────
  document.getElementById('rpConfirmBtn').addEventListener('click', () => {
    savePerson(document.getElementById('rpPersonInput').value.trim() || 'Unknown');
  });
  document.getElementById('rpSkipBtn').addEventListener('click', () => {
    savePerson('Auto-detected');
  });
  document.getElementById('rpQuickNames').addEventListener('click', e => {
    const btn = e.target.closest('.rp-qname');
    if (!btn) return;
    document.getElementById('rpPersonInput').value = btn.dataset.name;
    document.querySelectorAll('.rp-qname').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  document.getElementById('refillToastBtn').addEventListener('click', () => {
    hideToast();
    if (pendingRefill) showPopup(pendingRefill);
  });

  function showPopup(record) {
    pendingRefill = record;
    document.getElementById('rpBefore').textContent  = record.beforeL;
    document.getElementById('rpAfter').textContent   = record.afterL;
    document.getElementById('rpAdded').textContent   = '+' + record.addedL + ' L';
    document.getElementById('rpPct').textContent     = record.afterPct + '%';
    document.getElementById('rpSubtitle').textContent =
      new Date(record.time).toLocaleTimeString('en-IN', {hour12:true}) + ' — +' + record.addedL + 'L';
    document.getElementById('rpPersonInput').value = '';
    document.querySelectorAll('.rp-qname').forEach(b => b.classList.remove('selected'));
    popupEl.classList.add('open');
  }
  function hidePopup() { popupEl.classList.remove('open'); }

  function savePerson(name) {
    if (!pendingRefill) { hidePopup(); return; }
    const rec = refillRecords.find(r => r.id === pendingRefill.id);
    if (rec) { rec.person = name; rec.auto = false; }
    if (pendingRefill.id) {
      fetch(`/api/refills/${pendingRefill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person: name })
      }).catch(e => console.warn('[Refill] PATCH error:', e));
    }
    pendingRefill.person = name;
    hidePopup();
    renderRefillCard();
  }

  // ── Toast ────────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(record) {
    document.getElementById('refillToastBody').innerHTML =
      `<strong>+${record.addedL} L</strong> added at ` +
      new Date(record.time).toLocaleTimeString('en-IN', {hour12:true}) +
      `<br>${record.beforeL}L → ${record.afterL}L &nbsp;|&nbsp; Tank: ${record.afterPct}% full`;
    toastEl.style.display = 'block';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 12000);
  }
  function hideToast() { toastEl.style.display = 'none'; }

  // ── Fetch from server ────────────────────────────────────────
  async function loadRefills() {
    try {
      const r = await fetch('/api/refills');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      refillRecords = await r.json();
      renderRefillCard();
    } catch(e) {
      console.warn('[Refill] Load error:', e.message);
    }
  }

  // ── Inject card into Fuel section ────────────────────────────
  function injectRefillCard() {
    const fuelSection = Array.from(document.querySelectorAll('section.section'))
      .find(s => s.querySelector('.fuel-tag'));
    if (!fuelSection) return;
    if (document.getElementById('refillTrackerCard')) return;

    const cardRow = fuelSection.querySelector('.card-row.fuel-detail-row');
    if (!cardRow) return;

    const wrapper = document.createElement('div');
wrapper.style.cssText = 'grid-column:1/-1;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;';
    wrapper.innerHTML = `
      <div class="refill-tracker-card" id="refillTrackerCard">

        <div class="rtc-header">
          <div class="rtc-title">
            ⛽ Refill History &amp; Tracker
            <span class="rtc-badge" id="rtcBadge">0 refills</span>
          </div>
          <div class="rtc-actions">
            <button class="rtc-btn green" id="rtcManualBtn">➕ Manual</button>
            <button class="rtc-btn" id="rtcRefreshBtn">🔄 Refresh</button>
          </div>
        </div>

        <!-- Summary — 2-col on mobile, 4-col on desktop -->
        <div class="rtc-summary">
          <div class="rtc-sum-item">
            <div class="rtc-sum-lbl">Total Refills</div>
            <div class="rtc-sum-val" id="rtcTotalCount">—</div>
            <div class="rtc-sum-sub">all time</div>
          </div>
          <div class="rtc-sum-item">
            <div class="rtc-sum-lbl">Total Added</div>
            <div class="rtc-sum-val" id="rtcTotalL">— L</div>
            <div class="rtc-sum-sub">cumulative</div>
          </div>
          <div class="rtc-sum-item">
            <div class="rtc-sum-lbl">Last Refill</div>
            <div class="rtc-sum-val" id="rtcLastAdded">— L</div>
            <div class="rtc-sum-sub" id="rtcLastTime">—</div>
          </div>
          <div class="rtc-sum-item">
            <div class="rtc-sum-lbl">Avg / Refill</div>
            <div class="rtc-sum-val" id="rtcAvgL">— L</div>
            <div class="rtc-sum-sub">litres</div>
          </div>
        </div>

        <!-- Chart -->
        <div class="rtc-chart-wrap">
          <canvas id="refillChart"></canvas>
        </div>

        <!-- Table with horizontal scroll on small screens -->
        <div class="rtc-table-wrap">
          <table class="rtc-table">
            <thead>
              <tr>
                <th>📅 Date &amp; Time</th>
                <th>Before (L)</th>
                <th>After (L)</th>
                <th>➕ Added</th>
                <th>Before %</th>
                <th>After %</th>
                <th>👤 Person</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody id="refillTableBody">
              <tr><td colspan="8" class="rtc-empty">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    cardRow.appendChild(wrapper);

    document.getElementById('rtcRefreshBtn').addEventListener('click', loadRefills);
    document.getElementById('rtcManualBtn').addEventListener('click', showManualEntry);
    buildRefillChart();
  }

  // ── Chart ────────────────────────────────────────────────────
  function buildRefillChart() {
    const canvas = document.getElementById('refillChart');
    if (!canvas) return;
    if (refillChart) { refillChart.destroy(); refillChart = null; }

    const sorted = [...refillRecords].sort((a, b) => new Date(a.time) - new Date(b.time));
    const labels = sorted.map(r => {
      const d = new Date(r.time);
      return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
    });

    refillChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Litres Added',
            data: sorted.map(r => r.addedL),
            backgroundColor: sorted.map(r =>
              r.addedL > 300 ? 'rgba(5,150,105,.85)' :
              r.addedL > 150 ? 'rgba(37,99,235,.75)' : 'rgba(217,119,6,.75)'
            ),
            borderColor: sorted.map(r =>
              r.addedL > 300 ? '#059669' : r.addedL > 150 ? '#2563EB' : '#D97706'
            ),
            borderWidth: 2, borderRadius: 5, yAxisID: 'yL'
          },
          {
            label: 'Tank After (%)',
            data: sorted.map(r => r.afterPct),
            type: 'line',
            borderColor: '#7C3AED',
            backgroundColor: 'rgba(124,58,237,.08)',
            borderWidth: 2, tension: 0.4, pointRadius: 4,
            pointBackgroundColor: '#7C3AED', fill: false, yAxisID: 'yR'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'JetBrains Mono', size: 10 },
              boxWidth: 10, padding: 10, color: '#4A5568'
            }
          },
          tooltip: {
            backgroundColor: '#1A2340',
            titleColor: '#fff', bodyColor: '#CBD5E1',
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            callbacks: {
              afterBody(items) {
                const r = sorted[items[0].dataIndex];
                if (!r) return '';
                return [`Before: ${r.beforeL}L (${r.beforePct}%)`,
                        `After:  ${r.afterL}L (${r.afterPct}%)`,
                        `Person: ${r.person}`];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5', maxRotation: 30 },
            grid: { color: 'rgba(0,0,0,.04)' }
          },
          yL: {
            position: 'left',
            title: { display: true, text: 'Litres Added', color: '#8A9BB5', font: { size: 9 } },
            ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' },
            grid: { color: 'rgba(0,0,0,.04)' }
          },
          yR: {
            position: 'right',
            title: { display: true, text: 'Tank % After', color: '#8A9BB5', font: { size: 9 } },
            min: 0, max: 100,
            ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  // ── Render table + summary ────────────────────────────────────
  function renderRefillCard() {
    if (!document.getElementById('refillTrackerCard')) return;

    const total  = refillRecords.length;
    const totalL = refillRecords.reduce((s, r) => s + (r.addedL || 0), 0);
    const avgL   = total > 0 ? Math.round(totalL / total) : 0;
    const last   = refillRecords[0];

    document.getElementById('rtcBadge').textContent      = total + ' refill' + (total !== 1 ? 's' : '');
    document.getElementById('rtcTotalCount').textContent  = total;
    document.getElementById('rtcTotalL').textContent      = totalL + ' L';
    document.getElementById('rtcAvgL').textContent        = avgL + ' L';
    if (last) {
      document.getElementById('rtcLastAdded').textContent = '+' + last.addedL + ' L';
      document.getElementById('rtcLastTime').textContent  =
        new Date(last.time).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    }

    const tbody = document.getElementById('refillTableBody');
    if (!tbody) return;

    if (refillRecords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="rtc-empty">
        ⛽ No refill events recorded yet.<br>
        The system auto-detects when fuel increases by ${thresholdL}+ litres.
      </td></tr>`;
    } else {
      tbody.innerHTML = refillRecords.map(r => {
        const dt      = new Date(r.time);
        const dateStr = dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
        return `
          <tr>
            <td><strong>${dateStr}</strong><br>
                <span style="font-size:.66rem;color:#8A9BB5">${timeStr}</span></td>
            <td style="font-family:'JetBrains Mono',monospace">${r.beforeL} L</td>
            <td style="font-family:'JetBrains Mono',monospace">${r.afterL} L</td>
            <td class="rtc-added-cell">+${r.addedL} L</td>
            <td style="color:#D97706;font-family:'JetBrains Mono',monospace">${r.beforePct}%</td>
            <td style="color:#059669;font-family:'JetBrains Mono',monospace">${r.afterPct}%</td>
            <td>
              <div class="rtc-person-cell">
                <span>${r.person || '—'}</span>
                ${r.auto !== false ? '<span class="rtc-auto-badge">auto</span>' : ''}
                <button class="rtc-person-edit"
                  onclick="window._refillEditPerson('${r.id}')" title="Edit">✏️</button>
              </div>
            </td>
            <td style="font-size:.64rem;color:#8A9BB5">${r.auto !== false ? 'Auto' : 'Manual'}</td>
          </tr>`;
      }).join('');
    }

    buildRefillChart();
  }

  // ── Edit person inline ────────────────────────────────────────
  window._refillEditPerson = function(id) {
    const rec = refillRecords.find(r => r.id === id);
    if (!rec) return;
    const name = prompt(`Edit person for refill of +${rec.addedL}L:`, rec.person || '');
    if (name === null) return;
    const trimmed = name.trim() || 'Unknown';
    rec.person = trimmed; rec.auto = false;
    fetch(`/api/refills/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person: trimmed })
    }).catch(e => console.warn('[Refill] PATCH error:', e));
    renderRefillCard();
  };

  // ── Manual entry ──────────────────────────────────────────────
  function showManualEntry() {
    const before = prompt('Fuel level BEFORE refill (litres):');
    if (before === null) return;
    const after  = prompt('Fuel level AFTER refill (litres):');
    if (after  === null) return;
    const person = prompt('Who refilled? (name):') || 'Manual entry';

    const beforeL = parseInt(before), afterL = parseInt(after);
    if (isNaN(beforeL) || isNaN(afterL) || afterL <= beforeL) {
      alert('Invalid. After must be greater than Before.');
      return;
    }
    fetch('/api/refills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeL, afterL, person })
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.record) {
        refillRecords.unshift(data.record);
        renderRefillCard();
      }
    })
    .catch(e => console.warn('[Refill] Manual entry error:', e));
  }

  // ── Socket.IO ─────────────────────────────────────────────────
  function hookSocket() {
    if (!window.io) return;
    const _sock = io({ transports: ['websocket', 'polling'] });
    _sock.on('refill:detected', function(record) {
      console.log('[Refill] 🚨 Socket event:', record);
      if (!refillRecords.find(r => r.id === record.id)) {
        refillRecords.unshift(record);
      }
      showToast(record);
      setTimeout(() => showPopup(record), 800);
      renderRefillCard();
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    injectRefillCard();
    loadRefills();
    hookSocket();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

})();