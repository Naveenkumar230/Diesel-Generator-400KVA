'use strict';
require('dotenv').config();

// ════════════════════════════════════════════════════════════════
//  GENSIGHT — COMPLETE EMAIL SYSTEM
//  Corporate Industrial templates + daily summary, sent via SMTP
//  Run standalone to preview/test: node email.js
// ════════════════════════════════════════════════════════════════

const BRAND = {
  name: 'GenSight',
  sub:  'Cummins 400kVA PS0600 — Generator Monitoring',
  navy: '#0f2942'
};

// Severity strip colors — everything else stays consistent (navy header, serif body, bordered table)
const SEVERITY = {
  critical: { bg: '#c1121f' }, // overload, frequency, rpm — immediate risk
  warning:  { bg: '#c1121f' }, // low fuel, power factor — same red banner as your reference template
  info:     { bg: '#1e3a5f' }, // service due — scheduled, not urgent
  good:     { bg: '#166534' }  // refill detected — positive event
};

// ── Shared shell — navy letterhead + colored alert strip + bordered table body ──
function shell(innerHtml) {
  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #d1d5db;">

    <!-- Letterhead -->
    <table role="presentation" width="100%" style="background: ${BRAND.navy}; padding: 0;">
      <tr>
        <td style="padding: 20px 30px;">
          <table role="presentation" width="100%"><tr>
            <td style="font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: 0.02em;">
              ${BRAND.name.toUpperCase()}
            </td>
            <td style="text-align: right; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #93a6bb;">
              GENERATOR MONITORING SYSTEM
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    <!-- Body -->
    ${innerHtml}

    <!-- Footer -->
    <table role="presentation" width="100%" style="background: #f9fafb; border-top: 1px solid #e5e7eb;">
      <tr>
        <td style="padding: 14px 30px; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #9ca3af;">
          This is an automated system-generated notification. Do not reply to this message.
        </td>
      </tr>
    </table>
  </div>`;
}

// ── Colored alert strip beneath the letterhead ──
function alertStrip({ icon, label, severity = 'warning' }) {
  const color = SEVERITY[severity].bg;
  return `
    <table role="presentation" width="100%" style="background: ${color};">
      <tr>
        <td style="padding: 10px 30px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 700; color: #ffffff; letter-spacing: 0.04em;">
          ${icon} ${label.toUpperCase()}
        </td>
      </tr>
    </table>`;
}

// ── Bordered data table, light gray header row ──
function dataTable(rows) {
  return `
    <table role="presentation" width="100%" style="border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; margin: 4px 0;">
      <tr>
        <td style="padding: 9px 12px; border: 1px solid #d1d5db; background: #f3f4f6; font-weight: 700; color: #374151; width: 46%;">Parameter</td>
        <td style="padding: 9px 12px; border: 1px solid #d1d5db; background: #f3f4f6; font-weight: 700; color: #374151;">Reading</td>
      </tr>
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding: 9px 12px; border: 1px solid #d1d5db; color: #4b5563;">${label}</td>
          <td style="padding: 9px 12px; border: 1px solid #d1d5db; color: #111827; font-weight: 700;">${value}</td>
        </tr>`).join('')}
    </table>`;
}

function bodyBlock({ text, table }) {
  return `
    <div style="padding: 26px 30px 6px;">
      <p style="font-family: Arial, Helvetica, sans-serif; font-size: 13.5px; line-height: 1.8; color: #1f2937; margin: 0 0 16px;">
        ${text}
      </p>
    </div>
    <div style="padding: 0 30px 22px;">
      ${table}
    </div>`;
}

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
}

