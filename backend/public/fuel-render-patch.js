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
      const s = window.FuelSession.update(fpct, fLitres, engH, kw);
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
    };

    console.log('[FuelPatch] render() patched v3 — Day-1 fields only');
  }, 100);

  function _set(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

})();