(function () {
  'use strict';

  // ── Inject CSS ────────────────────────────────────────────────
  const STYLE = `
  /* ── Export Button in Header ── */
  /* ── Export Button in Header ── */
.gs-export-btn {
  display: flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, #059669, #047857);
  color: #fff; border: none;
  padding: 8px 16px; border-radius: 8px;
  cursor: pointer; font-family: 'Nunito', sans-serif;
  font-size: .78rem; font-weight: 800;
  box-shadow: 0 2px 8px rgba(5,150,105,.3);
  transition: all .18s; white-space: nowrap; flex-shrink: 0;
  /* ADD THESE: */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ADD THIS NEW BLOCK: */
@media (max-width: 480px) {
  .gs-export-btn {
    padding: 6px 10px;
    font-size: .70rem;
    gap: 4px;
  }
}
  .gs-export-btn:hover {
    background: linear-gradient(135deg, #047857, #065F46);
    box-shadow: 0 4px 16px rgba(5,150,105,.4);
    transform: translateY(-1px);
  }

  /* ── Modal Overlay ── */
  #gsExportModal {
    display: none; position: fixed; inset: 0; z-index: 99999;
    background: rgba(15,23,42,.6); backdrop-filter: blur(6px);
    align-items: center; justify-content: center;
  }
  #gsExportModal.open { display: flex; }

  /* ── Modal Box ── */
  .gsem-box {
    background: #fff; border-radius: 20px;
    border: 1.5px solid #E2E8F5;
    box-shadow: 0 24px 64px rgba(0,0,0,.22);
    width: min(560px, 96vw);
    max-height: 92vh; overflow-y: auto;
    animation: gsemSlide .25s ease;
    font-family: 'Nunito', sans-serif;
  }
  @keyframes gsemSlide {
    from { transform: translateY(28px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  /* ── Modal Header ── */
  .gsem-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1.5px solid #E2E8F5;
    background: linear-gradient(135deg, rgba(5,150,105,.06), rgba(37,99,235,.04));
    border-radius: 20px 20px 0 0;
  }
  .gsem-title { font-size: 1.05rem; font-weight: 900; color: #1A2340; }
  .gsem-close {
    width: 32px; height: 32px; border-radius: 50%;
    border: none; background: #F0F4FF; color: #4A5568;
    font-size: .9rem; cursor: pointer; font-weight: 700;
    display: grid; place-items: center; transition: all .15s;
  }
  .gsem-close:hover { background: #FEE2E2; color: #DC2626; }

  /* ── Modal Body ── */
  .gsem-body { padding: 22px 24px; display: flex; flex-direction: column; gap: 20px; }

  /* ── Section Label ── */
  .gsem-lbl {
    font-size: .68rem; font-weight: 900; letter-spacing: .1em;
    text-transform: uppercase; color: #8A9BB5; margin-bottom: 10px;
  }

  /* ── Mode Toggle ── */
  .gsem-mode-row {
    display: flex; gap: 10px;
  }
  .gsem-mode-btn {
    flex: 1; padding: 10px 14px; border-radius: 10px;
    border: 2px solid #E2E8F5; background: #F8FAFF;
    color: #4A5568; font-family: inherit; font-size: .82rem;
    font-weight: 800; cursor: pointer; text-align: center;
    transition: all .18s;
  }
  .gsem-mode-btn.active {
    border-color: #059669; background: rgba(5,150,105,.08);
    color: #059669;
  }

  /* ── Date Row ── */
  .gsem-date-row {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .gsem-date-group { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 140px; }
  .gsem-date-group label {
    font-size: .65rem; font-weight: 800; color: #8A9BB5; letter-spacing: .07em; text-transform: uppercase;
  }
  .gsem-date-group input[type=date] {
    background: #F8FAFF; border: 1.5px solid #C8D5EF;
    color: #1A2340; padding: 8px 12px; border-radius: 8px;
    font-family: 'JetBrains Mono', monospace; font-size: .82rem; outline: none; cursor: pointer;
    width: 100%;
  }
  .gsem-date-group input[type=date]:focus { border-color: #059669; }

  /* ── Preset buttons ── */
  .gsem-presets { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .gsem-preset {
    padding: 5px 12px; border-radius: 20px;
    border: 1.5px solid #C8D5EF; background: #F8FAFF;
    color: #4A5568; font-family: inherit; font-size: .72rem;
    font-weight: 700; cursor: pointer; transition: all .15s;
  }
  .gsem-preset:hover { border-color: #059669; color: #059669; background: rgba(5,150,105,.06); }

  /* ── Section Checkboxes ── */
  .gsem-checks {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  .gsem-check-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 10px;
    border: 1.5px solid #E2E8F5; background: #F8FAFF;
    cursor: pointer; transition: all .15s; user-select: none;
  }
  .gsem-check-item:hover { border-color: #C8D5EF; }
  .gsem-check-item.checked {
    border-color: #2563EB; background: rgba(37,99,235,.06);
  }
  .gsem-check-item input[type=checkbox] { width: 16px; height: 16px; accent-color: #2563EB; cursor: pointer; }
  .gsem-check-icon { font-size: 1.1rem; }
  .gsem-check-lbl { font-size: .78rem; font-weight: 800; color: #1A2340; }

  /* ── Footer ── */
  .gsem-footer {
    display: flex; gap: 10px; align-items: center;
    padding: 16px 24px 20px;
    border-top: 1.5px solid #E2E8F5;
  }
  .gsem-export-btn {
    flex: 1; padding: 11px 20px; border-radius: 10px;
    background: linear-gradient(135deg, #059669, #047857);
    color: #fff; border: none; font-family: inherit;
    font-size: .88rem; font-weight: 900; cursor: pointer;
    transition: all .18s; box-shadow: 0 2px 8px rgba(5,150,105,.3);
  }
  .gsem-export-btn:hover { background: linear-gradient(135deg, #047857, #065F46); }
  .gsem-export-btn:disabled { opacity: .5; cursor: not-allowed; }
  .gsem-cancel-btn {
    padding: 11px 18px; border-radius: 10px;
    border: 1.5px solid #C8D5EF; background: #F8FAFF;
    color: #4A5568; font-family: inherit; font-size: .82rem;
    font-weight: 800; cursor: pointer; transition: all .15s;
  }
  .gsem-cancel-btn:hover { background: #E2E8F5; }

  /* ── Progress / Status ── */
  .gsem-status {
    font-size: .72rem; color: #8A9BB5; font-family: 'JetBrains Mono', monospace;
    min-width: 120px; text-align: right;
  }
  .gsem-status.busy { color: #D97706; }
  .gsem-status.done { color: #059669; font-weight: 700; }
  .gsem-status.err  { color: #DC2626; }

  /* ── Divider ── */
  .gsem-divider {
    height: 1px; background: #E2E8F5; margin: 0 -24px;
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Build Modal HTML ───────────────────────────────────────
  const modalEl = document.createElement('div');
  modalEl.id = 'gsExportModal';
  modalEl.innerHTML = `
    <div class="gsem-box">
      <div class="gsem-head">
        <span class="gsem-title">📥 Export to Excel</span>
        <button class="gsem-close" id="gsemCloseBtn">✕</button>
      </div>
      <div class="gsem-body">

        <!-- Mode: Live vs Historical -->
        <div>
          <div class="gsem-lbl">📡 Data Source</div>
          <div class="gsem-mode-row">
            <button class="gsem-mode-btn active" id="gsemModeLive" onclick="GSExport._setMode('live')">
              ⚡ Live Snapshot<br><span style="font-size:.68rem;font-weight:600;opacity:.7">Current readings on screen</span>
            </button>
            <button class="gsem-mode-btn" id="gsemModeHist" onclick="GSExport._setMode('history')">
              📅 Historical Range<br><span style="font-size:.68rem;font-weight:600;opacity:.7">Fetch from server database</span>
            </button>
          </div>
        </div>

        <!-- Date Range (hidden in live mode) -->
        <div id="gsemDateSection" style="display:none">
          <div class="gsem-lbl">📅 Date Range</div>
          <div class="gsem-date-row">
            <div class="gsem-date-group">
              <label>FROM</label>
              <input type="date" id="gsemFrom">
            </div>
            <div class="gsem-date-group">
              <label>TO</label>
              <input type="date" id="gsemTo">
            </div>
          </div>
          <div class="gsem-presets">
            <button class="gsem-preset" data-p="today">Today</button>
            <button class="gsem-preset" data-p="7d">Last 7 days</button>
            <button class="gsem-preset" data-p="30d">Last 30 days</button>
            <button class="gsem-preset" data-p="90d">Last 90 days</button>
          </div>
        </div>

        <div class="gsem-divider"></div>

        <!-- Section Checkboxes -->
        <div>
          <div class="gsem-lbl">📊 Sections to Export</div>
          <div class="gsem-checks">
            <label class="gsem-check-item checked" id="chk-alternator-wrap">
              <input type="checkbox" id="chk-alternator" checked>
              <span class="gsem-check-icon">⚡</span>
              <span class="gsem-check-lbl">Alternator Output</span>
            </label>
            <label class="gsem-check-item checked" id="chk-engine-wrap">
              <input type="checkbox" id="chk-engine" checked>
              <span class="gsem-check-icon">🔧</span>
              <span class="gsem-check-lbl">Engine Health</span>
            </label>
            <label class="gsem-check-item checked" id="chk-fuel-wrap">
              <input type="checkbox" id="chk-fuel" checked>
              <span class="gsem-check-icon">⛽</span>
              <span class="gsem-check-lbl">Fuel System</span>
            </label>
            <label class="gsem-check-item checked" id="chk-utility-wrap">
              <input type="checkbox" id="chk-utility" checked>
              <span class="gsem-check-icon">🏙️</span>
              <span class="gsem-check-lbl">Utility / Mains</span>
            </label>
          </div>
        </div>

      </div><!-- /gsem-body -->

      <div class="gsem-footer">
        <button class="gsem-cancel-btn" id="gsemCancelBtn">Cancel</button>
        <span class="gsem-status" id="gsemStatus">Ready</span>
        <button class="gsem-export-btn" id="gsemExportBtn">📥 Download Excel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // ── Wire up checkbox styling ───────────────────────────────
  ['alternator', 'engine', 'fuel', 'utility'].forEach(id => {
    const cb   = document.getElementById(`chk-${id}`);
    const wrap = document.getElementById(`chk-${id}-wrap`);
    cb.addEventListener('change', () => {
      wrap.classList.toggle('checked', cb.checked);
    });
  });

  // ── Wire up preset buttons ─────────────────────────────────
  document.querySelectorAll('.gsem-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const today = _todayStr();
      const presets = {
        today: [today, today],
        '7d':  [_daysAgo(6), today],
        '30d': [_daysAgo(29), today],
        '90d': [_daysAgo(89), today]
      };
      const [f, t] = presets[btn.dataset.p] || [today, today];
      document.getElementById('gsemFrom').value = f;
      document.getElementById('gsemTo').value   = t;
    });
  });

  // ── Wire close / cancel ────────────────────────────────────
  document.getElementById('gsemCloseBtn').addEventListener('click',  _close);
  document.getElementById('gsemCancelBtn').addEventListener('click', _close);
  modalEl.addEventListener('click', e => { if (e.target === modalEl) _close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _close(); });

  // ── Wire export ────────────────────────────────────────────
  document.getElementById('gsemExportBtn').addEventListener('click', _doExport);

  // ── State ─────────────────────────────────────────────────
  let _mode = 'live'; // 'live' | 'history'

  function _setMode(m) {
    _mode = m;
    document.getElementById('gsemModeLive').classList.toggle('active', m === 'live');
    document.getElementById('gsemModeHist').classList.toggle('active', m === 'history');
    document.getElementById('gsemDateSection').style.display = m === 'history' ? '' : 'none';
  }

  function _close() {
    modalEl.classList.remove('open');
  }

  function _setStatus(msg, cls = '') {
    const el = document.getElementById('gsemStatus');
    el.textContent = msg;
    el.className = 'gsem-status ' + cls;
  }

  // ── Helpers ───────────────────────────────────────────────
  function _todayStr() { return new Date().toISOString().slice(0, 10); }
  function _daysAgo(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  // ── Column definitions per sheet ──────────────────────────
  const ALTERNATOR_COLS = [
    { header: 'Timestamp',     key: 'timestamps',  unit: '',     fmt: 'text' },
    { header: 'Volt L1-N (V)', key: 'voltL1N',     unit: 'V',    min: 215, max: 245, ideal: [220,240] },
    { header: 'Volt L2-N (V)', key: 'voltL2N',     unit: 'V',    min: 215, max: 245, ideal: [220,240] },
    { header: 'Volt L3-N (V)', key: 'voltL3N',     unit: 'V',    min: 215, max: 245, ideal: [220,240] },
    { header: 'Volt L1-L2 (V)',key: 'voltL1L2',    unit: 'V',    min: 370, max: 430, ideal: [390,415] },
    { header: 'Volt L2-L3 (V)',key: 'voltL2L3',    unit: 'V',    min: 370, max: 430, ideal: [390,415] },
    { header: 'Volt L3-L1 (V)',key: 'voltL3L1',    unit: 'V',    min: 370, max: 430, ideal: [390,415] },
    { header: 'Current L1 (A)',key: 'currL1',      unit: 'A',    min: 0,   max: 577, ideal: [0,500]   },
    { header: 'Current L2 (A)',key: 'currL2',      unit: 'A',    min: 0,   max: 577, ideal: [0,500]   },
    { header: 'Current L3 (A)',key: 'currL3',      unit: 'A',    min: 0,   max: 577, ideal: [0,500]   },
    { header: 'Load L1 (%)',   key: 'currPctL1',   unit: '%',    min: 0,   max: 100, ideal: [0,80]    },
    { header: 'Load L2 (%)',   key: 'currPctL2',   unit: '%',    min: 0,   max: 100, ideal: [0,80]    },
    { header: 'Load L3 (%)',   key: 'currPctL3',   unit: '%',    min: 0,   max: 100, ideal: [0,80]    },
    { header: 'kW Total',      key: 'kwTotal',     unit: 'kW',   min: 0,   max: 320, ideal: [0,290]   },
    { header: 'kW L1',         key: 'kwL1',        unit: 'kW',   min: 0,   max: 110, ideal: [0,100]   },
    { header: 'kW L2',         key: 'kwL2',        unit: 'kW',   min: 0,   max: 110, ideal: [0,100]   },
    { header: 'kW L3',         key: 'kwL3',        unit: 'kW',   min: 0,   max: 110, ideal: [0,100]   },
    { header: 'kVA Total',     key: 'kvaTotal',    unit: 'kVA',  min: 0,   max: 400, ideal: [0,370]   },
    { header: 'kVAR Total',    key: 'kvarTotal',   unit: 'kVAR', min: 0,   max: 200, ideal: [0,150]   },
    { header: 'Frequency (Hz)',key: 'frequency',   unit: 'Hz',   min: 47,  max: 53,  ideal: [49.5,50.5] },
    { header: 'Power Factor',  key: 'pf',          unit: '',     min: 0,   max: 1,   ideal: [0.85,1]  },
  ];

  const ENGINE_COLS = [
    { header: 'Timestamp',         key: 'timestamps',    unit: '',    fmt: 'text' },
    { header: 'Engine RPM',        key: 'engineRPM',     unit: 'RPM', min: 0, max: 2000, ideal: [1490,1510] },
    { header: 'Coolant Temp (°F)', key: 'coolantTempF',  unit: '°F',  min: 0, max: 230,  ideal: [170,205]   },
    { header: 'Oil Temp (°F)',     key: 'oilTempF',      unit: '°F',  min: 0, max: 280,  ideal: [170,230]   },
    { header: 'Intake Temp (°F)',  key: 'intakeTempF',   unit: '°F',  min: 0, max: 200,  ideal: [80,130]    },
    { header: 'Fuel Temp (°F)',    key: 'fuelTempF',     unit: '°F',  min: 0, max: 160,  ideal: [60,110]    },
    { header: 'Exhaust Temp (°F)', key: 'exhaustTempF',  unit: '°F',  min: 0, max: 1200, ideal: [600,950]   },
    { header: 'Oil Press (psi)',   key: 'oilPressPsi',   unit: 'psi', min: 0, max: 120,  ideal: [20,90]     },
    { header: 'Boost Press (psi)', key: 'boostPressPsi', unit: 'psi', min: 0, max: 40,   ideal: [5,30]      },
    { header: 'Crank Press (psi)', key: 'crankPressPsi', unit: 'psi', min: 0, max: 5,    ideal: [0,2]       },
    { header: 'Fuel Supply (psi)', key: 'fuelSupplyPsi', unit: 'psi', min: 0, max: 20,   ideal: [5,15]      },
    { header: 'Coolant Press(psi)',key: 'coolantPsi',    unit: 'psi', min: 0, max: 30,   ideal: [8,20]      },
    { header: 'Torque (%)',        key: 'torquePct',     unit: '%',   min: 0, max: 100,  ideal: [0,85]      },
    { header: 'Battery V (VDC)',   key: 'battV',         unit: 'V',   min: 10.5, max: 15, ideal: [11.8,14.8] },
  ];

  const FUEL_COLS = [
    { header: 'Timestamp',         key: 'timestamps',   unit: '',   fmt: 'text' },
    { header: 'Fuel Level (%)',     key: 'fuelLevelPct', unit: '%',  min: 0, max: 100, ideal: [20,100] },
    { header: 'Fuel Volume (L)',    key: 'fuelLevelL',   unit: 'L',  min: 0, max: 800, ideal: [160,800] },
    { header: 'Fuel Supply (psi)',  key: 'fuelSupplyPsi',unit: 'psi',min: 0, max: 20,  ideal: [5,15]   },
    { header: 'Fuel Temp (°F)',     key: 'fuelTempF',    unit: '°F', min: 0, max: 160, ideal: [60,110] },
  ];

  const UTILITY_COLS = [
    { header: 'Timestamp',          key: 'timestamps',   unit: '',   fmt: 'text' },
    { header: 'Utility L1-N (V)',   key: 'utilVoltL1N',  unit: 'V',  min: 190, max: 260, ideal: [215,245] },
    { header: 'Utility L2-N (V)',   key: 'utilVoltL2N',  unit: 'V',  min: 190, max: 260, ideal: [215,245] },
    { header: 'Utility L3-N (V)',   key: 'utilVoltL3N',  unit: 'V',  min: 190, max: 260, ideal: [215,245] },
    { header: 'Utility L1-L2 (V)', key: 'utilVoltL1L2', unit: 'V',  min: 330, max: 450, ideal: [380,420] },
    { header: 'Utility L2-L3 (V)', key: 'utilVoltL2L3', unit: 'V',  min: 330, max: 450, ideal: [380,420] },
    { header: 'Utility L3-L1 (V)', key: 'utilVoltL3L1', unit: 'V',  min: 330, max: 450, ideal: [380,420] },
    { header: 'Utility Freq (Hz)', key: 'utilFrequency', unit: 'Hz', min: 47,  max: 53,  ideal: [49.5,50.5] },
    { header: 'Genset State',       key: 'gensetState',  unit: '',   fmt: 'text' },
    { header: 'AMF State',          key: 'amfState',     unit: '',   fmt: 'text' },
    { header: 'Transfer Switch',    key: 'xferSwStatus', unit: '',   fmt: 'text' },
    { header: 'Fault Code',         key: 'faultCode',    unit: '',   fmt: 'text' },
  ];

  // ── XLSX cell styles (using SheetJS Pro-style) ─────────────
  // SheetJS CE doesn't support styles natively, so we use
  // a simple trick: write an HTML table with inline styles,
  // then SheetJS reads that. This gives us colour per cell.

  // Colour palette
  const CLR = {
    headerBg:  '#1A2340',
    headerFg:  '#FFFFFF',
    peakBg:    '#DC2626',  // red  — peak max
    peakFg:    '#FFFFFF',
    highBg:    '#FEE2E2',  // light red — above ideal max
    highFg:    '#991B1B',
    lowBg:     '#FEF3C7',  // amber — below ideal min
    lowFg:     '#92400E',
    okBg:      '#D1FAE5',  // green — in ideal range
    okFg:      '#065F46',
    fuelSumHdr:'#1E40AF',
    fuelSumHdFg:'#FFFFFF',
    fuelSumEven:'#EFF6FF',
    fuelSumOdd: '#DBEAFE',
    subHdrBg:  '#374151',
    subHdrFg:  '#FFFFFF',
    altRow:    '#F8FAFF',
    white:     '#FFFFFF',
  };

  // ── Build HTML table for one sheet ────────────────────────
  function buildSheetHTML(cols, data, sheetTitle) {
    const ts = data.timestamps || [];
    if (!ts.length) return `<table><tr><td>No data available</td></tr></table>`;

    // Find peak index per column
    const peaks = {};
    cols.forEach(col => {
      if (col.fmt === 'text') return;
      const arr = data[col.key] || [];
      let maxVal = -Infinity, maxIdx = -1;
      arr.forEach((v, i) => {
        const n = parseFloat(v);
        if (!isNaN(n) && n > maxVal) { maxVal = n; maxIdx = i; }
      });
      if (maxIdx >= 0) peaks[col.key] = maxIdx;
    });

    let html = `<table>`;

    // Sheet title row
    html += `<tr><td colspan="${cols.length}" style="background:${CLR.headerBg};color:${CLR.headerFg};font-weight:900;font-size:14pt;padding:10px 14px;">${sheetTitle}</td></tr>`;

    // Column headers
    html += `<tr>`;
    cols.forEach(col => {
      html += `<td style="background:${CLR.headerBg};color:${CLR.headerFg};font-weight:800;font-size:9pt;padding:6px 10px;white-space:nowrap;">${col.header}</td>`;
    });
    html += `</tr>`;

    // Data rows
    ts.forEach((t, rowIdx) => {
      const bg = rowIdx % 2 === 0 ? CLR.white : CLR.altRow;
      html += `<tr>`;
      cols.forEach(col => {
        const raw = (data[col.key] || [])[rowIdx];
        const val = raw !== undefined ? raw : '';

        if (col.fmt === 'text' || col.key === 'timestamps') {
          html += `<td style="background:${bg};font-size:8pt;padding:4px 8px;">${val}</td>`;
          return;
        }

        const n = parseFloat(val);
        let cellBg = bg, cellFg = '#1A2340';

        if (!isNaN(n)) {
          // Peak?
          if (peaks[col.key] === rowIdx) {
            cellBg = CLR.peakBg; cellFg = CLR.peakFg;
          } else if (col.ideal) {
            // Out of ideal range?
            if (n > col.ideal[1]) {
              cellBg = CLR.highBg; cellFg = CLR.highFg;
            } else if (n < col.ideal[0] && n > 0) {
              cellBg = CLR.lowBg; cellFg = CLR.lowFg;
            }
          }
        }

        const disp = isNaN(n) ? val : parseFloat(n.toFixed(2));
        html += `<td style="background:${cellBg};color:${cellFg};font-size:8pt;padding:4px 8px;text-align:right;">${disp}</td>`;
      });
      html += `</tr>`;
    });

    html += `</table>`;
    return html;
  }

  // ── Build Fuel Sheet HTML (summary + raw) ──────────────────
  function buildFuelSheetHTML(data, isRange) {
    const ts        = data.timestamps    || [];
    const pctArr    = data.fuelLevelPct  || [];
    const litresArr = data.fuelLevelL    || [];
    const TANK      = 800;

    // ── Daily Summary (always shown) ──────────────────────────
    // Group readings by date prefix
    const byDate = {};
    ts.forEach((t, i) => {
      const dk = String(t).slice(0, 10); // "YYYY-MM-DD" or first 10 chars of time
      if (!byDate[dk]) byDate[dk] = [];
      byDate[dk].push({ t, pct: pctArr[i] || 0, litres: litresArr[i] || 0, idx: i });
    });

    const dates = Object.keys(byDate).sort();

    let html = `<table>`;

    // ── Summary Header ────────────────────────────────────────
    html += `<tr><td colspan="8" style="background:${CLR.fuelSumHdr};color:${CLR.fuelSumHdFg};font-weight:900;font-size:14pt;padding:10px 14px;">⛽ Fuel System — Cummins 400kVA / 715L Tank</td></tr>`;
    html += `<tr><td colspan="8" style="background:#1E3A8A;color:#BFDBFE;font-size:9pt;padding:6px 14px;font-style:italic;">Daily Fuel Consumption Summary</td></tr>`;

    // Summary column headers
    const sumCols = ['Date', 'Start Level (%)', 'Start Volume (L)', 'End Level (%)', 'End Volume (L)', 'Consumed (L)', 'Burn Rate (L/hr)', 'Est. Hrs Remaining (EOD)'];
    html += `<tr>`;
    sumCols.forEach(h => {
      html += `<td style="background:${CLR.subHdrBg};color:${CLR.subHdrFg};font-weight:800;font-size:9pt;padding:6px 10px;white-space:nowrap;">${h}</td>`;
    });
    html += `</tr>`;

    // Summary rows
    dates.forEach((dk, di) => {
      const dayRows = byDate[dk];
      const first   = dayRows[0];
      const last    = dayRows[dayRows.length - 1];
      const consumed = Math.max(0, first.litres - last.litres);

      // Burn rate: consumed / hours spanned
      // Try to parse times from timestamps
      let burnRate = '—';
      let hrsLeft  = '—';
      try {
        const t0 = new Date(`${dk}T${String(first.t).slice(-8)}`);
        const t1 = new Date(`${dk}T${String(last.t).slice(-8)}`);
        const hrs = Math.abs(t1 - t0) / 3600000;
        if (hrs > 0 && consumed > 0) {
          const br = consumed / hrs;
          burnRate = br.toFixed(1);
          hrsLeft  = (last.litres / br).toFixed(0);
        }
      } catch(e) { /* ignore */ }

      const rowBg = di % 2 === 0 ? CLR.fuelSumEven : CLR.fuelSumOdd;
      const consumedBg = consumed > 100 ? CLR.highBg : consumed > 50 ? CLR.lowBg : rowBg;

      html += `<tr>`;
      html += `<td style="background:${rowBg};font-weight:800;font-size:9pt;padding:5px 10px;">${dk}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${first.pct.toFixed(1)}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${first.litres.toFixed(0)}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${last.pct.toFixed(1)}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${last.litres.toFixed(0)}</td>`;
      html += `<td style="background:${consumedBg};font-weight:700;text-align:right;font-size:9pt;padding:5px 10px;">${consumed.toFixed(0)}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${burnRate}</td>`;
      html += `<td style="background:${rowBg};text-align:right;font-size:9pt;padding:5px 10px;">${hrsLeft}</td>`;
      html += `</tr>`;
    });

    // Spacer
    html += `<tr><td colspan="8" style="height:24px;"></td></tr>`;

    // ── Raw Time-Series ────────────────────────────────────────
    html += `<tr><td colspan="8" style="background:#374151;color:#fff;font-weight:800;font-size:10pt;padding:8px 14px;">📋 Raw Time-Series Data</td></tr>`;

    // Find peaks
    const peakPctIdx    = pctArr.reduce((mi, v, i) => v > (pctArr[mi]||0) ? i : mi, 0);
    const peakLitresIdx = litresArr.reduce((mi, v, i) => v > (litresArr[mi]||0) ? i : mi, 0);

    const rawCols = ['Timestamp', 'Fuel Level (%)', 'Volume (L)', 'Supply Psi', 'Fuel Temp (°F)'];
    html += `<tr>`;
    rawCols.forEach(h => {
      html += `<td colspan="${h==='Timestamp'?1:1}" style="background:${CLR.subHdrBg};color:${CLR.subHdrFg};font-weight:800;font-size:9pt;padding:5px 10px;">${h}</td>`;
    });
    html += `<td colspan="3"></td></tr>`;

    const fuelPsiArr  = data.fuelSupplyPsi || [];
    const fuelTempArr = data.fuelTempF     || [];

    ts.forEach((t, i) => {
      const bg   = i % 2 === 0 ? CLR.white : CLR.altRow;
      const pct  = (pctArr[i]    || 0).toFixed(1);
      const lit  = (litresArr[i] || 0).toFixed(0);
      const psi  = (fuelPsiArr[i] || 0).toFixed(1);
      const tmp  = (fuelTempArr[i] || 0).toFixed(1);

      const pctBg  = i === peakPctIdx    ? CLR.peakBg : pctArr[i]    < 20 ? CLR.highBg : bg;
      const litBg  = i === peakLitresIdx ? CLR.peakBg : litresArr[i] < 160 ? CLR.highBg : bg;
      const pctFg  = i === peakPctIdx    ? CLR.peakFg : '#1A2340';
      const litFg  = i === peakLitresIdx ? CLR.peakFg : '#1A2340';

      html += `<tr>`;
      html += `<td style="background:${bg};font-size:8pt;padding:3px 8px;">${t}</td>`;
      html += `<td style="background:${pctBg};color:${pctFg};text-align:right;font-size:8pt;padding:3px 8px;">${pct}</td>`;
      html += `<td style="background:${litBg};color:${litFg};text-align:right;font-size:8pt;padding:3px 8px;">${lit}</td>`;
      html += `<td style="background:${bg};text-align:right;font-size:8pt;padding:3px 8px;">${psi}</td>`;
      html += `<td style="background:${bg};text-align:right;font-size:8pt;padding:3px 8px;">${tmp}</td>`;
      html += `<td colspan="3"></td></tr>`;
    });

    html += `</table>`;
    return html;
  }

  // ── Fetch data from server ─────────────────────────────────
  async function fetchHistoryData(from, to) {
    try {
      const r = await fetch(`/api/history?from=${from}&to=${to}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.timestamps || json.timestamps.length === 0 || json.noData) return null;
      return json;
    } catch(e) {
      console.warn('[GSExport] Fetch failed:', e.message);
      return null;
    }
  }

  // ── Get live data from in-memory dayStore ──────────────────
  function getLiveData() {
    // dayStore is defined in app.js scope — access via window or try to reference
    if (typeof dayStore !== 'undefined' && dayStore.timestamps && dayStore.timestamps.length > 0) {
      return {
        timestamps:   dayStore.timestamps,
        voltL1N:      dayStore.voltL1N,    voltL2N:      dayStore.voltL2N,    voltL3N:      dayStore.voltL3N,
        voltL1L2:     dayStore.voltL1L2,   voltL2L3:     dayStore.voltL2L3,   voltL3L1:     dayStore.voltL3L1,
        currL1:       dayStore.currL1,     currL2:       dayStore.currL2,     currL3:       dayStore.currL3,
        currPctL1:    dayStore.currPctL1,  currPctL2:    dayStore.currPctL2,  currPctL3:    dayStore.currPctL3,
        kwTotal:      dayStore.kwTotal,    kwL1:         dayStore.calcAL1,    kwL2:         dayStore.calcAL2,    kwL3: dayStore.calcAL3,
        kvaTotal:     dayStore.kvaTotal,   kvarTotal:    dayStore.kvarTotal,
        frequency:    dayStore.freq,       pf:           dayStore.pf,
        engineRPM:    dayStore.rpm,
        coolantTempF: dayStore.coolantF,   oilTempF:     dayStore.oilTempF,
        intakeTempF:  dayStore.intakeTempF,fuelTempF:    dayStore.fuelTempF,
        exhaustTempF: dayStore.exhaustTempF,
        oilPressPsi:  dayStore.oilPsi,     boostPressPsi:dayStore.boostPsi,
        crankPressPsi:dayStore.crankcasePsi,fuelSupplyPsi:dayStore.fuelSupplyPsi,
        coolantPsi:   dayStore.coolantPsi,
        torquePct:    dayStore.rpm.map(() => 0), // torque not in dayStore
        battV:        dayStore.battV,
        fuelLevelPct: dayStore.fuelPct,    fuelLevelL:   dayStore.fuelLitres,
        utilVoltL1N:  dayStore.uVL1N,      utilVoltL2N:  dayStore.uVL2N,     utilVoltL3N:  dayStore.uVL3N,
        utilVoltL1L2: dayStore.uVL1L2,     utilVoltL2L3: dayStore.uVL2L3,    utilVoltL3L1: dayStore.uVL3L1,
        utilFrequency:dayStore.utilFreq,
        gensetState:  dayStore.timestamps.map(() => '—'),
        amfState:     dayStore.timestamps.map(() => '—'),
        xferSwStatus: dayStore.timestamps.map(() => '—'),
        faultCode:    dayStore.timestamps.map(() => '0'),
      };
    }
    return null;
  }

  // ── Generate Excel workbook from data + selected sections ──
  function generateXLSX(data, sections, label) {
    // SheetJS must be loaded
    if (typeof XLSX === 'undefined') {
      alert('SheetJS library not loaded. Add:\n<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\/script>\nbefore gensight-excel-export.js in your HTML.');
      return;
    }
    const wb = XLSX.utils.book_new();
    const sheetDefs = [
      { key: 'alternator', name: '⚡ Alternator',  cols: ALTERNATOR_COLS, title: '⚡ Alternator Output — Cummins 400kVA PS0600' },
      { key: 'engine',     name: '🔧 Engine',      cols: ENGINE_COLS,     title: '🔧 Engine Health — Cummins 400kVA PS0600' },
      { key: 'fuel',       name: '⛽ Fuel',         cols: FUEL_COLS,       title: '⛽ Fuel System — Cummins 400kVA / 715L Tank', isFuel: true },
      { key: 'utility',    name: '🏙️ Utility',     cols: UTILITY_COLS,    title: '🏙️ Utility / Mains Power Monitoring' },
    ];
    // ── Cover Sheet ────────────────────────────────────────────
    const now    = new Date();
    const pts    = (data.timestamps || []).length;
    const from   = (data.timestamps || [])[0] || '—';
    const to     = (data.timestamps || [])[pts - 1] || '—';

    const coverHTML = `<table>
      <tr><td colspan="2" style="background:#1A2340;color:#fff;font-size:16pt;font-weight:900;padding:16px 20px;">⚡ GenSight Report — Cummins 400kVA</td></tr>
      <tr><td colspan="2" style="background:#1E3A8A;color:#BFDBFE;font-size:10pt;padding:8px 20px;">PowerStart PS0600 · A029X159 Issue 29</td></tr>
      <tr><td style="width:180px;font-weight:800;padding:8px 14px;background:#F8FAFF;">Exported At</td><td style="padding:8px 14px;">${now.toLocaleString('en-IN')}</td></tr>
      <tr><td style="font-weight:800;padding:8px 14px;background:#F8FAFF;">Data Source</td><td style="padding:8px 14px;">${label}</td></tr>
      <tr><td style="font-weight:800;padding:8px 14px;background:#F8FAFF;">First Reading</td><td style="padding:8px 14px;">${from}</td></tr>
      <tr><td style="font-weight:800;padding:8px 14px;background:#F8FAFF;">Last Reading</td><td style="padding:8px 14px;">${to}</td></tr>
      <tr><td style="font-weight:800;padding:8px 14px;background:#F8FAFF;">Data Points</td><td style="padding:8px 14px;">${pts.toLocaleString()}</td></tr>
      <tr><td style="font-weight:800;padding:8px 14px;background:#F8FAFF;">Sections</td><td style="padding:8px 14px;">${sections.map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(', ')}</td></tr>
      <tr><td colspan="2" style="height:24px;"></td></tr>
      <tr><td colspan="2" style="background:#EFF6FF;color:#1E40AF;padding:10px 14px;font-size:9pt;">
        🔴 RED cell = Peak maximum recorded value<br>
        🟥 Light red bg = Above safe/ideal range<br>
        🟡 Amber bg = Below ideal range (needs attention)<br>
        🟩 Green bg = Within ideal operating range
      </td></tr>
    </table>`;

    const coverWs = XLSX.utils.table_to_sheet(_htmlToTable(coverHTML));
    XLSX.utils.book_append_sheet(wb, coverWs, '📋 Cover');

    // ── Section Sheets ─────────────────────────────────────────
    sheetDefs.forEach(sd => {
      if (!sections.includes(sd.key)) return;
      const html = sd.isFuel
        ? buildFuelSheetHTML(data, false)
        : buildSheetHTML(sd.cols, data, sd.title);
      const ws = XLSX.utils.table_to_sheet(_htmlToTable(html));
      // Auto column widths (approx)
      ws['!cols'] = sd.cols.map(c => ({ wch: Math.max(c.header.length, 12) }));
      XLSX.utils.book_append_sheet(wb, ws, sd.name);
    });

    // ── Write & download ───────────────────────────────────────
    const dateTag = now.toISOString().slice(0, 10);
    const fname   = `GenSight_${dateTag}_${label.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  // ── Utility: parse HTML string → DOM table element ─────────
  function _htmlToTable(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.querySelector('table');
  }

  // ── Main export handler ────────────────────────────────────
  async function _doExport() {
    // Validate sections
    const sections = ['alternator','engine','fuel','utility']
      .filter(s => document.getElementById(`chk-${s}`).checked);

    if (!sections.length) {
      _setStatus('⚠️ Select at least one section', 'err');
      return;
    }

    const btn = document.getElementById('gsemExportBtn');
    btn.disabled = true;
    _setStatus('⏳ Preparing…', 'busy');

    try {
      let data  = null;
      let label = '';

      if (_mode === 'live') {
        _setStatus('⏳ Reading live data…', 'busy');
        data  = getLiveData();
        label = 'Live Snapshot';
        if (!data || !(data.timestamps||[]).length) {
          _setStatus('⚠️ No live data yet', 'err');
          btn.disabled = false;
          return;
        }

      } else {
        const from = document.getElementById('gsemFrom').value;
        const to   = document.getElementById('gsemTo').value;
        if (!from || !to) {
          _setStatus('⚠️ Select date range', 'err');
          btn.disabled = false;
          return;
        }
        if (from > to) {
          _setStatus('⚠️ From must be before To', 'err');
          btn.disabled = false;
          return;
        }
        label = from === to ? from : `${from} to ${to}`;
        _setStatus(`⏳ Fetching ${label}…`, 'busy');
        data = await fetchHistoryData(from, to);
        if (!data) {
          _setStatus('⚠️ No data for that range', 'err');
          btn.disabled = false;
          return;
        }
      }

      _setStatus('⏳ Building Excel…', 'busy');
      // Small delay so browser paints status before blocking on XLSX build
      await new Promise(r => setTimeout(r, 60));
      generateXLSX(data, sections, label);
      _setStatus(`✅ Downloaded!`, 'done');
      setTimeout(() => _setStatus('Ready'), 3000);

    } catch(e) {
      console.error('[GSExport]', e);
      _setStatus('❌ Error — see console', 'err');
    }

    btn.disabled = false;
  }

  // ── Public API ─────────────────────────────────────────────
  window.GSExport = {
    openDialog() {
      // Default dates
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('gsemFrom').value = today;
      document.getElementById('gsemTo').value   = today;
      _setStatus('Ready');
      _setMode('live');
      modalEl.classList.add('open');
    },
    _setMode
  };

})();