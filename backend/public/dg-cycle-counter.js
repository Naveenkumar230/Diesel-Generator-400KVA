'use strict';
(function () {
  let cycleChart = null;
  let fullDates = [];          // parallel to chart labels, full YYYY-MM-DD
  let eventsByDate = {};       // { 'YYYY-MM-DD': [{type,time}, ...] }

  function todayKeyIST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  function daysAgoKeyIST(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  async function fetchCycles(from, to) {
    try {
      const r = await fetch(`/api/engine/cycles?from=${from}&to=${to}`);
      const json = await r.json();
      return json.days || [];
    } catch (e) {
      console.warn('[Cycles] fetch error:', e.message);
      return [];
    }
  }

  async function fetchEvents(from, to) {
    try {
      const url = from === to
        ? `/api/engine/events?date=${from}`
        : `/api/engine/events?from=${from}&to=${to}`;
      const r = await fetch(url);
      const json = await r.json();
      return json.events || [];
    } catch (e) {
      console.warn('[Cycles] events fetch error:', e.message);
      return [];
    }
  }

  function buildEventsByDate(events) {
    const map = {};
    events.forEach(e => {
      const dk = e.date;
      if (!map[dk]) map[dk] = [];
      map[dk].push({ type: e.type, time: e.time });
    });
    // sort each day's events chronologically
    Object.keys(map).forEach(dk => map[dk].sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }

  function pairEvents(events) {
    // events: full list across range, each has {date, type, time, durationSec}
    const pairs = [];
    let openStart = null;
    events.forEach(e => {
      if (e.type === 'start') {
        openStart = e;
      } else if (e.type === 'stop' && openStart) {
        pairs.push({ startDate: openStart.date, startTime: openStart.time, stopDate: e.date, stopTime: e.time, durationSec: e.durationSec });
        openStart = null;
      }
    });
    if (openStart) pairs.push({ startDate: openStart.date, startTime: openStart.time, stopDate: null, stopTime: null, durationSec: null });
    return pairs;
  }

  function formatDur(sec) {
    if (sec == null || isNaN(sec)) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function renderTable(events) {
    const tbody = document.getElementById('cycEventTableBody');
    if (!tbody) return;
    const pairs = pairEvents(events.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    if (!pairs.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="cyc-empty">No start/stop events in this range</td></tr>';
      return;
    }
    tbody.innerHTML = pairs.slice().reverse().map(p => `
      <tr>
        <td>${p.startDate}</td>
        <td>▶ ${p.startTime}</td>
        <td>${p.stopTime ? '⏹ ' + p.stopTime : '🟢 Still running'}</td>
        <td>${formatDur(p.durationSec)}</td>
      </tr>
    `).join('');
  }

  function renderCycleChart(days) {
    const canvas = document.getElementById('cycleChart');
    if (!canvas || typeof Chart === 'undefined') return;

    fullDates = days.map(d => d.date);
    const labels = days.map(d => d.date.slice(5)); // MM-DD
    const starts = days.map(d => d.starts);
    const stops  = days.map(d => d.stops);

    if (cycleChart) cycleChart.destroy();
    cycleChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '▶ Starts', data: starts, backgroundColor: 'rgba(5,150,105,.80)', borderRadius: 4 },
          { label: '⏹ Stops',  data: stops,  backgroundColor: 'rgba(220,38,38,.80)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10, padding: 10, color: '#4A5568' }
          },
          tooltip: {
            backgroundColor: '#1A2340',
            titleColor: '#fff',
            bodyColor: '#CBD5E1',
            titleFont: { family: 'Nunito', size: 12, weight: '800' },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            footerFont: { family: 'JetBrains Mono', size: 10 },
            footerColor: '#93C5FD',
            padding: 10,
            callbacks: {
              footer: (tooltipItems) => {
                if (!tooltipItems.length) return '';
                const idx = tooltipItems[0].dataIndex;
                const date = fullDates[idx];
                const evs = eventsByDate[date] || [];
                if (!evs.length) return 'No events logged';
                return evs.map(e => (e.type === 'start' ? `▶ ON  ${e.time}` : `⏹ OFF ${e.time}`));
              }
            }
          }
        },
        scales: {
          x: { ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0, font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { color: 'rgba(0,0,0,.04)' } }
        }
      }
    });
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateStatsRow(days) {
    const totalStarts = days.reduce((s, d) => s + d.starts, 0);
    const totalStops  = days.reduce((s, d) => s + d.stops, 0);
    const dayCount    = days.length;
    const avg         = dayCount > 0 ? (totalStarts / dayCount).toFixed(1) : '0';
    setVal('cycTotalStarts', totalStarts);
    setVal('cycTotalStops', totalStops);
    setVal('cycDaysCount', dayCount);
    setVal('cycAvgPerDay', avg);
    const el = document.getElementById('cycPtsLabel');
    if (el) el.textContent = `${totalStarts + totalStops} events`;
  }

  async function loadRange(from, to) {
    const [days, events] = await Promise.all([fetchCycles(from, to), fetchEvents(from, to)]);
    eventsByDate = buildEventsByDate(events);
    renderCycleChart(days);
    updateStatsRow(days);
    renderTable(events);
  }

  // ── Header badge: today's count + hover tooltip with times ──
  async function loadTodayBadge() {
    const today = todayKeyIST();
    const [days, events] = await Promise.all([fetchCycles(today, today), fetchEvents(today, today)]);
    const row = days.find(d => d.date === today) || { starts: 0, stops: 0 };
    setVal('cycleBadgeCount', row.starts);

    const btn = document.getElementById('cycleHdrBtn');
    if (btn) {
      if (!events.length) {
        btn.title = 'No DG activity yet today';
      } else {
        const lines = events
          .slice()
          .sort((a, b) => a.time.localeCompare(b.time))
          .map(e => e.type === 'start' ? `▶ ON  at ${e.time}` : `⏹ OFF at ${e.time}`);
        btn.title = lines.join('\n');
      }
    }
  }

  // ── Overlay open/close ──
  function openOverlay() {
    const overlay = document.getElementById('cycleOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    const fromEl = document.getElementById('cycFrom');
    const toEl   = document.getElementById('cycTo');
    const today  = todayKeyIST();
    if (!fromEl.value) fromEl.value = daysAgoKeyIST(6);
    if (!toEl.value)   toEl.value   = today;

    loadRange(fromEl.value, toEl.value);
  }

  function closeOverlay() {
    const overlay = document.getElementById('cycleOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function init() {
    const hdrBtn   = document.getElementById('cycleHdrBtn');
    const backBtn  = document.getElementById('cycBackBtn');
    const fromEl   = document.getElementById('cycFrom');
    const toEl     = document.getElementById('cycTo');
    const fetchBtn = document.getElementById('cycFetchBtn');

    if (!hdrBtn) return; // widget not on this page

    hdrBtn.addEventListener('click', openOverlay);
    if (backBtn) backBtn.addEventListener('click', closeOverlay);

    document.addEventListener('keydown', e => {
      const overlay = document.getElementById('cycleOverlay');
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) closeOverlay();
    });

    if (fetchBtn && fromEl && toEl) {
      fetchBtn.addEventListener('click', () => {
        const f = fromEl.value, t = toEl.value;
        if (!f || !t) return;
        if (f > t) { alert('From date must be before To date'); return; }
        loadRange(f, t);
      });
    }

    document.querySelectorAll('.cyc-preset-btn').forEach(pb => {
      pb.addEventListener('click', () => {
        const p = pb.dataset.preset;
        const today = todayKeyIST();
        if (p === 'today') { fromEl.value = today;              toEl.value = today; }
        if (p === '7d')    { fromEl.value = daysAgoKeyIST(6);   toEl.value = today; }
        if (p === '30d')   { fromEl.value = daysAgoKeyIST(29);  toEl.value = today; }
        loadRange(fromEl.value, toEl.value);
      });
    });

    loadTodayBadge();
    setInterval(loadTodayBadge, 60000); // refresh badge every minute
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();