'use strict';
(function () {
  const IST = 'Asia/Kolkata', DAYS = 10;
  const ist = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: IST });
  const hm = s => { const m = Math.round((s || 0) / 60); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  const pretty = k => new Date(k + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short', timeZone: IST });
  const NOTE = { unavailable: 'Fuel data unavailable', no_data: 'No sensor data', unknown: 'Unknown', partial: 'Partly unavailable', future: '' };

  function build() {
    if (document.getElementById('dgHomePanel')) return;
    const anchor = document.querySelector('.fuel-detail-row');
    if (!anchor) return;
    const box = document.createElement('div');
    box.id = 'dgHomePanel';
    box.className = 'card';
    box.style.cssText = 'margin:12px 0;padding:16px 18px;background:#fff;border:1.5px solid #E2E8F5;border-radius:16px;cursor:default';
    box.addEventListener('click', e => e.stopPropagation());
    box.innerHTML = '<div style="font-weight:900;font-size:.95rem;color:#1A2340;margin-bottom:4px">📅 Last 10 days — Run time &amp; Diesel consumed</div>' +
      '<div id="dgHpSum" style="font-size:.74rem;color:#4A5568;margin-bottom:10px">Loading…</div>' +
      '<div style="overflow-x:auto"><table id="dgHpTbl" style="width:100%;border-collapse:collapse;font-size:.78rem;font-family:\'JetBrains Mono\',monospace"></table></div>' +
      '<div style="font-size:.66rem;color:#8A9BB5;margin-top:8px">Refills are shown separately and never counted as consumption. “—” means sensor data was unavailable (not 0 L).</div>';
    anchor.parentNode.insertBefore(box, anchor);
  }

  async function load() {
    build();
    const sum = document.getElementById('dgHpSum'), tbl = document.getElementById('dgHpTbl');
    if (!sum || !tbl) return;
    try {
      const to = ist(Date.now()), from = ist(Date.now() - (DAYS - 1) * 864e5);
      const r = await fetch(`/api/dg/daily?from=${from}&to=${to}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const maxL = Math.max(1, ...j.days.map(d => d.consumedL || 0));
      const th = 'style="text-align:left;padding:6px 8px;background:#F0F4FF;color:#4A5568"';
      const td = 'style="padding:6px 8px;border-bottom:1px solid #F0F4FF;color:#1A2340;white-space:nowrap"';
      const rows = [...j.days].reverse().map(d => {
        const noFuel = d.consumedL == null;
        const noRun = d.status === 'no_data' || d.status === 'unknown' || d.status === 'future';
        const bar = noFuel ? '' : `<div style="height:6px;border-radius:3px;background:${d.status === 'partial' ? '#D97706' : '#059669'};width:${Math.max(2, d.consumedL / maxL * 100)}%"></div>`;
        return `<tr>
          <td ${td}>${pretty(d.date)}${d.date === to ? ' <b style="color:#2563EB">(today)</b>' : ''}</td>
          <td ${td}>${noRun ? '—' : hm(d.runSec)}</td>
          <td ${td}><b>${noFuel ? '—' : d.consumedL.toFixed(0) + ' L'}</b>${bar}</td>
          <td ${td}>${d.refilledL ? '+' + Math.round(d.refilledL) + ' L' : '—'}</td>
          <td ${td}>${noRun ? '—' : d.starts}</td>
          <td ${td} title="${NOTE[d.status] || ''}">${d.status === 'ok' ? '✅' : d.status === 'idle' ? '💤 DG off' : '⚠️ ' + (NOTE[d.status] || d.status)}</td></tr>`;
      }).join('');
      tbl.innerHTML = `<thead><tr><th ${th}>Date</th><th ${th}>Run time</th><th ${th}>Consumed</th><th ${th}>Refilled</th><th ${th}>Starts</th><th ${th}>Status</th></tr></thead><tbody>${rows}</tbody>`;
      sum.textContent = `Total: ${j.totalL.toFixed(0)} L consumed · ${hm(j.runSec)} run time · ${j.days.reduce((s, d) => s + (d.starts || 0), 0)} start(s) in ${DAYS} days`;
    } catch (e) {
      console.error('[DGHomePanel]', e);
      sum.textContent = 'Could not load data: ' + e.message;
    }
  }

  load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();