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
      const fLitres = Math.round(fpct * 780 / 100);
      const engH    = parseFloat(eng.hours) || 0;
      const kw      = parseFloat(ac.kwTotal)|| 0;

      if (!window.FuelSession) return;
      const s = window.FuelSession.update(fpct, fLitres, engH, kw);
      if (!s) return;

      window._lastFuelSession = s; // store for detail overlay

      // ── Session strip DOM ──────────────────────────────────
      _set('fuelSessionStart',    s.sessionStartL + ' L');
      _set('fuelSessionStartPct', s.sessionStartPct + '% at 12:00 AM');
      _set('fuelCurrentStock',    fLitres + ' L');
      _set('fuelCurrentPct',      fpct + '% remaining');

      const conEl = $('fuelConsumedSession');
      if (conEl) {
        conEl.textContent = s.consumedL + ' L';
        conEl.className   = 'fss-value mono ' + (s.consumedL > 300 ? 'red' : 'amber');
      }
      _set('fuelConsumedPct',  s.consumedPct + '% used since midnight');
      _set('fuelEngHours',     s.todayEngHours + ' h');
      _set('fuelCurrentLoad',  kw.toFixed(1) + ' kW');
      _set('fuelLoadPct',      Math.round(kw / 320 * 100) + '% of 320 kW rated');

      // Day-1
      const d1El = $('day1ConsumedL');
      if (d1El) {
        d1El.textContent = s.day1ConsumedL + ' L';
        d1El.className   = 'fss-value mono ' + (s.day1ConsumedL > 1000 ? 'red' : 'amber');
      }
      _set('day1StartDate',    'From ' + s.day1StartDate + ' (' + s.day1StartPct + '% start)');
      _set('day1TotalEngH',    s.totalEngHours + ' h');
    };

    console.log('[FuelPatch] render() patched v2');
  }, 100);

  function _set(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

})();