// ════════════════════════════════════════════════════════════════
//  1. LOW FUEL ALERT
// ════════════════════════════════════════════════════════════════
function tplLowFuel({ fuelPct, fuelLitres, thresholdPct, thresholdLitres, burnRate, hoursLeft }) {
  const inner = `
    ${alertStrip({ icon: '⛽', label: 'Alert: Low Fuel Level', severity: 'warning' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Fuel level has fallen to <strong>${fuelPct}% (${fuelLitres} L)</strong>, below the configured operating threshold of <strong>${thresholdPct ?? '—'}%</strong>${thresholdLitres ? ` (${thresholdLitres} L)` : ''}. Refueling is recommended at the earliest opportunity to prevent an unplanned shutdown.`,
      table: dataTable([
        ['Current Fuel Level', `${fuelPct}% (${fuelLitres} L)`],
        ['Configured Threshold', `${thresholdPct ?? '—'}%`],
        ['Estimated Burn Rate', burnRate ? `${burnRate} L/hr` : 'Calculating…'],
        ['Estimated Runtime Remaining', hoursLeft ? `${hoursLeft} hours` : '—'],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Low Fuel Level', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  2. OVERLOAD ALERT
// ════════════════════════════════════════════════════════════════
function tplOverload({ kwTotal, ratedKw, thresholdPct, loadPct }) {
  const inner = `
    ${alertStrip({ icon: '🔴', label: 'Alert: Generator Overload', severity: 'critical' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Generator load is currently <strong>${kwTotal} kW (${loadPct}%)</strong> of rated capacity, exceeding the configured overload threshold of <strong>${thresholdPct}%</strong> (${(thresholdPct/100*ratedKw).toFixed(0)} kW) of the ${ratedKw} kW rated output. Sustained overload may shorten alternator life and could trigger a protective trip. Connected loads should be reviewed without delay.`,
      table: dataTable([
        ['Current Load', `${kwTotal} kW`],
        ['Load Percentage', `${loadPct}% of ${ratedKw} kW rated`],
        ['Overload Threshold', `${thresholdPct}%`],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Overload Warning', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  3. FREQUENCY DEVIATION ALERT
// ════════════════════════════════════════════════════════════════
function tplFrequency({ freq, nominal = 50, lowLimit = 47.5, highLimit = 52.5 }) {
  const high = freq > nominal;
  const inner = `
    ${alertStrip({ icon: '📉', label: `Alert: ${high ? 'High' : 'Low'} Frequency`, severity: 'critical' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Output frequency is reading <strong>${freq} Hz</strong>, outside the normal operating band of ${lowLimit}–${highLimit} Hz (nominal ${nominal} Hz). This typically indicates governor instability or a sudden load change, and connected equipment may be affected.`,
      table: dataTable([
        ['Current Frequency', `${freq} Hz`],
        ['Nominal Frequency', `${nominal} Hz`],
        ['Normal Operating Range', `${lowLimit} – ${highLimit} Hz`],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Frequency Deviation', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  4. POWER FACTOR ALERT
// ════════════════════════════════════════════════════════════════
function tplPowerFactor({ pf, threshold = 0.8, leadLag = 'lagging' }) {
  const inner = `
    ${alertStrip({ icon: '📐', label: 'Alert: Poor Power Factor', severity: 'warning' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Power factor has dropped to <strong>${pf} (${leadLag})</strong>, below the acceptable threshold of <strong>${threshold}</strong>. A reduced power factor increases current draw for the same real power delivered and may indicate an inductive or capacitive load imbalance. Connected equipment and power factor correction capacitor banks should be reviewed.`,
      table: dataTable([
        ['Current Power Factor', `${pf} (${leadLag})`],
        ['Acceptable Threshold', `${threshold}`],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Poor Power Factor', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  5. RPM / ENGINE SPEED ALERT
// ════════════════════════════════════════════════════════════════
function tplRpm({ rpm, nominal = 1500, lowLimit = 1450, highLimit = 1550 }) {
  const high = rpm > nominal;
  const inner = `
    ${alertStrip({ icon: '⚙️', label: `Alert: Engine ${high ? 'Overspeed' : 'Underspeed'}`, severity: 'critical' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Engine speed is reading <strong>${rpm} RPM</strong>, outside the expected operating range of ${lowLimit}–${highLimit} RPM (nominal ${nominal} RPM for 50 Hz synchronous operation). This may indicate governor malfunction, a fuel delivery issue, or a mechanical fault. Immediate inspection is recommended.`,
      table: dataTable([
        ['Current Engine Speed', `${rpm} RPM`],
        ['Nominal Speed', `${nominal} RPM`],
        ['Normal Operating Range', `${lowLimit} – ${highLimit} RPM`],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Engine Speed Alert', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  6. REFILL DETECTED
// ════════════════════════════════════════════════════════════════
function tplRefill({ beforeL, afterL, addedL, beforePct, afterPct, person = 'Auto-detected' }) {
  const inner = `
    ${alertStrip({ icon: '✅', label: 'Notice: Fuel Refill Recorded', severity: 'good' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. A fuel refill has been recorded — tank level increased from <strong>${beforeL} L</strong> to <strong>${afterL} L</strong>, an addition of <strong>${addedL} L</strong>. This entry has been logged in the site fuel register.`,
      table: dataTable([
        ['Level Before Refill', `${beforeL} L (${beforePct}%)`],
        ['Level After Refill', `${afterL} L (${afterPct}%)`],
        ['Litres Added', `${addedL} L`],
        ['Logged By', person],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Fuel Refill Recorded', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  7. SERVICE DUE
// ════════════════════════════════════════════════════════════════
function tplServiceDue({ engHours, milestone, intervalHrs }) {
  const inner = `
    ${alertStrip({ icon: '🔧', label: 'Notice: Scheduled Service Due', severity: 'info' })}
    ${bodyBlock({
      text: `This is an automated notification from the Cummins 400kVA PS0600 monitoring unit. Engine running hours have reached <strong>${engHours}</strong>, crossing the <strong>${milestone}-hour</strong> service milestone (interval: every ${intervalHrs} hours). Please arrange scheduled maintenance at the earliest convenience.`,
      table: dataTable([
        ['Current Engine Hours', `${engHours} h`],
        ['Service Milestone Reached', `${milestone} h`],
        ['Standard Service Interval', `every ${intervalHrs} h`],
        ['Timestamp', nowIST()]
      ])
    })}`;
  return { subject: 'Service Due', html: shell(inner) };
}

// ════════════════════════════════════════════════════════════════
//  8. DAILY EVENING SUMMARY
// ════════════════════════════════════════════════════════════════
function tplDailySummary({
  date, fuelConsumedL, fuelStartL, fuelEndL, avgKw, peakKw, runHours,
  refillsToday = [], minRpm, maxRpm, avgFreq, avgPf, alertsToday = []
}) {
  const inner = `
    ${alertStrip({ icon: '📋', label: `Daily Operations Summary — ${date}`, severity: 'info' })}
    <div style="padding: 26px 30px 6px;">
      <p style="font-family: Arial, Helvetica, sans-serif; font-size: 13.5px; line-height: 1.8; color: #1f2937; margin: 0 0 16px;">
        The following is a summary of generator activity recorded over the preceding 24-hour period for the Cummins 400kVA PS0600.
      </p>
    </div>
    <div style="padding: 0 30px 8px;">
      ${dataTable([
        ['Fuel Consumed', `${fuelConsumedL} L (${fuelStartL} L → ${fuelEndL} L)`],
        ['Engine Run Hours (Today)', `${runHours} h`],
        ['Average Load', `${avgKw} kW`],
        ['Peak Load', `${peakKw} kW`],
        ['Refills Recorded', refillsToday.length ? `${refillsToday.length} (${refillsToday.map(r => `+${r.addedL} L`).join(', ')})` : 'None'],
        ['RPM Range', `${minRpm} – ${maxRpm} RPM`],
        ['Average Frequency', `${avgFreq} Hz`],
        ['Average Power Factor', `${avgPf}`]
      ])}
    </div>
    <div style="padding: 4px 30px 22px;">
      <div style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin: 12px 0 8px;">
        Alerts Triggered During Period
      </div>
      ${alertsToday.length === 0
        ? `<p style="font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; color: #166534; font-weight: 700; margin: 0;">No alerts were triggered. Operating parameters remained within normal limits throughout the period.</p>`
        : `<table role="presentation" width="100%" style="border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 12.5px;">
            ${alertsToday.map((a, i) => `
              <tr>
                <td style="padding: 7px 10px; border: 1px solid #d1d5db; width: 26px; color: #6b7280;">${i + 1}.</td>
                <td style="padding: 7px 10px; border: 1px solid #d1d5db; color: #111827;">${a}</td>
              </tr>`).join('')}
          </table>`}
    </div>`;
  return { subject: `Daily Summary — ${date}`, html: shell(inner) };
}

const nodemailer = require('nodemailer');

const _transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendEmail({ to, subject, html, textFallback }) {
  const recipients = (Array.isArray(to) ? to : String(to).split(','))
    .map(s => s.trim()).filter(Boolean);
  if (!recipients.length) { console.error('[Email] No recipients.'); return; }

  try {
    const info = await _transporter.sendMail({
      from: `"${process.env.ALERT_EMAIL_FROM_NAME || 'GenSight Alerts'}" <${process.env.ALERT_EMAIL_FROM}>`,
      to: recipients.join(','),
      subject: `GenSight — ${subject}`,
      html,
      text: textFallback || subject
    });
    console.log(`[Email] Sent ✓ "${subject}"  messageId: ${info.messageId}`);
  } catch (e) {
    console.error(`[Email] Failed "${subject}":`, e.message);
  }
}

module.exports = {
  tplLowFuel, tplOverload, tplFrequency, tplPowerFactor, tplRpm,
  tplRefill, tplServiceDue, tplDailySummary, sendEmail
};

// ════════════════════════════════════════════════════════════════
//  STANDALONE TEST RUN — node email.js
//  Change TEST_TO and TEST_TYPE below, then run.
// ════════════════════════════════════════════════════════════════
if (require.main === module) {
  const TEST_TO   = 'naveenkumarak@aquarelleindia.com'; // <-- change recipient
  const TEST_TYPE = 'dailySummary'; // lowFuel | overload | frequency | powerFactor | rpm | refill | serviceDue | dailySummary

  const samples = {
    lowFuel:      tplLowFuel({ fuelPct: 25, fuelLitres: 195, thresholdPct: 30, burnRate: 18.4, hoursLeft: 10.6 }),
    overload:     tplOverload({ kwTotal: 305, ratedKw: 320, thresholdPct: 90, loadPct: 95 }),
    frequency:    tplFrequency({ freq: 53.1 }),
    powerFactor:  tplPowerFactor({ pf: 0.72, leadLag: 'lagging' }),
    rpm:          tplRpm({ rpm: 1580 }),
    refill:       tplRefill({ beforeL: 120, afterL: 700, addedL: 580, beforePct: 15, afterPct: 90, person: 'Naveen' }),
    serviceDue:   tplServiceDue({ engHours: 1503, milestone: 1500, intervalHrs: 500 }),
    dailySummary: tplDailySummary({
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      fuelConsumedL: 142, fuelStartL: 620, fuelEndL: 478,
      avgKw: 186.4, peakKw: 298.2, runHours: 9.5,
      refillsToday: [{ addedL: 300 }],
      minRpm: 1492, maxRpm: 1508, avgFreq: 50.02, avgPf: 0.91,
      alertsToday: ['Overload Warning at 14:32 — 312 kW', 'Low Fuel Alert at 18:10 — 28%']
    })
  };

  const chosen = samples[TEST_TYPE];
  sendEmail({ to: TEST_TO, subject: chosen.subject, html: chosen.html, textFallback: chosen.subject });
}