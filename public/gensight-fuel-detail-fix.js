
(function () {
  'use strict';

  // ── CSS for fuel summary table ─────────────────────────────
  const STYLE = `
  /* ── Fuel Daily Summary Table ── */
  .gfd-summary-wrap {
    margin-top: 18px;
    background: #fff;
    border: 1.5px solid #E2E8F5;
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow: 0 1px 6px rgba(37,99,235,.06);
  }
  .gfd-summary-title {
    font-size: .82rem; font-weight: 900; color: #1A2340;
    margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
  }
  .gfd-summary-title span {
    font-size: .70rem; font-weight: 700; color: #8A9BB5;
    background: #F0F4FF; padding: 2px 10px; border-radius: 20px;
  }
  .gfd-table {
    width: 100%; border-collapse: collapse; font-size: .75rem;
  }
  .gfd-table th {
    background: #1A2340; color: #fff;
    padding: 8px 10px; text-align: center;
    font-size: .65rem; font-weight: 800; letter-spacing: .06em;
    text-transform: uppercase; white-space: nowrap;
  }
  .gfd-table th:first-child { border-radius: 8px 0 0 0; text-align: left; }
  .gfd-table th:last-child  { border-radius: 0 8px 0 0; }
  .gfd-table td {
    padding: 7px 10px; border-bottom: 1px solid #E2E8F5;
    text-align: right; color: #1A2340; font-family: 'JetBrains Mono', monospace;
    font-size: .76rem;
  }
  .gfd-table td:first-child {
    text-align: left; font-family: 'Nunito', sans-serif;
    font-weight: 800; color: #1A2340;
  }
  .gfd-table tr:nth-child(even) td { background: #F8FAFF; }
  .gfd-table tr:hover td { background: #EFF6FF; }
  .gfd-table tr:last-child td { border-bottom: none; }
  .gfd-table tr:last-child td:first-child { border-radius: 0 0 0 8px; }
  .gfd-table tr:last-child td:last-child  { border-radius: 0 0 8px 0; }

  /* ── Responsive wrapper ── */
  .gfd-table-scroll {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: 8px;
  }
  .gfd-table-scroll::-webkit-scrollbar { height: 4px; }
  .gfd-table-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }

  @media (max-width: 640px) {
    .gfd-summary-wrap { padding: 12px 10px; }
    .gfd-summary-title { font-size: .78rem; flex-wrap: wrap; }
    .gfd-table th { font-size: .60rem; padding: 7px 7px; }
    .gfd-table td { font-size: .70rem; padding: 6px 7px; }
  }

  /* Consumed cell colour coding */
  .gfd-consumed-high { color: #DC2626 !important; font-weight: 800 !important; }
  .gfd-consumed-med  { color: #D97706 !important; font-weight: 700 !important; }
  .gfd-consumed-low  { color: #059669 !important; }

  /* Level warning */
  .gfd-level-warn  { color: #DC2626 !important; font-weight: 800 !important; }
  .gfd-level-ok    { color: #059669 !important; }

  /* ── No data notice ── */
  .gfd-nodata-row td {
    text-align: center !important;
    color: #8A9BB5 !important; font-style: italic;
    font-family: 'Nunito', sans-serif !important;
    padding: 18px !important;
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Wait for gsDetail then patch ──────────────────────────
  function waitAndPatch() {
    if (!window.gsDetail) {
      setTimeout(waitAndPatch, 100);
      return;
    }
    patchFuelSection();
  }

  // ── The fix ───────────────────────────────────────────────
  function patchFuelSection() {

    // We need to hook into the detail overlay's renderDetailBody
    // for the fuel section. We do this by observing DOM mutations
    // on #gsdBody and injecting the summary table after render.

    const observer = new MutationObserver(() => {
      // Only act if fuel section is open
      const overlay = document.getElementById('gsDetailOverlay');
      if (!overlay || !overlay.classList.contains('open')) return;
      const titleEl = document.getElementById('gsdTitle');
      if (!titleEl || !titleEl.textContent.includes('Fuel')) return;

      // Inject summary if not already there
      if (!document.querySelector('.gfd-summary-wrap')) {
        injectFuelSummary();
      }
    });

    const body = document.getElementById('gsdBody');
    if (body) {
      observer.observe(body, { childList: true, subtree: false });
    }

    // Also patch compressToDailyAverages to fix x-axis labels
    patchChartRendering();
  }

  // ── Build per-day summary from raw timestamps + arrays ────
  function buildDailySummary(data) {
    const ts        = data.timestamps    || [];
    const pctArr    = data.fuelLevelPct  || [];
    const litresArr = data.fuelLevelL    || [];

    if (!ts.length) return [];

    // Group by date prefix (YYYY-MM-DD)
    const byDate = {};
    ts.forEach((t, i) => {
      // timestamps can be "HH:MM:SS" (single day) or "YYYY-MM-DD HH:MM:SS" (range)
      const str = String(t);
      const dk  = str.length >= 10 && str.includes('-') ? str.slice(0, 10) : _todayStr();
      if (!byDate[dk]) byDate[dk] = [];
      byDate[dk].push({ t: str, pct: pctArr[i] || 0, litres: litresArr[i] || 0 });
    });

    const dates = Object.keys(byDate).sort();
    return dates.map(dk => {
      const rows  = byDate[dk];
      const first = rows[0];
      const last  = rows[rows.length - 1];
      const consumed = Math.max(0, first.litres - last.litres);

      // Estimate burn rate from time span
      let burnRate = null;
      let hrsLeft  = null;
      try {
        // Parse just the time portion
        const t0str = first.t.length > 10 ? first.t.slice(11) : first.t;
        const t1str = last.t.length  > 10 ? last.t.slice(11)  : last.t;
        const t0    = new Date(`1970-01-01T${t0str.slice(0,8)}`);
        const t1    = new Date(`1970-01-01T${t1str.slice(0,8)}`);
        let   hrs   = Math.abs(t1 - t0) / 3600000;
        if (hrs < 0.01) hrs = (rows.length * 2) / 3600; // fallback: 2s per reading
        if (hrs > 0 && consumed > 0) {
          burnRate = consumed / hrs;
          hrsLeft  = last.litres / burnRate;
        }
      } catch(e) { /* ignore */ }

      return {
        date:      dk,
        startPct:  first.pct,
        startL:    first.litres,
        endPct:    last.pct,
        endL:      last.litres,
        consumed:  consumed,
        burnRate:  burnRate,
        hrsLeft:   hrsLeft,
        readings:  rows.length
      };
    });
  }

  // ── Inject summary table below the fuel level chart ────────
  function injectFuelSummary() {
    // Get the current data from the overlay's live data
    // We access it via the global gsDetailPush / currentData pattern
    // The data is stored in currentData inside the IIFE — not directly accessible.
    // Instead, we read it from the chart's dataset which IS accessible.

    // Find the fuel level chart
    const fuelLevelCanvas = document.getElementById('fuel_level');
    if (!fuelLevelCanvas) return;

    const chartPanel = fuelLevelCanvas.closest('.gsd-charts-area');
    if (!chartPanel) return;

    // Already injected?
    if (chartPanel.querySelector('.gfd-summary-wrap')) return;

    // Get labels (dates) and data from the chart
    // The Chart.js instance is stored in detailCharts — not accessible from outside the IIFE.
    // So we read from the dayStore / any available source.
    // Best approach: re-read from the overlay's fetch result by hooking fetch.

    // We'll read from the chart canvas's Chart.js instance via Chart.getChart()
    const chartInstance = Chart.getChart(fuelLevelCanvas);
    if (!chartInstance) return;

    const labels     = chartInstance.data.labels || [];
    const fuelData   = (chartInstance.data.datasets[0] || {}).data || [];
    const isRange    = labels.length > 1 && labels.some(l => l && l.includes('-'));

    if (!isRange && labels.length < 2) return; // single day, few points — skip

    // Build pseudo daily summary from chart data
    // For single-day: all points are same date
    // For range: each label IS the date (one bar per date)
    let summaryRows = [];

    if (isRange) {
      // Bar chart: one data point per date
      labels.forEach((lbl, i) => {
        const pct  = parseFloat(fuelData[i]) || 0;
        const litres = Math.round(pct * 800 / 100);
        summaryRows.push({
          date:     lbl,
          startPct: null, // We only have average for range bars
          endPct:   pct,
          endL:     litres,
          startL:   null,
          consumed: null,
          burnRate: null,
          hrsLeft:  null,
          readings: null,
          isAvg:    true
        });
      });
    } else {
      // Single day time-series — group into hourly buckets for summary
      // Try reading from dayStore if available
      if (typeof dayStore !== 'undefined' && dayStore.fuelPct && dayStore.fuelPct.length > 1) {
        const ts   = dayStore.timestamps  || [];
        const pcts = dayStore.fuelPct     || [];
        const lits = dayStore.fuelLitres  || [];
        // Take hourly snapshots
        const step = Math.max(1, Math.floor(ts.length / 24));
        for (let i = 0; i < ts.length; i += step) {
          const j = Math.min(i + step - 1, ts.length - 1);
          summaryRows.push({
            date:      ts[i] + ' → ' + ts[j],
            startPct:  pcts[i],
            startL:    lits[i],
            endPct:    pcts[j],
            endL:      lits[j],
            consumed:  Math.max(0, lits[i] - lits[j]),
            burnRate:  null, hrsLeft: null,
            readings:  j - i + 1, isAvg: false
          });
        }
      }
    }

    if (!summaryRows.length) return;

    // ── Build table HTML ─────────────────────────────────────
    let tableHTML = `
      <table class="gfd-table">
        <thead>
          <tr>
            <th>📅 Date / Period</th>
            <th>Start %</th>
            <th>Start (L)</th>
            <th>End %</th>
            <th>End (L)</th>
            <th>Consumed (L)</th>
            <th>Burn Rate (L/hr)</th>
            <th>Est. Hrs Left</th>
            ${!isRange ? '<th>Readings</th>' : ''}
          </tr>
        </thead>
        <tbody>
    `;

    summaryRows.forEach(row => {
      const consumedCls = row.consumed === null ? '' :
        row.consumed > 150 ? 'gfd-consumed-high' :
        row.consumed > 60  ? 'gfd-consumed-med'  : 'gfd-consumed-low';

      const endPctCls = row.endPct !== null ?
        (row.endPct < 20 ? 'gfd-level-warn' : row.endPct > 50 ? 'gfd-level-ok' : '') : '';

      const fmt = (v, dec=1) => v === null || v === undefined ? '—' : parseFloat(v).toFixed(dec);

      if (isRange) {
        // Range view: just show averages as returned from API
        tableHTML += `
          <tr>
            <td>${row.date}</td>
            <td>—</td>
            <td>—</td>
            <td class="${endPctCls}">${fmt(row.endPct)}</td>
            <td class="${endPctCls}">${fmt(row.endL, 0)}</td>
            <td class="${consumedCls}">—</td>
            <td>—</td>
            <td>—</td>
          </tr>`;
      } else {
        tableHTML += `
          <tr>
            <td>${row.date}</td>
            <td>${fmt(row.startPct)}</td>
            <td>${fmt(row.startL, 0)}</td>
            <td class="${endPctCls}">${fmt(row.endPct)}</td>
            <td class="${endPctCls}">${fmt(row.endL, 0)}</td>
            <td class="${consumedCls}">${fmt(row.consumed, 0)}</td>
            <td>${row.burnRate !== null ? fmt(row.burnRate, 1) : '—'}</td>
            <td>${row.hrsLeft  !== null ? fmt(row.hrsLeft,  0) : '—'}</td>
            <td>${row.readings !== null ? row.readings : '—'}</td>
          </tr>`;
      }
    });

    tableHTML += `</tbody></table>`;

    // ── Inject into DOM ──────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.className = 'gfd-summary-wrap';
    wrap.innerHTML = `
      <div class="gfd-summary-title">
        ⛽ Daily Fuel Consumption Summary
        <span>${isRange ? 'Date Range View' : 'Today — Hourly Breakdown'}</span>
      </div>
<div class="gfd-table-scroll">${tableHTML}</div>      <div style="margin-top:10px;font-size:.68rem;color:#8A9BB5;line-height:1.6;">
        🔴 Red % = Below 20% (critical — refuel urgently) &nbsp;|&nbsp;
        🟢 Green % = Above 50% (good level) &nbsp;|&nbsp;
        🔴 Red consumed = High burn (&gt;150 L/period) &nbsp;|&nbsp;
        🟡 Amber = Medium burn
      </div>
    `;

    // Insert after the first chart panel (fuel level)
    const firstPanel = chartPanel.querySelector('.gsd-chart-panel');
    if (firstPanel && firstPanel.parentNode) {
      firstPanel.parentNode.insertBefore(wrap, firstPanel.nextSibling);
    } else {
      chartPanel.appendChild(wrap);
    }
  }

  function patchChartRendering() {

    // We intercept fetch calls to /api/history and post-process the response.
    const origFetch = window.fetch;

    window.fetch = async function (url, opts) {
      const resp = await origFetch.apply(this, arguments);

      // Only patch history API calls
      if (typeof url === 'string' && url.includes('/api/history')) {
        const clone = resp.clone();
        try {
          const json = await clone.json();

          // Check if it's a multi-date range response
          if (json && json.timestamps && json.timestamps.length > 0) {
            const firstTs = String(json.timestamps[0]);
            const isRange = firstTs.slice(0, 10).includes('-') &&
                            json.timestamps.some(t => !String(t).startsWith(firstTs.slice(0,10)));

            if (isRange) {
              // Ensure ALL keys have same length as timestamps
              // Some keys may be shorter if server had no data for some dates.
              // This is the root cause of the bar chart showing no data after day 1.
              const expectedLen = json.timestamps.length;
              const NUMERIC_KEYS = [
                'voltL1N','voltL2N','voltL3N','voltL1L2','voltL2L3','voltL3L1',
                'currL1','currL2','currL3','currPctL1','currPctL2','currPctL3',
                'kwTotal','kwL1','kwL2','kwL3','kvarTotal','kvarL1','kvarL2','kvarL3',
                'kvaTotal','kvaL1','kvaL2','kvaL3','frequency','pf',
                'coolantTempF','oilTempF','intakeTempF','fuelTempF','exhaustTempF',
                'oilPressPsi','boostPressPsi','crankPressPsi','fuelSupplyPsi',
                'coolantPsi','fuelRailPsi','engineRPM','torquePct',
                'battV','chargeAltV','fuelLevelPct','fuelLevelL',
                'utilVoltL1N','utilVoltL2N','utilVoltL3N',
                'utilVoltL1L2','utilVoltL2L3','utilVoltL3L1','utilFrequency',
                'gensetState','faultCode','amfState','xferSwStatus'
              ];

              NUMERIC_KEYS.forEach(k => {
                if (!json[k]) { json[k] = new Array(expectedLen).fill(0); return; }
                // Pad to match length
                while (json[k].length < expectedLen) json[k].push(0);
                // Trim if somehow longer
                if (json[k].length > expectedLen) json[k].length = expectedLen;
              });

              // Return patched response
              return new Response(JSON.stringify(json), {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers
              });
            }
          }
        } catch(e) {
          // If parsing fails, return original response untouched
          console.warn('[FuelFix] fetch patch error:', e.message);
        }

        return resp;
      }

      return resp;
    };

    // Additionally, patch the Chart.js tooltip to show daily fuel detail
    const origChartDefaults = Chart && Chart.defaults;
    if (origChartDefaults) {
      // Enhance tooltip for bar charts in the detail overlay
      const origAfterBody = (origChartDefaults.plugins && origChartDefaults.plugins.tooltip &&
                             origChartDefaults.plugins.tooltip.callbacks &&
                             origChartDefaults.plugins.tooltip.callbacks.afterBody) || null;

      // We inject tooltip enhancement via a global plugin
      if (Chart.register) {
        Chart.register({
          id: 'gensight-fuel-tooltip',
          beforeInit(chart) {
            // Only apply to bar charts inside the detail overlay
            if (chart.config.type !== 'bar') return;
            const canvas = chart.canvas;
            if (!canvas || !canvas.id || !canvas.id.startsWith('fuel_')) return;

            const origOpts = chart.options.plugins.tooltip || {};
            chart.options.plugins.tooltip = {
              ...origOpts,
              callbacks: {
                ...((origOpts.callbacks) || {}),
                title(items) {
                  if (!items.length) return '';
                  return `📅 ${items[0].label}`;
                },
                afterBody(items) {
                  if (!items.length) return '';
                  const datasetLabel = items[0].dataset.label || '';
                  const val          = items[0].parsed.y;
                  if (datasetLabel.includes('%')) {
                    const litres = Math.round((val / 100) * 800);
                    return [
                      `⛽ ${val.toFixed(1)}% = ${litres} L`,
                      `📦 Tank: 800 L total`,
                      `${val < 20 ? '🔴 CRITICAL — refuel now!' : val < 40 ? '🟡 Low — plan refuel' : '🟢 Level OK'}`
                    ];
                  }
                  if (datasetLabel.includes('Litres') || datasetLabel.includes('remaining')) {
                    return [
                      `📦 ${val.toFixed(0)} L of 800 L`,
                      `${(val / 800 * 100).toFixed(1)}% remaining`,
                      `${val < 160 ? '🔴 Below 20% — refuel urgently!' : val < 320 ? '🟡 Below 40%' : '🟢 Good level'}`
                    ];
                  }
                  return '';
                }
              }
            };
          }
        });
      }
    }
  }

  function _todayStr() { return new Date().toISOString().slice(0, 10); }

  // ── Kick off ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndPatch);
  } else {
    waitAndPatch();
  }

})();