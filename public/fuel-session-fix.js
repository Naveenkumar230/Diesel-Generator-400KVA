'use strict';
// ════════════════════════════════════════════════════════════════
//  FUEL SESSION TRACKER v2
//  - Daily session resets at 12:00 AM (midnight)
//  - Engine hours today = current minus midnight snapshot
//  - Day-1 cumulative never resets
//  - Stores everything in localStorage with date keys
// ════════════════════════════════════════════════════════════════
(function () {

  const TANK_CAP = 780;

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getSession() {
    try {
      const raw = localStorage.getItem('fuelSession_' + todayKey());
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveSession(obj) {
    try { localStorage.setItem('fuelSession_' + todayKey(), JSON.stringify(obj)); } catch(e) {}
  }

  function getDay1() {
    try {
      const raw = localStorage.getItem('fuelDay1');
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveDay1(obj) {
    try { localStorage.setItem('fuelDay1', JSON.stringify(obj)); } catch(e) {}
  }

  // Store daily summaries for 7-day graph
  // key: 'fuelDaily_YYYY-MM-DD' => { consumedL, engHours, peakKw, avgKw }
  function getDailyRecord(dateKey) {
    try {
      const raw = localStorage.getItem('fuelDaily_' + dateKey);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveDailyRecord(dateKey, obj) {
    try { localStorage.setItem('fuelDaily_' + dateKey, JSON.stringify(obj)); } catch(e) {}
  }

  function getLast7Days() {
    const records = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rec = getDailyRecord(key);
      records.push({
        date:       key,
        label:      key.slice(5),        // "MM-DD"
        consumedL:  rec ? rec.consumedL  : 0,
        engHours:   rec ? rec.engHours   : 0,
        peakKw:     rec ? rec.peakKw     : 0,
        avgKw:      rec ? rec.avgKw      : 0
      });
    }
    return records;
  }

 window.FuelSession = {

    update: function(currentPct, currentLitres, currentEngH, currentKw) {
      const today = todayKey();
      const now   = Date.now();

      // ── Day-1 baseline (set once, never touched again) ──────
      let day1 = getDay1();
      if (!day1) {
        day1 = {
          startPct:        currentPct,
          startL:          currentLitres,
          startDate:       today,
          startEngH:       currentEngH,   // kept for reference only
          lastLitres:      currentLitres, // running pointer for decrease detection
          cumConsumedL:    0              // accumulates only on decreases, immune to refills
        };
        saveDay1(day1);
      }

      // Detect a real burn (litres went down since last reading)
      if (currentLitres < day1.lastLitres) {
        day1.cumConsumedL += (day1.lastLitres - currentLitres);
      }
      day1.lastLitres = currentLitres;
      saveDay1(day1);

      // ── Today's session (resets at midnight via todayKey() date key) ──
      let session = getSession();
      if (!session) {
        session = {
          date:           today,
          startPct:       currentPct,
          startL:         currentLitres,
          startEngH:      currentEngH,        // hours snapshot at 12:00 AM today
          lastLitres:     currentLitres,       // running pointer for today
          cumConsumedL:   0,                   // today's burn-only total
          savedAt:        now,
          kwReadings:     []
        };
        saveSession(session);
      }

      // Detect today's burn the same refill-safe way
      if (currentLitres < session.lastLitres) {
        session.cumConsumedL += (session.lastLitres - currentLitres);
      }
      session.lastLitres = currentLitres;

      if (!session.kwReadings) session.kwReadings = [];
      session.kwReadings.push(currentKw || 0);
      if (session.kwReadings.length > 720) session.kwReadings.shift();

      const todayEngH   = Math.max(0, currentEngH - session.startEngH); // 12:00 AM -> 11:59 PM
      const consumedL   = Math.round(session.cumConsumedL);
      const consumedPct = +(consumedL / TANK_CAP * 100).toFixed(1);
      const peakKw      = Math.max(...session.kwReadings, 0);
      const avgKw       = session.kwReadings.length
        ? session.kwReadings.reduce((a,b) => a+b, 0) / session.kwReadings.length
        : 0;

      saveDailyRecord(today, {
        consumedL:  consumedL,
        engHours:   +todayEngH.toFixed(2),
        peakKw:     +peakKw.toFixed(1),
        avgKw:      +avgKw.toFixed(1)
      });

      saveSession(session);

      // ── Lifetime values ──────────────────────────────────────
      const lifetimeEngHours = currentEngH; // raw PLC counter, since Day 1 commissioning — no subtraction
      const day1ConsumedL    = Math.round(day1.cumConsumedL); // refill-safe cumulative since Day 1

      return {
        // Today
        sessionStartL:   session.startL,
        sessionStartPct: session.startPct,
        consumedL:       consumedL,
        consumedPct:     consumedPct.toFixed(1),
        todayEngHours:   todayEngH.toFixed(2),
        todayPeakKw:     peakKw.toFixed(1),
        todayAvgKw:      avgKw.toFixed(1),
        // Lifetime / Day-1
        day1StartL:      day1.startL,
        day1StartPct:    day1.startPct,
        day1StartDate:   day1.startDate,
        day1ConsumedL:   day1ConsumedL,     // Total Since Day 1 (L) — refill-safe
        totalEngHours:   lifetimeEngHours.toFixed(2), // Lifetime Engine Hours — raw PLC value
        // 7-day
        last7Days:       getLast7Days()
      };
    },

    getLast7Days: getLast7Days
  };

})();