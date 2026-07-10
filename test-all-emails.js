'use strict';
// ════════════════════════════════════════════════════════════════
//  GENSIGHT — SEND ALL TEMPLATES (TEST)
//  Sends one test email for every alert type + the daily summary.
//  Run: node test-all-emails.js
// ════════════════════════════════════════════════════════════════

const {
  tplLowFuel, tplOverload, tplFrequency, tplPowerFactor, tplRpm,
  tplRefill, tplServiceDue, tplDailySummary, sendEmail
} = require('./email.js');

const TEST_TO = 'naveenkumarak@aquarelleindia.com'; // <-- change recipient here

// Delay between sends so your SMTP provider doesn't rate-limit / flag as spam
const DELAY_MS = 3000;

const samples = [
  tplLowFuel({ fuelPct: 25, fuelLitres: 195, thresholdPct: 30, burnRate: 18.4, hoursLeft: 10.6 }),
  tplOverload({ kwTotal: 305, ratedKw: 320, thresholdPct: 90, loadPct: 95 }),
  tplFrequency({ freq: 53.1 }),
  tplPowerFactor({ pf: 0.72, leadLag: 'lagging' }),
  tplRpm({ rpm: 1580 }),
  tplRefill({ beforeL: 120, afterL: 700, addedL: 580, beforePct: 15, afterPct: 90, person: 'Naveen' }),
  tplServiceDue({ engHours: 1503, milestone: 1500, intervalHrs: 500 }),
  tplDailySummary({
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    fuelConsumedL: 142, fuelStartL: 620, fuelEndL: 478,
    avgKw: 186.4, peakKw: 298.2, runHours: 9.5,
    refillsToday: [{ addedL: 300 }],
    minRpm: 1492, maxRpm: 1508, avgFreq: 50.02, avgPf: 0.91,
    alertsToday: ['Overload Warning at 14:32 — 312 kW', 'Low Fuel Alert at 18:10 — 28%']
  })
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`[Test] Sending ${samples.length} template emails to ${TEST_TO}...\n`);

  for (let i = 0; i < samples.length; i++) {
    const { subject, html } = samples[i];
    console.log(`[Test] (${i + 1}/${samples.length}) Sending "${subject}"...`);
    await sendEmail({ to: TEST_TO, subject, html, textFallback: subject });
    if (i < samples.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n[Test] Done — check your inbox for all templates.');
})();