'use strict';

(function () {

  // ── Wait until gsDetail is available ────────────────────────
  const _wait = setInterval(function () {
    if (!window.gsDetail) return;
    clearInterval(_wait);
    _patchDetailOverlay();
  }, 200);

  // ── Chart colour palette ─────────────────────────────────────
  const C = {
    green:  '#059669', greenDim: 'rgba(5,150,105,.15)',
    blue:   '#2563EB', blueDim:  'rgba(37,99,235,.15)',
    amber:  '#D97706', amberDim: 'rgba(217,119,6,.15)',
    red:    '#DC2626', redDim:   'rgba(220,38,38,.15)',
    purple: '#7C3AED', purpleDim:'rgba(124,58,237,.15)',
    teal:   '#0891B2', tealDim:  'rgba(8,145,178,.15)'
  };

  // ── Chart defaults ───────────────────────────────────────────
  function baseOpts(yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
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
          bodyFont:  { family: 'JetBrains Mono', size: 11 },
          titleFont: { family: 'Nunito', size: 11, weight: '800' }
        }
      },
      scales: {
        x: {
          ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' },
          grid:  { color: 'rgba(0,0,0,.04)' }
        },
        y: {
          position: 'left',
          title: { display: !!yLabel, text: yLabel || '', color: '#8A9BB5', font: { size: 9 } },
          ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' },
          grid:  { color: 'rgba(0,0,0,.04)' }
        }
      }
    };
  }

  function dualAxisOpts(yLLabel, yRLabel) {
    const o = baseOpts(yLLabel);
    o.scales.yL = { ...o.scales.y, position: 'left',  title: { display: true, text: yLLabel, color: '#8A9BB5', font: { size: 9 } } };
    o.scales.yR = { position: 'right', title: { display: true, text: yRLabel, color: '#8A9BB5', font: { size: 9 } }, ticks: { font: { family: 'JetBrains Mono', size: 9 }, color: '#8A9BB5' }, grid: { drawOnChartArea: false } };
    delete o.scales.y;
    return o;
  }

  // ── Aggregate raw history docs into daily summary ────────────
  function aggregateDay(docs) {
    if (!docs || !docs.timestamps || !docs.timestamps.length) return null;

    const n = docs.timestamps.length;
    function arr(key) { return (docs[key] || []).filter(v => typeof v === 'number' && !isNaN(v) && v > 0); }
    function max(key) { const a = arr(key); return a.length ? +Math.max(...a).toFixed(2) : 0; }
    function min(key) { const a = arr(key); return a.length ? +Math.min(...a).toFixed(2) : 0; }
    function avg(key) { const a = arr(key); return a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : 0; }
    function last(key){ const a = arr(key); return a.length ? +a[a.length-1].toFixed(2) : 0; }
    function first(key){const a = arr(key); return a.length ? +a[0].toFixed(2) : 0; }

    // Engine hours today = last - first (both are lifetime counters)
    const engHFirst = first('engineRPM') > 0 ? (docs.torquePct ? first('torquePct') : 0) : 0;
    // We store engineRPM not engHours in history — use a proxy:
    // Count non-zero RPM samples × 2s interval ÷ 3600
    const rpmArr   = (docs.engineRPM || []);
    const runSamples = rpmArr.filter(v => v > 200).length;
    const engHToday  = +(runSamples * 2 / 3600).toFixed(2);

    // Fuel consumed = first fuelLevelL - last fuelLevelL (decrease = consumed)
    const fuelArr   = (docs.fuelLevelL || []).filter(v => v > 0);
    const fuelConsumed = fuelArr.length >= 2
      ? Math.max(0, Math.round(fuelArr[0] - fuelArr[fuelArr.length - 1]))
      : 0;

    // Voltage unbalance avg
    const vuArr = (docs.voltUnbalancePct || []).filter(v => typeof v === 'number' && !isNaN(v));
    const avgVU = vuArr.length ? +(vuArr.reduce((a,b)=>a+b,0)/vuArr.length).toFixed(2) : 0;

    return {
      peakKw:       max('kwTotal'),
      avgKw:        avg('kwTotal'),
      peakKva:      max('kvaTotal'),
      avgPf:        avg('pf'),
      peakRpm:      max('engineRPM'),
      avgRpm:       avg('engineRPM'),
      maxCoolantF:  max('coolantTempF'),
      maxOilPsi:    max('oilPressPsi'),
      minOilPsi:    min('oilPressPsi'),
      avgBattV:     avg('battV'),
      engHToday,
      fuelConsumed,
      peakFuelPct:  max('fuelLevelPct'),
      minFuelPct:   min('fuelLevelPct'),
      avgVoltUnbal: avgVU,
      samples:      n
    };
  }

  // ── Fetch 7-day summaries from /api/history ──────────────────
  async function fetch7DaySummaries() {
    const days   = [];
    const labels = [];
    const today  = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      labels.push(key.slice(5)); // MM-DD
    }

    // Fetch all 7 days in parallel
    const results = await Promise.all(days.map(async (date) => {
      // First check localStorage daily record (fast, already computed)
      try {
        const stored = localStorage.getItem('fuelDaily_' + date);
        if (stored) {
          const rec = JSON.parse(stored);
          return { date, fromCache: true, ...rec };
        }
      } catch(e) {}

      // Fallback: fetch from API
      try {
        const r = await fetch('/api/history?date=' + date);
        if (!r.ok) return { date, consumedL: 0, engHours: 0, peakKw: 0, avgKw: 0 };
        const json = await r.json();
        if (!json || json.noData || !json.timestamps) {
          return { date, consumedL: 0, engHours: 0, peakKw: 0, avgKw: 0 };
        }
        const agg = aggregateDay(json);
        return agg
          ? { date, consumedL: agg.fuelConsumed, engHours: agg.engHToday,
              peakKw: agg.peakKw, avgKw: agg.avgKw,
              peakKva: agg.peakKva, avgPf: agg.avgPf,
              peakRpm: agg.peakRpm, maxCoolantF: agg.maxCoolantF,
              minOilPsi: agg.minOilPsi, maxOilPsi: agg.maxOilPsi,
              avgBattV: agg.avgBattV, avgVoltUnbal: agg.avgVoltUnbal }
          : { date, consumedL: 0, engHours: 0, peakKw: 0, avgKw: 0 };
      } catch(e) {
        return { date, consumedL: 0, engHours: 0, peakKw: 0, avgKw: 0 };
      }
    }));

    return { labels, days, results };
  }

  // ── Build chart panel HTML ───────────────────────────────────
  function chartPanel(id, title, height) {
    return `
      <div style="background:#fff;border:1.5px solid #E2E8F5;border-radius:16px;padding:20px 22px;box-shadow:0 1px 8px rgba(37,99,235,.05);margin-bottom:20px">
        <div style="font-size:.88rem;font-weight:900;color:#1A2340;margin-bottom:14px">${title}</div>
        <div style="position:relative;height:${height || 220}px">
          <canvas id="${id}"></canvas>
        </div>
      </div>`;
  }

  // ── Section header ───────────────────────────────────────────
  function sectionHeader(title) {
    return `<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#8A9BB5;padding:4px 2px;margin:20px 0 10px;border-bottom:1.5px solid #E2E8F5">${title}</div>`;
  }

  // ── Destroy old daily charts ─────────────────────────────────
  const _dailyCharts = {};
  function destroyDaily() {
    Object.keys(_dailyCharts).forEach(k => { try { _dailyCharts[k].destroy(); } catch(e){} delete _dailyCharts[k]; });
  }

  // ── FUEL daily charts ────────────────────────────────────────
  async function renderFuelDailyCharts(container) {
    const { labels, results } = await fetch7DaySummaries();

    container.insertAdjacentHTML('beforeend',
      sectionHeader('📅 7-Day Daily Summary') +
      chartPanel('dc_fuelConsumed', '⛽ Fuel Consumed per Day (Litres) — How much diesel burned each day', 220) +
      chartPanel('dc_engHours',     '⏱️ Engine Hours per Day (12AM–11:59PM) — How long the DG ran each day', 220) +
      chartPanel('dc_dailyKw',      '⚡ Peak & Average Load per Day (kW) — Highest and average electrical load', 220)
    );

    _dailyCharts['dc_fuelConsumed'] = new Chart(
      document.getElementById('dc_fuelConsumed').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Fuel Consumed (L)',
            data: results.map(r => r.consumedL || 0),
            backgroundColor: results.map(r => (r.consumedL || 0) > 400 ? C.redDim  : C.greenDim),
            borderColor:     results.map(r => (r.consumedL || 0) > 400 ? C.red     : C.green),
            borderWidth: 2, borderRadius: 6
          }]
        },
        options: baseOpts('Litres')
      }
    );

    _dailyCharts['dc_engHours'] = new Chart(
      document.getElementById('dc_engHours').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Engine Hours (h)',
            data: results.map(r => r.engHours || 0),
            backgroundColor: C.blueDim,
            borderColor:     C.blue,
            borderWidth: 2, borderRadius: 6
          }]
        },
        options: baseOpts('Hours')
      }
    );

    _dailyCharts['dc_dailyKw'] = new Chart(
      document.getElementById('dc_dailyKw').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Peak kW',
              data: results.map(r => r.peakKw || 0),
              backgroundColor: C.amberDim,
              borderColor:     C.amber,
              borderWidth: 2, borderRadius: 6
            },
            {
              label: 'Avg kW',
              data: results.map(r => r.avgKw || 0),
              backgroundColor: C.greenDim,
              borderColor:     C.green,
              borderWidth: 2, borderRadius: 6, type: 'line',
              tension: 0.4, fill: false, pointRadius: 4
            }
          ]
        },
        options: baseOpts('kW')
      }
    );
  }

  // ── ENGINE daily charts ──────────────────────────────────────
  async function renderEngineDailyCharts(container) {
    const { labels, results } = await fetch7DaySummaries();

    container.insertAdjacentHTML('beforeend',
      sectionHeader('📅 7-Day Daily Summary') +
      chartPanel('dc_engH2',    '⏱️ Engine Hours per Day — DG runtime each day from 12AM to 11:59PM', 220) +
      chartPanel('dc_peakRpm',  '🔄 Peak RPM per Day — Highest engine speed recorded each day', 220) +
      chartPanel('dc_coolant',  '🌡️ Max Coolant Temperature per Day (°F) — Peak thermal stress each day', 220) +
      chartPanel('dc_oilPress', '🛢️ Oil Pressure Range per Day (psi) — Min/max oil pressure per day', 220)
    );

    _dailyCharts['dc_engH2'] = new Chart(
      document.getElementById('dc_engH2').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Engine Hours (h)', data: results.map(r => r.engHours||0), backgroundColor: C.blueDim, borderColor: C.blue, borderWidth:2, borderRadius:6 }]
        },
        options: baseOpts('Hours')
      }
    );

    _dailyCharts['dc_peakRpm'] = new Chart(
      document.getElementById('dc_peakRpm').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Peak RPM', data: results.map(r => r.peakRpm||0), backgroundColor: C.amberDim, borderColor: C.amber, borderWidth:2, borderRadius:6 }]
        },
        options: baseOpts('RPM')
      }
    );

    _dailyCharts['dc_coolant'] = new Chart(
      document.getElementById('dc_coolant').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Max Coolant (°F)', data: results.map(r => r.maxCoolantF||0), backgroundColor: C.redDim, borderColor: C.red, borderWidth:2, borderRadius:6 }]
        },
        options: baseOpts('°F')
      }
    );

    _dailyCharts['dc_oilPress'] = new Chart(
      document.getElementById('dc_oilPress').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Max Oil Pressure (psi)', data: results.map(r => r.maxOilPsi||0), backgroundColor: C.amberDim, borderColor: C.amber, borderWidth:2, borderRadius:6 },
            { label: 'Min Oil Pressure (psi)', data: results.map(r => r.minOilPsi||0), backgroundColor: C.blueDim,  borderColor: C.blue,  borderWidth:2, borderRadius:6 }
          ]
        },
        options: baseOpts('psi')
      }
    );
  }

  // ── ALTERNATOR daily charts ───────────────────────────────────
  async function renderAltDailyCharts(container) {
    const { labels, results } = await fetch7DaySummaries();

    container.insertAdjacentHTML('beforeend',
      sectionHeader('📅 7-Day Daily Summary') +
      chartPanel('dc_altKw',    '⚡ Peak Active Power per Day (kW) — Highest real power load each day', 220) +
      chartPanel('dc_altKva',   '🔋 Peak Apparent Power per Day (kVA) — Highest apparent power each day', 220) +
      chartPanel('dc_altPf',    '📐 Average Power Factor per Day — Daily PF efficiency score', 220) +
      chartPanel('dc_voltUnbal','⚖️ Average Voltage Unbalance per Day (%) — Phase balance health each day', 220)
    );

    _dailyCharts['dc_altKw'] = new Chart(
      document.getElementById('dc_altKw').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Peak kW', data: results.map(r=>r.peakKw||0), backgroundColor:C.amberDim, borderColor:C.amber, borderWidth:2, borderRadius:6 },
            { label: 'Avg kW',  data: results.map(r=>r.avgKw||0),  backgroundColor:C.greenDim, borderColor:C.green, borderWidth:2, borderRadius:6, type:'line', tension:0.4, fill:false, pointRadius:4 }
          ]
        },
        options: baseOpts('kW')
      }
    );

    _dailyCharts['dc_altKva'] = new Chart(
      document.getElementById('dc_altKva').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Peak kVA', data: results.map(r=>r.peakKva||0), backgroundColor:C.blueDim, borderColor:C.blue, borderWidth:2, borderRadius:6 }]
        },
        options: baseOpts('kVA')
      }
    );

    _dailyCharts['dc_altPf'] = new Chart(
      document.getElementById('dc_altPf').getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Avg Power Factor',
            data: results.map(r=>r.avgPf||0),
            borderColor: C.green, backgroundColor: C.greenDim,
            borderWidth:2, tension:0.4, fill:true, pointRadius:5,
            pointBackgroundColor: results.map(r=> (r.avgPf||0)<0.85?C.red:(r.avgPf||0)<0.9?C.amber:C.green)
          }]
        },
        options: (() => {
          const o = baseOpts('PF');
          o.scales.y.min = 0; o.scales.y.max = 1;
          return o;
        })()
      }
    );

    _dailyCharts['dc_voltUnbal'] = new Chart(
      document.getElementById('dc_voltUnbal').getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Avg Volt Unbalance (%)',
            data: results.map(r=>r.avgVoltUnbal||0),
            backgroundColor: results.map(r=>(r.avgVoltUnbal||0)>=3?C.redDim:(r.avgVoltUnbal||0)>=1?C.amberDim:C.greenDim),
            borderColor:     results.map(r=>(r.avgVoltUnbal||0)>=3?C.red    :(r.avgVoltUnbal||0)>=1?C.amber    :C.green),
            borderWidth:2, borderRadius:6
          }]
        },
        options: baseOpts('%')
      }
    );
  }

  // ── Patch gsDetail.open ──────────────────────────────────────
  function _patchDetailOverlay() {
    const _origOpen = window.gsDetail.open;

    window.gsDetail.open = function (sectionKey) {
      _origOpen.call(this, sectionKey);
      destroyDaily();

      // After the overlay renders, inject our daily charts
      setTimeout(async function () {
        const overlay = document.getElementById('gsDetailOverlay');
        if (!overlay) return;

        // Find the charts area inside the overlay
        const chartsArea = overlay.querySelector('.gsd-charts-area');
        if (!chartsArea) return;

        // Remove any previous daily summary blocks
        overlay.querySelectorAll('.daily-summary-block').forEach(el => el.remove());

        // Create a wrapper div for our injected charts
        const wrapper = document.createElement('div');
        wrapper.className = 'daily-summary-block';
        wrapper.style.cssText = 'width:100%;';
        chartsArea.appendChild(wrapper);

        // Render section-specific daily charts
        if (sectionKey === 'fuel') {
          await renderFuelDailyCharts(wrapper);
        } else if (sectionKey === 'engine') {
          await renderEngineDailyCharts(wrapper);
        } else if (sectionKey === 'alternator') {
          await renderAltDailyCharts(wrapper);
        }

      }, 600); // wait for overlay DOM to fully render
    };

    console.log('[DailySummaryCharts] gsDetail.open patched');
  }

})();