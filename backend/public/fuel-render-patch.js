'use strict';

(function () {

  const $ = id => document.getElementById(id);

  // ── Wait for app.js render() to be defined ──────────────────
  const _hook = setInterval(function () {
    if (typeof window.render !== 'function') return;
    clearInterval(_hook);

    const _orig = window.render;
    window.render = function (latest, history) {
      _orig.call(this, latest, history);

      if (!latest) return;
      const fuel = latest.fuel   || {};
      const eng  = latest.engine || {};
      const ac   = latest.ac     || {};

      const fpct    = parseFloat(fuel.pct)  || 0;
      const fLitres = (fuel.litres != null && !isNaN(parseFloat(fuel.litres)) && parseFloat(fuel.litres) > 0)
        ? Math.round(parseFloat(fuel.litres))
        : Math.round(fpct * 780 / 100);
      const engH    = parseFloat(eng.hours) || 0;
      const kw      = parseFloat(ac.kwTotal)|| 0;

      if (!window.FuelSession) return;

      // isRunning: prefer the flag app.js sets on every render() tick
      // (window._gsIsRunning), fall back to a simple kW check if that
      // hasn't been set yet (e.g. very first tick before app.js runs).
      const isRunning = (typeof window._gsIsRunning === 'boolean')
        ? window._gsIsRunning
        : (kw > 0.5);

      const s = window.FuelSession.update(fpct, fLitres, engH, kw, isRunning);
      if (!s) return;

      window._lastFuelSession = s; // used by app.js's detail-page buildStatsHTML()

      // NOTE: today's session strip (fuelSessionStart, fuelCurrentStock,
      // fuelConsumedSession, fuelConsumedPct, fuelEngHours, fuelCurrentLoad,
      // fuelLoadPct) is owned exclusively by app.js's render() — do NOT
      // write those fields here, that was the original bug.

      // ── Day-1 lifetime cumulative (app.js does not compute this) ────
      const d1El = $('day1ConsumedL');
      if (d1El) {
        d1El.textContent = s.day1ConsumedL + ' L';
        d1El.className   = 'fss-value mono ' + (s.day1ConsumedL > 1000 ? 'red' : 'amber');
      }
      _set('day1StartDate', 'From ' + s.day1StartDate + ' (' + s.day1StartPct + '% start)');
      _set('day1TotalEngH', s.totalEngHours + ' h');

      // ── Sensor noise cell — TODAY ONLY, resets at midnight ──────
      // A fuel-level drop while the engine is NOT running is sensor
      // noise, not consumption. This is tracked purely for today's
      // session (session.noiseL in fuel-session-fix.js) and is never
      // rolled into Day-1 lifetime totals. The cell shows/hides itself
      // depending on whether any noise happened today.
      const noiseCell = $('fuelNoiseCell');
      const noiseVal  = $('fuelNoiseToday');
      if (noiseCell && noiseVal) {
        if (s.todayNoiseL > 0) {
          noiseCell.style.display = '';
          noiseVal.textContent = s.todayNoiseL + ' L';
          noiseVal.className   = 'fss-value mono ' + (s.todayNoiseL > 20 ? 'noise-high' : 'noise');
          _set('day1NoiseL', s.todayNoiseEvents + ' event' + (s.todayNoiseEvents === 1 ? '' : 's') + ' today · resets at midnight');
        } else {
          noiseCell.style.display = 'none';
        }
      }
    };

    console.log('[FuelPatch] render() patched v5 — today-only noise tracking');
  }, 100);

  function _set(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

})();