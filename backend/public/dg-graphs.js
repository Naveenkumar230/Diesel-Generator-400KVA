'use strict';
/* ════════════════════════════════════════════════════════════════
   dg-graphs.js — Fuel & Generator-runtime graphs (Fuel detail page)
   Data: /api/dg/hourly?date=…   and   /api/dg/daily?from=…&to=…
   ════════════════════════════════════════════════════════════════ */
(function () {
  const IST = 'Asia/Kolkata', DAY_MS = 86400000;
  const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: IST });
  const addDays = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtHM = s => { if (s == null || isNaN(s)) return '—'; const m = Math.round(s / 60); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  const fmtL  = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(1) + ' L';
  const hhmm  = iso => new Date(iso).toLocaleTimeString('en-IN', { hour12: false, timeZone: IST, hour: '2-digit', minute: '2-digit' });
  const pretty = k => new Date(k + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: IST });
  const COL = { ok: '#059669', partial: '#D97706', gap: '#CBD5E1', run: '#2563EB' };
  const NO_DATA = new Set(['unavailable', 'no_data', 'unknown']);     // fuel reading missing
  const NO_SENSOR = new Set(['no_data', 'unknown']);                   // nothing recorded at all
  const STATUS_TXT = {
    ok: 'OK', partial: 'Partial — part of the run had no valid fuel reading',
    unavailable: 'Fuel data unavailable', idle: 'DG off (0 L)',
    no_data: 'No sensor data stored', unknown: 'Unknown (history unavailable)', future: '—'
  };

  const charts = {};
  let host = null, timer = null, tokDay = 0, tokRange = 0;
  const $ = id => document.getElementById(id);

  function injectStyle() {
    if ($('dggStyle')) return;
    const s = document.createElement('style'); s.id = 'dggStyle';
    s.textContent = `
    .dgg-wrap{display:flex;flex-direction:column;gap:16px}
    .dgg-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:#fff;border:1.5px solid #E2E8F5;border-radius:14px;padding:12px 16px}
    .dgg-bar b{font-size:.68rem;font-weight:800;color:#8A9BB5;text-transform:uppercase;letter-spacing:.08em}
    .dgg-bar input[type=date]{background:#F8FAFF;border:1.5px solid #C8D5EF;color:#1A2340;padding:6px 10px;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:.8rem}
    .dgg-bar button{background:#F0F4FF;color:#4A5568;border:1.5px solid #C8D5EF;padding:6px 12px;border-radius:7px;cursor:pointer;font-weight:700;font-size:.75rem}
    .dgg-bar button.pri{background:#2563EB;border-color:#2563EB;color:#fff}
    .dgg-sepv{width:1px;height:22px;background:#E2E8F5;margin:0 4px}
    .dgg-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:900px){.dgg-grid{grid-template-columns:1fr}}
    .dgg-card{background:#fff;border:1.5px solid #E2E8F5;border-radius:16px;padding:16px 18px;min-width:0}
    .dgg-h{font-size:.92rem;font-weight:900;color:#1A2340}
    .dgg-sub{font-size:.74rem;color:#4A5568;margin:4px 0 10px;min-height:1.1em}
    .dgg-box{position:relative;height:260px}
    .dgg-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:#8A9BB5;font-size:.85rem;background:rgba(255,255,255,.92)}
    .dgg-scroll{overflow-x:auto;margin-top:12px;max-height:260px;overflow-y:auto}
    .dgg-t{width:100%;border-collapse:collapse;font-size:.74rem;font-family:'JetBrains Mono',monospace}
    .dgg-t th{position:sticky;top:0;background:#F0F4FF;text-align:left;padding:6px 8px;color:#4A5568}
    .dgg-t td{padding:6px 8px;border-bottom:1px solid #F0F4FF;color:#1A2340;white-space:nowrap}
    .dgg-tl{position:relative;height:22px;background:#F0F4FF;border-radius:6px;overflow:hidden;margin-top:12px}
    .dgg-tl i{position:absolute;top:0;bottom:0;background:#2563EB;border-radius:3px}
    .dgg-tlax{display:flex;justify-content:space-between;font-size:10px;color:#8A9BB5;font-weight:700;margin-top:3px}
    .dgg-note{font-size:.68rem;color:#8A9BB5;margin-top:8px}`;
    document.head.appendChild(s);
  }

  const card = (id, title, extra) => `
    <div class="dgg-card"><div class="dgg-h">${title}</div><div class="dgg-sub" id="${id}Sum"></div>
      <div class="dgg-box"><canvas id="${id}"></canvas><div class="dgg-msg" id="${id}Msg">Loading…</div></div>${extra || ''}</div>`;

  function template() {
    return `<div class="dgg-wrap">
      <div class="dgg-bar">
        <b>Day</b><input type="date" id="dggDay"><button id="dggToday">Today</button>
        <span class="dgg-sepv"></span>
        <b>Range</b><input type="date" id="dggFrom"><span>→</span><input type="date" id="dggTo">
        <button id="dggApply" class="pri">Apply</button><button id="dggR7">Last 7d</button><button id="dggR30">Last 30d</button>
      </div>
      <div class="dgg-grid">
        ${card('dggFuelDay', '⛽ A · Daily Fuel Consumption (litres per hour)')}
        ${card('dggRunDay', '⏱️ C · Daily Generator Runtime (minutes running per hour)', '<div id="dggTimeline"></div>')}
        ${card('dggFuelRange', '📅 B · Fuel Consumption by Day (litres)', '<div id="dggFuelTbl"></div>')}
        ${card('dggRunRange', '📅 D · Generator Runtime by Day (hours)', '<div id="dggRunTbl"></div>')}
      </div>
      <div class="dgg-note">Times are IST. Grey markers = sensor data unavailable (not the same as 0 L). Refills are never counted as consumption.
      Consumption is measured from stable fuel-level readings while the DG is running; noisy or impossible readings are excluded, never estimated.</div>
    </div>`;
  }

  async function api(url) {
    const r = await fetch(url);
    if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j.error) m = j.error; } catch (e) {} throw new Error(m); }
    return r.json();
  }
  function setMsg(id, text) {
    const m = $(id + 'Msg'); if (!m) return;
    m.style.display = text ? 'flex' : 'none'; m.textContent = text || '';
  }
  function kill(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function setSum(id, t) { const e = $(id + 'Sum'); if (e) e.textContent = t || ''; }
  function fail(ids, e) {
    ids.forEach(id => { kill(id); setSum(id, ''); setMsg(id, 'Could not load data: ' + e.message); });
  }

  function draw(id, labels, datasets, o) {
    kill(id);
    const cv = $(id); if (!cv || typeof Chart === 'undefined') return;
    charts[id] = new Chart(cv.getContext('2d'), {
      type: 'bar', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { filter: i => i.raw != null, callbacks: { title: o.title, label: o.label } }
        },
        scales: {
          x: { stacked: true, title: { display: true, text: o.xTitle }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: o.maxTicks || 24, font: { size: 9 } } },
          y: { stacked: true, beginAtZero: true, suggestedMax: o.yMax, title: { display: true, text: o.yTitle }, ticks: { callback: o.yTick, font: { size: 9 } } }
        }
      }
    });
  }

  const table = (head, rows) => '<div class="dgg-scroll"><table class="dgg-t"><thead><tr>' +
    head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';

  // ───────────── A + C : one selected day ─────────────
  function renderDay(j) {
    const H = j.hours, labels = H.map(h => h.label);
    const nothing = H.every(h => NO_SENSOR.has(h.status) || h.status === 'future');
    if (nothing) {
      ['dggFuelDay', 'dggRunDay'].forEach(id => { kill(id); setSum(id, ''); setMsg(id, 'No sensor data stored for this day'); });
      $('dggTimeline').innerHTML = ''; return;
    }
    setMsg('dggFuelDay', null); setMsg('dggRunDay', null);

    // A — fuel per hour
    const cons = H.map(h => h.consumedL);
    const maxC = Math.max(1, ...cons.filter(v => v != null));
    draw('dggFuelDay', labels, [
      { label: 'Fuel consumed (L)', data: cons, backgroundColor: H.map(h => h.status === 'partial' ? COL.partial : COL.ok), borderRadius: 3 },
      { label: 'Fuel data unavailable', data: H.map(h => NO_DATA.has(h.status) ? maxC * 0.06 : null), backgroundColor: COL.gap }
    ], {
      xTitle: 'Time of day (IST)', yTitle: 'Fuel consumed (litres)',
      title: it => H[it[0].dataIndex].label + ' – ' + String((H[it[0].dataIndex].hour + 1) % 24).padStart(2, '0') + ':00',
      label: c => {
        const h = H[c.dataIndex];
        if (c.datasetIndex === 1) return h.status === 'unavailable' ? 'DG ran, but no valid fuel reading' : 'No sensor data stored';
        const l = ['Consumed: ' + fmtL(h.consumedL)];
        if (h.status === 'idle') l.push('DG off — true 0 L (sensor OK)');
        if (h.status === 'partial') l.push('Partial: part of the run had no valid fuel data');
        if (h.runSec > 0) l.push('Run time: ' + fmtHM(h.runSec));
        if (h.refilledL > 0) l.push('Refill credited: ' + fmtL(h.refilledL) + ' (not consumption)');
        return l;
      }
    });
    setSum('dggFuelDay', 'Total: ' + fmtL(j.totalL) + (j.unavailableSec > 0 ? ' · ' + fmtHM(j.unavailableSec) + ' of run time had no valid fuel data (excluded)' : ''));

    // C — runtime per hour
    const mins = H.map(h => (NO_SENSOR.has(h.status) || h.status === 'future') ? null : +(h.runSec / 60).toFixed(1));
    draw('dggRunDay', labels, [
      { label: 'Run time (min)', data: mins, backgroundColor: COL.run, borderRadius: 3 },
      { label: 'No data recorded', data: H.map(h => NO_SENSOR.has(h.status) ? 3.6 : null), backgroundColor: COL.gap }
    ], {
      xTitle: 'Time of day (IST)', yTitle: 'Minutes running', yMax: 60, yTick: v => v + ' min',
      title: it => H[it[0].dataIndex].label,
      label: c => c.datasetIndex === 1 ? 'No data recorded' : 'Run time: ' + fmtHM(H[c.dataIndex].runSec)
    });
    setSum('dggRunDay', 'Total run time: ' + fmtHM(j.runSec) + ' · ' + j.sessions.length + ' session(s)');

    // Sessions timeline + table
    const start = Date.parse(j.date + 'T00:00:00+05:30'), now = Date.now();
    const bars = j.sessions.map(s => {
      const a = Math.max(Date.parse(s.startTs), start), b = Math.min(s.endTs ? Date.parse(s.endTs) : now, start + DAY_MS);
      return `<i style="left:${((a - start) / DAY_MS * 100).toFixed(2)}%;width:${Math.max(0.3, (b - a) / DAY_MS * 100).toFixed(2)}%"></i>`;
    }).join('');
    const rows = j.sessions.map(s => [
      hhmm(s.startTs) + (s.continuesFromPrevDay ? ' (from prev day)' : ''),
      s.running ? '🟢 Running' : hhmm(s.endTs) + (s.continuesToNextDay ? ' (continues)' : ''),
      fmtHM(s.runSec)
    ]);
    $('dggTimeline').innerHTML = `<div class="dgg-tl">${bars}</div>
      <div class="dgg-tlax"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>` +
      (rows.length ? table(['Started', 'Stopped', 'Duration'], rows) : '<div class="dgg-note">DG did not run on this day.</div>');
  }

  // ───────────── B + D : date range ─────────────
  function renderRange(j) {
    const D = j.days, labels = D.map(d => pretty(d.date));
    const nothing = D.every(d => NO_SENSOR.has(d.status) || d.status === 'future');
    if (nothing) {
      ['dggFuelRange', 'dggRunRange'].forEach(id => { kill(id); setSum(id, ''); setMsg(id, 'No sensor data stored for this range'); });
      $('dggFuelTbl').innerHTML = ''; $('dggRunTbl').innerHTML = ''; return;
    }
    setMsg('dggFuelRange', null); setMsg('dggRunRange', null);

    const cons = D.map(d => d.consumedL);
    const maxC = Math.max(1, ...cons.filter(v => v != null));
    draw('dggFuelRange', labels, [
      { label: 'Fuel consumed (L)', data: cons, backgroundColor: D.map(d => d.status === 'partial' ? COL.partial : COL.ok), borderRadius: 3 },
      { label: 'Fuel data unavailable', data: D.map(d => NO_DATA.has(d.status) ? maxC * 0.06 : null), backgroundColor: COL.gap }
    ], {
      xTitle: 'Date', yTitle: 'Fuel consumed (litres)', maxTicks: 31,
      title: it => D[it[0].dataIndex].date,
      label: c => {
        const d = D[c.dataIndex];
        if (c.datasetIndex === 1) return STATUS_TXT[d.status];
        const l = ['Consumed: ' + fmtL(d.consumedL)];
        if (d.status === 'partial') l.push(STATUS_TXT.partial);
        if (d.status === 'idle') l.push(STATUS_TXT.idle);
        if (d.refilledL > 0) l.push('Refilled: ' + fmtL(d.refilledL) + ' (excluded)');
        return l;
      }
    });
    const refTot = D.reduce((s, d) => s + (d.refilledL || 0), 0);
    setSum('dggFuelRange', 'Total consumed: ' + fmtL(j.totalL) + ' over ' + D.length + ' day(s)' + (refTot ? ' · refilled ' + fmtL(refTot) + ' (not counted)' : '') +
      (j.unavailableSec > 0 ? ' · ' + fmtHM(j.unavailableSec) + ' run time without valid fuel data' : ''));
    $('dggFuelTbl').innerHTML = table(['Date', 'Consumed', 'Refilled', 'Status'],
      D.map(d => [d.date, d.consumedL == null ? '—' : fmtL(d.consumedL), d.refilledL ? fmtL(d.refilledL) : '—', STATUS_TXT[d.status]]));

    const hrs = D.map(d => (NO_SENSOR.has(d.status) || d.status === 'future') ? null : +(d.runSec / 3600).toFixed(2));
    const maxH = Math.max(1, ...hrs.filter(v => v != null));
    draw('dggRunRange', labels, [
      { label: 'Run time (h)', data: hrs, backgroundColor: COL.run, borderRadius: 3 },
      { label: 'No data recorded', data: D.map(d => NO_SENSOR.has(d.status) ? maxH * 0.06 : null), backgroundColor: COL.gap }
    ], {
      xTitle: 'Date', yTitle: 'Hours running', maxTicks: 31, yTick: v => v + ' h',
      title: it => D[it[0].dataIndex].date,
      label: c => c.datasetIndex === 1 ? 'No data recorded' : ['Run time: ' + fmtHM(D[c.dataIndex].runSec), 'Starts: ' + D[c.dataIndex].starts]
    });
    setSum('dggRunRange', 'Total run time: ' + fmtHM(j.runSec) + ' · ' + D.reduce((s, d) => s + d.starts, 0) + ' start(s)');
    $('dggRunTbl').innerHTML = table(['Date', 'Run time', 'Starts'],
      D.map(d => [d.date, NO_SENSOR.has(d.status) ? 'No data' : fmtHM(d.runSec), NO_SENSOR.has(d.status) ? '—' : d.starts]));
  }

  async function loadDay(silent) {
    const dk = $('dggDay') && $('dggDay').value; if (!dk) return;
    const t = ++tokDay;
    if (!silent) ['dggFuelDay', 'dggRunDay'].forEach(id => setMsg(id, 'Loading…'));
    try { const j = await api('/api/dg/hourly?date=' + dk); if (t === tokDay) renderDay(j); }
    catch (e) { console.error('[DGGraphs]', e); if (t === tokDay) fail(['dggFuelDay', 'dggRunDay'], e); }
  }
  async function loadRange(silent) {
    const f = $('dggFrom') && $('dggFrom').value, to = $('dggTo') && $('dggTo').value;
    const ids = ['dggFuelRange', 'dggRunRange'];
    if (!f || !to) return;
    if (f > to) { ids.forEach(id => { kill(id); setSum(id, ''); setMsg(id, 'Start date must be on or before end date'); }); return; }
    if ((Date.parse(to) - Date.parse(f)) / DAY_MS > 365) { ids.forEach(id => { kill(id); setMsg(id, 'Range is limited to 366 days'); }); return; }
    const t = ++tokRange;
    if (!silent) ids.forEach(id => setMsg(id, 'Loading…'));
    try { const j = await api('/api/dg/daily?from=' + f + '&to=' + to); if (t === tokRange) renderRange(j); }
    catch (e) { console.error('[DGGraphs]', e); if (t === tokRange) fail(ids, e); }
  }

  function destroy() {
    if (timer) { clearInterval(timer); timer = null; }
    Object.keys(charts).forEach(kill);
    tokDay++; tokRange++; host = null;
  }

  function mount(el) {
    destroy(); if (!el) return;
    host = el; injectStyle(); el.innerHTML = template();
    const t = todayIST();
    $('dggDay').value = t; $('dggDay').max = t;
    $('dggFrom').value = addDays(t, -6); $('dggTo').value = t;
    $('dggFrom').max = t; $('dggTo').max = t;
    $('dggDay').addEventListener('change', () => loadDay());
    $('dggToday').addEventListener('click', () => { $('dggDay').value = todayIST(); loadDay(); });
    $('dggApply').addEventListener('click', () => loadRange());
    $('dggR7').addEventListener('click', () => { $('dggTo').value = todayIST(); $('dggFrom').value = addDays(todayIST(), -6); loadRange(); });
    $('dggR30').addEventListener('click', () => { $('dggTo').value = todayIST(); $('dggFrom').value = addDays(todayIST(), -29); loadRange(); });
    loadDay(); loadRange();
    timer = setInterval(() => {
      if (document.hidden || !host || !document.body.contains(host)) return;
      if ($('dggDay').value === todayIST()) loadDay(true);
      if ($('dggTo').value >= todayIST()) loadRange(true);
    }, 60000);
  }

  window.DGGraphs = { mount, destroy };
})();