'use strict';
require('dotenv').config();
const mqtt = require('mqtt');
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const { MongoClient } = require('mongodb');


const { tplLowFuel, tplOverload, tplFrequency, tplPowerFactor, tplRpm, tplDailySummary, sendEmail } = require('./email.js');

const PORT            = process.env.PORT || 3000;
const MAX_HISTORY     = 60;    // live rolling window (~2 min at 2s polls)
const MAX_DAY_POINTS  = 43200; // 24h at 2s = 43200 points max per day

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════
//  MONGODB CONNECTION
// ════════════════════════════════════════════════════════════════
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB  = process.env.MONGO_DB || 'gensight';

let db = null;

async function connectMongo() {
  try {
    const client = await MongoClient.connect(MONGO_URI, {
      tls: true,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    db = client.db(MONGO_DB);
    console.log('[MongoDB] Connected ✓  db =', MONGO_DB);
    loadRefillCache();
    loadGensetSettings();  // ← called too early, db is null here
  } catch (e) {
    console.error('[MongoDB] Connection failed:', e.message);
    console.log('[MongoDB] Retrying in 15s...');
    setTimeout(connectMongo, 15000);
  }
}
connectMongo();

// ════════════════════════════════════════════════════════════════
//  MQTT CLIENT  (HiveMQ Cloud — TLS 8883)
// ════════════════════════════════════════════════════════════════
const mqttClient = mqtt.connect(`mqtts://${process.env.MQTT_BROKER}`, {
    port:     parseInt(process.env.MQTT_PORT) || 8883,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientId: `${process.env.MQTT_CLIENT_ID || 'gensight-server'}-${Math.random().toString(16).slice(2, 8)}`,
    rejectUnauthorized: true,
    keepalive: 30,
    reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to HiveMQ Cloud ✓');
    mqttClient.subscribe(process.env.MQTT_TOPIC_DATA, { qos: 1 }, (err) => {
        if (err) console.error('[MQTT] Subscribe error:', err.message);
        else     console.log(`[MQTT] Subscribed -> ${process.env.MQTT_TOPIC_DATA}`);
    });
});

mqttClient.on('error',   e  => console.error('[MQTT] Error:',      e.message));
mqttClient.on('offline', () => console.warn ('[MQTT] Offline - reconnecting...'));
mqttClient.on('reconnect',()=> console.log  ('[MQTT] Reconnecting...'));

// -- Inbound MQTT message (ESP32 -> broker -> server) ---------
mqttClient.on('message', (topic, message) => {
    if (topic !== process.env.MQTT_TOPIC_DATA) return;
    let payload;
    try { payload = JSON.parse(message.toString()); }
    catch (e) { console.error('[MQTT] Bad JSON:', e.message); return; }

    if (!payload || !payload.ac || !payload.engine) {
        console.warn('[MQTT] Payload missing ac/engine - ignored');
        return;
    }

    // ── Capture genset identity once ──────────────────────────
    if (!gensetInfo.fetched && payload.gensetInfo) {
        if (payload.gensetInfo.modelNumber)  gensetInfo.modelNumber  = payload.gensetInfo.modelNumber;
        if (payload.gensetInfo.serialNumber) gensetInfo.serialNumber = payload.gensetInfo.serialNumber;
        if (gensetInfo.modelNumber && gensetInfo.serialNumber) {
            gensetInfo.fetched = true;
            console.log(`[Genset] Identity captured: Model=${gensetInfo.modelNumber} Serial=${gensetInfo.serialNumber}`);
        }
    }

    payload.serverTime         = new Date().toISOString();
    payload.stateLabel         = decodeGensetState(payload.stateCode || 0);
    payload.engineOpStateLabel = decodeEngineOpState((payload.engine?.opState) || 0);
    payload.canStatusLabel     = decodeCANStatus(payload.canStatus || 0);
    payload.amfStateLabel      = decodeAmfState(payload.amfState || 0);
    payload.xferSwLabel        = decodeXferSwitch(payload.xferSwStatus || 0);
    payload.nfpa110Active      = decodeNFPA110(payload.nfpa110 || 0);

    latestReading = payload;
    appendHistory(payload);
    io.emit('genset:update', buildBroadcast());

    const ac  = payload.ac     || {};
    const eng = payload.engine || {};
    console.log(
        `[MQTT] [${payload.serverTime.substring(11,19)}] ` +
        `State="${payload.stateLabel}" | RPM=${parseFloat(eng.rpm||0).toFixed(0)} | ` +
        `kW=${ac.kwTotal} | Freq=${ac.freq}Hz | Clients=${io.engine.clientsCount}`
    );
});


let gensetSettings = {
  refillThresholdL:      30,
  lowFuelPct:            30,
  overloadPct:           90,
  ratedKw:              320,
  serviceIntervalHrs:   500,
  alertEmails:           '',
  _lowFuelAlerted:       false,
  _overloadAlerted:      false,
  _freqAlerted:          false,   // ← ADD
  _pfAlerted:            false,   // ← ADD
  _rpmAlerted:           false,   // ← ADD
  _lastServiceMilestone: 0
};

async function loadGensetSettings() {
  if (!db) return;
  try {
    const doc = await db.collection('settings').findOne({ _id: 'config' });
    if (doc) gensetSettings = { ...gensetSettings, ...doc };
  } catch (e) { console.error('[Settings] load error:', e.message); }
}

app.post('/api/settings/verify', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === process.env.SETTINGS_PASSWORD });
});

app.get('/api/settings', (req, res) => {
  const { _lowFuelAlerted, _overloadAlerted, _lastServiceMilestone, ...pub } = gensetSettings;
  res.json(pub);
});

app.post('/api/settings', async (req, res) => {
  const allowed = ['refillThresholdL','lowFuelPct','overloadPct','ratedKw','serviceIntervalHrs','alertEmails'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  gensetSettings = { ...gensetSettings, ...update };
  if (db) {
    try {
      await db.collection('settings').updateOne(
        { _id: 'config' }, { $set: update }, { upsert: true }
      );
    } catch (e) {
      console.error('[Settings] save error:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  res.json({ ok: true });
});

app.get('/api/test-email/:type', async (req, res) => {
  const samples = {
    lowfuel:  () => tplLowFuel({ fuelPct: 25, fuelLitres: 195, thresholdPct: 30, burnRate: 18.4, hoursLeft: 10.6 }),
    overload: () => tplOverload({ kwTotal: 305, ratedKw: 320, thresholdPct: 90, loadPct: 95 }),
    freq:     () => tplFrequency({ freq: 53.1 }),
    pf:       () => tplPowerFactor({ pf: 0.72 }),
    rpm:      () => tplRpm({ rpm: 1580 }),
    summary:  () => tplDailySummary({
      date: new Date().toLocaleDateString('en-IN'), fuelConsumedL: 142, fuelStartL: 620, fuelEndL: 478,
      avgKw: 186.4, peakKw: 298.2, runHours: 9.5, refillsToday: [{ addedL: 300 }],
      minRpm: 1492, maxRpm: 1508, avgFreq: 50.02, avgPf: 0.91,
      alertsToday: ['⚠️ Overload at 14:32', '⛽ Low Fuel at 18:10']
    })
  };
  const build = samples[req.params.type];
  if (!build) return res.status(400).json({ error: 'Unknown type. Use: lowfuel, overload, freq, pf, rpm, summary' });
  const tpl = build();
  await sendEmail({ to: gensetSettings.alertEmails, subject: tpl.subject, html: tpl.html });
  res.json({ ok: true, sent: tpl.subject });
});

// ════════════════════════════════════════════════════════════════
//  REFILL TRACKER  — paste this block into server.js
//  LOCATION 1: after the crankTracker declaration (around line 60)
// ════════════════════════════════════════════════════════════════

// ── Refill detection state ───────────────────────────────────
const REFILL_THRESHOLD_L = 30; // litres jump to count as refill

let refillTracker = {
  prevFuelL:    null,   // last known fuel litres
  prevFuelPct:  null,   // last known fuel %
};

// In-memory cache of recent refills (also persisted to MongoDB)
let refillCache = [];   // [{_id, time, beforeL, afterL, addedL, beforePct, afterPct, person, auto}]

// Load existing refills from MongoDB on startup
async function loadRefillCache() {
  if (!db) return;
  try {
    const docs = await db.collection('refills')
      .find({})
      .sort({ time: -1 })
      .limit(100)
      .toArray();
    refillCache = docs.map(d => ({
      id:        d._id.toString(),
      time:      d.time,
      beforeL:   d.beforeL,
      afterL:    d.afterL,
      addedL:    d.addedL,
      beforePct: d.beforePct,
      afterPct:  d.afterPct,
      person:    d.person || 'Auto-detected',
      auto:      d.auto !== false
    }));
    console.log(`[Refill] Loaded ${refillCache.length} records from MongoDB`);
  } catch(e) {
    console.error('[Refill] loadRefillCache error:', e.message);
  }
}

// ── Called from appendHistory() on every reading ─────────────
function detectRefill(fuelL, fuelPct, timestamp) {
  if (refillTracker.prevFuelL === null) {
    refillTracker.prevFuelL   = fuelL;
    refillTracker.prevFuelPct = fuelPct;
    return;
  }

  const delta = fuelL - refillTracker.prevFuelL;

  if (delta >= REFILL_THRESHOLD_L) {
    const record = {
      time:      new Date().toISOString(),
      beforeL:   Math.round(refillTracker.prevFuelL),
      afterL:    Math.round(fuelL),
      addedL:    Math.round(delta),
      beforePct: Math.round(refillTracker.prevFuelPct),
      afterPct:  Math.round(fuelPct),
      person:    'Auto-detected',
      auto:      true
    };

    // Save to MongoDB
    if (db) {
      db.collection('refills')
        .insertOne({ ...record })
        .then(result => {
          record.id = result.insertedId.toString();
          refillCache.unshift(record);
          if (refillCache.length > 100) refillCache.pop();
          console.log(`[Refill] ✅ Detected! +${record.addedL}L (${record.beforeL}L → ${record.afterL}L)`);
          // Broadcast to all connected clients
          io.emit('refill:detected', record);
        })
        .catch(e => console.error('[Refill] insertOne error:', e.message));
    } else {
      // No MongoDB — keep in memory only
      record.id = Date.now().toString();
      refillCache.unshift(record);
      if (refillCache.length > 100) refillCache.pop();
      io.emit('refill:detected', record);
    }
  }

  refillTracker.prevFuelL   = fuelL;
  refillTracker.prevFuelPct = fuelPct;
}

// GET — fetch all refill records
app.get('/api/refills', async (req, res) => {
  if (db) {
    try {
      const docs = await db.collection('refills')
        .find({})
        .sort({ time: -1 })
        .limit(100)
        .toArray();
      return res.json(docs.map(d => ({
        id:        d._id.toString(),
        time:      d.time,
        beforeL:   d.beforeL,
        afterL:    d.afterL,
        addedL:    d.addedL,
        beforePct: d.beforePct,
        afterPct:  d.afterPct,
        person:    d.person || 'Auto-detected',
        auto:      d.auto !== false
      })));
    } catch(e) {
      console.error('[Refill] GET error:', e.message);
      return res.json(refillCache);
    }
  }
  res.json(refillCache);
});

// PATCH — update person name for a refill record
app.patch('/api/refills/:id', async (req, res) => {
  const { id } = req.params;
  const { person } = req.body;
  if (!person) return res.status(400).json({ error: 'person required' });

  // Update in-memory cache
  const cached = refillCache.find(r => r.id === id);
  if (cached) { cached.person = person; cached.auto = false; }

  if (db) {
    try {
      const { ObjectId } = require('mongodb');
      await db.collection('refills').updateOne(
        { _id: new ObjectId(id) },
        { $set: { person, auto: false } }
      );
      return res.json({ ok: true });
    } catch(e) {
      console.error('[Refill] PATCH error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }
  res.json({ ok: true });
});

// POST — manual refill record (from UI manual entry)
app.post('/api/refills', async (req, res) => {
  const { beforeL, afterL, person, time } = req.body;
  if (!beforeL || !afterL) return res.status(400).json({ error: 'beforeL and afterL required' });

  const record = {
    time:      time || new Date().toISOString(),
    beforeL:   Math.round(beforeL),
    afterL:    Math.round(afterL),
    addedL:    Math.round(afterL - beforeL),
    beforePct: Math.round(beforeL / 780 * 100),
    afterPct:  Math.round(afterL  / 780 * 100),
    person:    person || 'Manual entry',
    auto:      false
  };

  if (db) {
    try {
      const result = await db.collection('refills').insertOne({ ...record });
      record.id = result.insertedId.toString();
      refillCache.unshift(record);
      io.emit('refill:detected', record);
      return res.json({ ok: true, record });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
  record.id = Date.now().toString();
  refillCache.unshift(record);
  io.emit('refill:detected', record);
  res.json({ ok: true, record });
});

// ════════════════════════════════════════════════════════════════
//  DATA STORAGE
// ════════════════════════════════════════════════════════════════
let latestReading = null;
const dateStore   = {};

let amfStateTracker = {
  prevState:       null,
  dropoutTime:     null,
  lastTransferMs:  null,
  transferLog:     []
};

let crankTracker = {
  prevEngineState: null,
  crankStartTime:  null,
  lastCrankMs:     null,
  crankLog:        []
};

let gensetInfo = {
  modelNumber:          null,
  serialNumber:         null,
  lowBattThreshold:     null,
  weakBattThreshold:    null,
  highBattThreshold:    null,
  lowCoolantTempThresh: null,
  fetched:              false
};

const HISTORY_KEYS = [
    'timestamps',
    'voltL1N','voltL2N','voltL3N',
    'voltL1L2','voltL2L3','voltL3L1',
    'currL1','currL2','currL3',
    'currPctL1','currPctL2','currPctL3',
    'kwTotal','kwL1','kwL2','kwL3',
    'kvarTotal','kvarL1','kvarL2','kvarL3',
    'kvaTotal','kvaL1','kvaL2','kvaL3',
    'frequency','pf',
    'coolantTempF','oilTempF','intakeTempF','fuelTempF','exhaustTempF',
    'oilPressPsi','boostPressPsi','crankPressPsi','fuelSupplyPsi',
    'coolantPsi','fuelRailPsi',
    'engineRPM','torquePct',
    'battV','chargeAltV',
    'fuelLevelPct','fuelLevelL',
    'utilVoltL1N','utilVoltL2N','utilVoltL3N',
    'utilVoltL1L2','utilVoltL2L3','utilVoltL3L1',
    'utilFrequency',
    'gensetState','faultCode','amfState','xferSwStatus',
    'fuelShutoffActive','starterActive'
];

function emptyDayRecord() {
    const rec = {};
    HISTORY_KEYS.forEach(k => { rec[k] = []; });
    return rec;
}

function todayKey() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}


function checkAlertThresholds(row, payload) {
  const to = gensetSettings.alertEmails;

  // 1. Low fuel
  if (row.fuelLevelPct > 0) {
    if (row.fuelLevelPct <= gensetSettings.lowFuelPct && !gensetSettings._lowFuelAlerted) {
      gensetSettings._lowFuelAlerted = true;
      const litres = Math.round(row.fuelLevelPct / 100 * 780);
      const tpl = tplLowFuel({
        fuelPct: row.fuelLevelPct, fuelLitres: litres,
        thresholdPct: gensetSettings.lowFuelPct
      });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    } else if (row.fuelLevelPct > gensetSettings.lowFuelPct + 5) {
      gensetSettings._lowFuelAlerted = false;
    }
  }

  // 2. Overload
  if (row.kwTotal > 0) {
    const overloadKw = gensetSettings.overloadPct / 100 * gensetSettings.ratedKw;
    if (row.kwTotal >= overloadKw && !gensetSettings._overloadAlerted) {
      gensetSettings._overloadAlerted = true;
      const loadPct = Math.round(row.kwTotal / gensetSettings.ratedKw * 100);
      const tpl = tplOverload({
        kwTotal: row.kwTotal.toFixed(1), ratedKw: gensetSettings.ratedKw,
        thresholdPct: gensetSettings.overloadPct, loadPct
      });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    } else if (row.kwTotal < overloadKw - (gensetSettings.ratedKw * 0.05)) {
      gensetSettings._overloadAlerted = false;
    }
  }

  // 3. Frequency deviation (outside 47.5–52.5 Hz)
  if (row.frequency > 0) {
    if ((row.frequency < 47.5 || row.frequency > 52.5) && !gensetSettings._freqAlerted) {
      gensetSettings._freqAlerted = true;
      const tpl = tplFrequency({ freq: row.frequency.toFixed(2) });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    } else if (row.frequency >= 48 && row.frequency <= 52) {
      gensetSettings._freqAlerted = false;
    }
  }

  // 4. Poor power factor (below 0.8)
  if (row.pf > 0) {
    if (row.pf < 0.8 && !gensetSettings._pfAlerted) {
      gensetSettings._pfAlerted = true;
      const leadLag = (row.kvarTotal || 0) < -1 ? 'leading' : 'lagging';
      const tpl = tplPowerFactor({ pf: row.pf.toFixed(3), leadLag });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    } else if (row.pf >= 0.85) {
      gensetSettings._pfAlerted = false;
    }
  }

  // 5. RPM out of range (outside 1450–1550)
  if (row.engineRPM > 100) {
    if ((row.engineRPM < 1450 || row.engineRPM > 1550) && !gensetSettings._rpmAlerted) {
      gensetSettings._rpmAlerted = true;
      const tpl = tplRpm({ rpm: Math.round(row.engineRPM) });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    } else if (row.engineRPM >= 1470 && row.engineRPM <= 1530) {
      gensetSettings._rpmAlerted = false;
    }
  }

  // 6. Service due
  const engHours = parseFloat((payload.engine || {}).hours) || 0;
  if (engHours > 0 && gensetSettings.serviceIntervalHrs > 0) {
    const milestone = Math.floor(engHours / gensetSettings.serviceIntervalHrs) * gensetSettings.serviceIntervalHrs;
    if (milestone > 0 && milestone > gensetSettings._lastServiceMilestone) {
      gensetSettings._lastServiceMilestone = milestone;
      const tpl = tplServiceDue({ engHours: engHours.toFixed(0), milestone, intervalHrs: gensetSettings.serviceIntervalHrs });
      sendEmail({ to, subject: tpl.subject, html: tpl.html });
    }
  }
}

const liveHistory = {};
HISTORY_KEYS.forEach(k => { liveHistory[k] = []; });

function appendHistory(payload) {
  const ts   = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const ac   = payload.ac         || {};
  const eng  = payload.engine     || {};
  const fuel = payload.fuel       || {};
  const elec = payload.electrical || {};
  const util = payload.utility    || {};

  const vL1 = parseFloat(ac.voltL1N) || 0;
  const vL2 = parseFloat(ac.voltL2N) || 0;
  const vL3 = parseFloat(ac.voltL3N) || 0;
  const vAvg = (vL1 + vL2 + vL3) / 3;
  const voltUnbalancePct = vAvg > 0
    ? +( Math.max(Math.abs(vL1-vAvg), Math.abs(vL2-vAvg), Math.abs(vL3-vAvg)) / vAvg * 100 ).toFixed(2)
    : 0;
    
  const cL1 = parseFloat(ac.currL1) || 0;
  const cL2 = parseFloat(ac.currL2) || 0;
  const cL3 = parseFloat(ac.currL3) || 0;
  const cAvg = (cL1 + cL2 + cL3) / 3;
  const currUnbalancePct = cAvg > 1
    ? +( Math.max(Math.abs(cL1-cAvg), Math.abs(cL2-cAvg), Math.abs(cL3-cAvg)) / cAvg * 100 ).toFixed(2)
    : 0;

  const kvar = parseFloat(ac.kvarTotal) || 0;
  const pfLeadLag = kvar < -1 ? -1 : kvar > 1 ? 1 : 0;

  const amfState = payload.amfState || 0;
  if (amfState === 3 && amfStateTracker.prevState !== 3) {
    amfStateTracker.dropoutTime = Date.now();
  }
  if (amfState === 8 && amfStateTracker.prevState !== 8 && amfStateTracker.dropoutTime) {
    amfStateTracker.lastTransferMs = Date.now() - amfStateTracker.dropoutTime;
    const entry = {
      ts,
      durationMs:  amfStateTracker.lastTransferMs,
      durationSec: +(amfStateTracker.lastTransferMs / 1000).toFixed(1),
      passed:      amfStateTracker.lastTransferMs <= 10000
    };
    amfStateTracker.transferLog.unshift(entry);
    if (amfStateTracker.transferLog.length > 20) amfStateTracker.transferLog.pop();
    amfStateTracker.dropoutTime = null;
    console.log(`[AMF] Transfer complete in ${entry.durationSec}s ${entry.passed ? 'OK' : 'EXCEEDS 10s NFPA110'}`);
  }
  amfStateTracker.prevState = amfState;

  const engineOpState = payload.engineOpState || 0;
  if (engineOpState === 2 && crankTracker.prevEngineState !== 2) {
    crankTracker.crankStartTime = Date.now();
  }
  if (engineOpState !== 2 && crankTracker.prevEngineState === 2 && crankTracker.crankStartTime) {
    crankTracker.lastCrankMs = Date.now() - crankTracker.crankStartTime;
    const entry = {
      ts,
      durationMs:  crankTracker.lastCrankMs,
      durationSec: +(crankTracker.lastCrankMs / 1000).toFixed(1),
      hardStart:   crankTracker.lastCrankMs > 15000
    };
    crankTracker.crankLog.unshift(entry);
    if (crankTracker.crankLog.length > 20) crankTracker.crankLog.pop();
    crankTracker.crankStartTime = null;
    console.log(`[CRANK] Duration: ${entry.durationSec}s ${entry.hardStart ? 'HARD START' : 'OK'}`);
  }
  crankTracker.prevEngineState = engineOpState;

  const row = {
    timestamps:         ts,
    voltL1N:            vL1,
    voltL2N:            vL2,
    voltL3N:            vL3,
    voltL1L2:           parseFloat(ac.voltL1L2)     || 0,
    voltL2L3:           parseFloat(ac.voltL2L3)     || 0,
    voltL3L1:           parseFloat(ac.voltL3L1)     || 0,
    currL1:             cL1,
    currL2:             cL2,
    currL3:             cL3,
    currPctL1:          parseFloat(ac.currPctL1)    || 0,
    currPctL2:          parseFloat(ac.currPctL2)    || 0,
    currPctL3:          parseFloat(ac.currPctL3)    || 0,
    kwTotal:            parseFloat(ac.kwTotal)      || 0,
    kwL1:               parseFloat(ac.kwL1)         || 0,
    kwL2:               parseFloat(ac.kwL2)         || 0,
    kwL3:               parseFloat(ac.kwL3)         || 0,
    kvarTotal:          parseFloat(ac.kvarTotal)    || 0,
    kvarL1:             parseFloat(ac.kvarL1)       || 0,
    kvarL2:             parseFloat(ac.kvarL2)       || 0,
    kvarL3:             parseFloat(ac.kvarL3)       || 0,
    kvaTotal:           parseFloat(ac.kvaTotal)     || 0,
    kvaL1:              parseFloat(ac.kvaL1)        || 0,
    kvaL2:              parseFloat(ac.kvaL2)        || 0,
    kvaL3:              parseFloat(ac.kvaL3)        || 0,
    frequency:          parseFloat(ac.freq)         || 0,
    pf:                 parseFloat(ac.pf)           || 0,
    voltUnbalancePct,
    currUnbalancePct,
    pfLeadLag,
    coolantTempF:       parseFloat(eng.coolantTempF)    || 0,
    oilTempF:           parseFloat(eng.oilTempF)        || 0,
    intakeTempF:        parseFloat(eng.intakeTempF)     || 0,
    fuelTempF:          parseFloat(eng.fuelTempF)       || 0,
    exhaustTempF:       parseFloat(eng.exhaustTempF)    || 0,
    oilPressPsi:        parseFloat(eng.oilPressPsi)     || 0,
    boostPressPsi:      parseFloat(eng.boostPressPsi)   || 0,
    crankPressPsi:      parseFloat(eng.crankPressPsi)   || 0,
    fuelSupplyPsi:      parseFloat(eng.fuelPressPsi)    || 0,
    coolantPsi:         parseFloat(eng.coolantPsi)      || 0,
    fuelRailPsi:        parseFloat(eng.fuelRailPsi)     || 0,
    engineRPM:          parseFloat(eng.rpm)             || 0,
    torquePct:          parseFloat(eng.torquePct)       || 0,
    battV:              parseFloat(elec.battV)          || 0,
    chargeAltV:         parseFloat(elec.chargeAltV)     || 0,
    fuelLevelPct:       parseFloat(fuel.pct)            || 0,
    fuelLevelL:         parseFloat(fuel.litres)         || 0,
    fuelLitresDirect:   parseFloat(fuel.litresDirect)   || 0,
    utilVoltL1N:        parseFloat(util.voltL1N)        || 0,
    utilVoltL2N:        parseFloat(util.voltL2N)        || 0,
    utilVoltL3N:        parseFloat(util.voltL3N)        || 0,
    utilVoltL1L2:       parseFloat(util.voltL1L2)       || 0,
    utilVoltL2L3:       parseFloat(util.voltL2L3)       || 0,
    utilVoltL3L1:       parseFloat(util.voltL3L1)       || 0,
    utilFrequency:      parseFloat(util.freq)           || 0,
    gensetState:        payload.stateCode               || 0,
    faultCode:          payload.faultCode               || 0,
    amfState:           payload.amfState                || 0,
    xferSwStatus:       payload.xferSwStatus            || 0,
    fuelShutoffActive:  payload.fuelShutoffActive       || 0,
    starterActive:      payload.starterActive           || 0,
    atsExtended:        payload.atsExtended             || 0,
    exerciseState:      payload.exerciseState           || 0,
    unrecognizedSPN:    payload.unrecognizedSPN         || 0
  };

  HISTORY_KEYS.forEach(k => {
    liveHistory[k].push(row[k]);
    if (liveHistory[k].length > MAX_HISTORY) liveHistory[k].shift();
  });

  const dk = todayKey();
  if (!dateStore[dk]) dateStore[dk] = emptyDayRecord();
  HISTORY_KEYS.forEach(k => {
    dateStore[dk][k].push(row[k]);
    if (dateStore[dk][k].length > MAX_DAY_POINTS) dateStore[dk][k].shift();
  });

  if (voltUnbalancePct > 2) {
    payload._alert_voltUnbal = `Voltage unbalance ${voltUnbalancePct}% (NEMA limit: 3%)`;
  }
  if (currUnbalancePct > 10) {
    payload._alert_currUnbal = `Current unbalance ${currUnbalancePct}%`;
  }
  if (payload.unrecognizedSPN === 1) {
    payload._alert_spn = `ECM sent unrecognized SPN/FMI code - check engine diagnostics`;
  }

  // ── Refill detection ──────────────────────────────────────
  const _fuelL = row.fuelLevelL > 0
    ? row.fuelLevelL
    : Math.round(row.fuelLevelPct * 780 / 100);
  detectRefill(_fuelL, row.fuelLevelPct, ts);

  // ── Threshold-based email alerts ───────────────────────────
  checkAlertThresholds(row, payload);

  if (db) {
    const doc = { ...row, date: dk };
    db.collection('history')
      .insertOne(doc)
      .catch(e => console.error('[MongoDB] insertOne error:', e.message));
  }

}

function mergeDateRange(fromDate, toDate) {
    const merged = emptyDayRecord();
    const from = new Date(fromDate);
    const to   = new Date(toDate);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const dk = d.toISOString().slice(0, 10);
        const rec = dateStore[dk];
        if (!rec) continue;
        HISTORY_KEYS.forEach(k => {
            if (k === 'timestamps') {
                rec[k].forEach(ts => merged.timestamps.push(`${dk} ${ts}`));
            } else {
                merged[k].push(...rec[k]);
            }
        });
    }
    return merged;
}

// ════════════════════════════════════════════════════════════════
//  DECODERS
// ════════════════════════════════════════════════════════════════
function decodeGensetState(code) {
    const s = {0:'OFF',1:'STOP',2:'PREHEAT',3:'PRECRANK',4:'CRANK',
        5:'STARTER DISCONNECT',6:'PRE-RAMP',7:'RAMP',8:'RUNNING',
        9:'FAULT SHUTDOWN',10:'PRERUN SETUP',11:'RUNTIME SETUP',
        12:'FACTORY TEST',13:'WAITING FOR POWERDOWN'};
    return s[code] || 'UNKNOWN';
}

function decodeEngineOpState(code) {
    const s = {0:'Engine Stopped',1:'Prestart',2:'Starting',3:'Warmup',
        4:'Running',5:'Cooldown',6:'Engine Stopping',7:'Post Run',
        8:'Out of Range',9:'N/A',10:'Network Failure'};
    return s[code] || 'Unknown';
}

function decodeCANStatus(code) {
    return ['Inactive','Active','Failed'][code] || 'Unknown';
}

function decodeAmfState(code) {
    const s = {0:'AMF Not Available',1:'Transfer Retransfer Off',2:'Utility Pickup',
        3:'Utility Dropout',4:'Genset Starting',5:'Transfer Start',6:'Utility CB Opened',
        7:'Genset CB Closed',8:'Transfer Complete',9:'Retransfer Start',10:'Genset CB Opened',
        11:'Utility CB Closed',12:'Retransfer Complete',13:'Transfer Fail',14:'Retransfer Fail'};
    return s[code] || 'Unknown';
}

function decodeXferSwitch(code) {
    const s = {0:'Not Available',1:'At Utility',2:'At Genset',3:'Unknown Open',4:'Unknown Closed'};
    return s[code] || 'Unknown';
}

const NFPA110_BITS = [
    {bit:0,name:'Low Fuel Level',severity:'warning'},
    {bit:1,name:'Low Coolant Level',severity:'warning'},
    {bit:2,name:'Overspeed',severity:'shutdown'},
    {bit:3,name:'Low Oil Pressure',severity:'shutdown'},
    {bit:4,name:'Pre-Low Oil Pressure',severity:'warning'},
    {bit:5,name:'High Engine Temperature',severity:'shutdown'},
    {bit:6,name:'Pre-High Engine Temperature',severity:'warning'},
    {bit:7,name:'Low Coolant Temperature',severity:'warning'},
    {bit:8,name:'Fail to Start',severity:'shutdown'},
    {bit:9,name:'Charger AC Failure',severity:'warning'},
    {bit:10,name:'Low Battery Voltage / Weak Battery',severity:'warning'},
    {bit:11,name:'High Battery Voltage',severity:'warning'},
    {bit:12,name:'Not in Auto',severity:'warning'},
    {bit:13,name:'Genset Running',severity:'info'},
    {bit:14,name:'Genset Supplying Load',severity:'info'},
    {bit:15,name:'Common Alarm',severity:'warning'},
    {bit:16,name:'Emergency Stop',severity:'shutdown'},
    {bit:17,name:'Utility Circuit Breaker Tripped',severity:'warning'},
    {bit:18,name:'Genset Circuit Breaker Tripped',severity:'warning'},
    {bit:19,name:'Load Demand',severity:'info'},
    {bit:20,name:'Fail to Close',severity:'warning'},
    {bit:21,name:'Fail to Sync',severity:'warning'},
    {bit:22,name:'Reverse kVAR',severity:'warning'},
    {bit:23,name:'Reverse kW',severity:'warning'},
    {bit:24,name:'Short Circuit',severity:'shutdown'},
    {bit:25,name:'Overcurrent',severity:'shutdown'},
    {bit:26,name:'Overload',severity:'warning'},
    {bit:27,name:'Under Frequency',severity:'warning'},
    {bit:28,name:'Low AC Voltage',severity:'warning'},
    {bit:29,name:'High AC Voltage',severity:'shutdown'},
    {bit:30,name:'Ground Fault',severity:'shutdown'},
    {bit:31,name:'Check Genset',severity:'warning'}
];

function decodeNFPA110(bitmask) {
    const val = bitmask >>> 0;
    return NFPA110_BITS.filter(b => val & (1 << b.bit))
        .map(b => ({ bit: b.bit, name: b.name, severity: b.severity }));
}

// ════════════════════════════════════════════════════════════════
//  REST ENDPOINTS
// ════════════════════════════════════════════════════════════════
app.post('/api/genset-data', (req, res) => {
    const payload = req.body;
    if (!payload || !payload.ac || !payload.engine) {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    payload.serverTime          = new Date().toISOString();
    payload.stateLabel          = decodeGensetState(payload.stateCode || 0);
    payload.engineOpStateLabel  = decodeEngineOpState((payload.engine && payload.engine.opState) || 0);
    payload.canStatusLabel      = decodeCANStatus(payload.canStatus || 0);
    payload.amfStateLabel       = decodeAmfState(payload.amfState || 0);
    payload.xferSwLabel         = decodeXferSwitch(payload.xferSwStatus || 0);
    payload.nfpa110Active       = decodeNFPA110(payload.nfpa110 || 0);

    latestReading = payload;
    appendHistory(payload);
    io.emit('genset:update', buildBroadcast());

    const ac  = payload.ac     || {};
    const eng = payload.engine || {};
    console.log(
        `[${payload.serverTime.substring(11,19)}] ` +
        `State="${payload.stateLabel}" | RPM=${parseFloat(eng.rpm||0).toFixed(0)} | ` +
        `kW=${ac.kwTotal} | Freq=${ac.freq}Hz | ` +
        `UtilV=${(payload.utility||{}).voltL1N||'--'}V | ` +
        `AMF="${payload.amfStateLabel}" | ` +
        `Fuel=${payload.fuel&&payload.fuel.pct}% | Clients=${io.engine.clientsCount}`
    );

    res.status(200).json({ ok: true, clients: io.engine.clientsCount });
});

app.get('/api/latest', (req, res) => {
    if (!latestReading) return res.status(204).end();
    res.json(buildBroadcast());
});

app.get('/api/health', (req, res) => {
    res.json({
        status:     'ok',
        uptime:     process.uptime().toFixed(0) + 's',
        clients:    io.engine.clientsCount,
        lastSeen:   latestReading && latestReading.serverTime || null,
        datesStored: Object.keys(dateStore).sort(),
        nfpaActive: latestReading && (latestReading.nfpa110Active || []).length || 0
    });
});

app.get('/api/derived', (req, res) => {
  res.json({
    lastTransferSec: amfStateTracker.lastTransferMs
      ? +(amfStateTracker.lastTransferMs / 1000).toFixed(1) : null,
    lastCrankSec: crankTracker.lastCrankMs
      ? +(crankTracker.lastCrankMs / 1000).toFixed(1) : null,
    transferLog: amfStateTracker.transferLog,
    crankLog:    crankTracker.crankLog,
    gensetInfo
  });
});

app.get('/api/dates', (req, res) => {
    const dates = Object.keys(dateStore).sort();
    res.json({ dates, count: dates.length });
});

app.get('/api/history', async (req, res) => {
  const { date, from, to, keys } = req.query;

  const wantedKeys = keys
    ? keys.split(',').filter(k => HISTORY_KEYS.includes(k))
    : HISTORY_KEYS;

  function emptyResponse() {
    const result = { pointCount: 0, noData: true, availableDates: Object.keys(dateStore).sort() };
    wantedKeys.forEach(k => { result[k] = []; });
    return res.status(200).json(result);
  }

  if (db) {
    try {
      let query = {};
      if (date) {
        query.date = date;
      } else if (from && to) {
        if (from > to) return res.status(400).json({ error: 'from must be <= to' });
        query.date = { $gte: from, $lte: to };
      } else {
        return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?from=...&to=...' });
      }

      const docs = await db.collection('history')
        .find(query, { projection: { _id: 0 } })
        .sort({ date: 1, timestamps: 1 })
        .toArray();

      if (!docs.length) return emptyResponse();

      const result = { pointCount: docs.length };
      wantedKeys.forEach(k => { result[k] = []; });
      docs.forEach(doc => {
        wantedKeys.forEach(k => {
          result[k].push(doc[k] !== undefined ? doc[k] : 0);
        });
      });

      return res.json(result);

    } catch (e) {
      console.error('[MongoDB] /api/history error:', e.message);
    }
  }

  let record;
  if (date) {
    record = dateStore[date];
    if (!record) return emptyResponse();
  } else if (from && to) {
    if (from > to) return res.status(400).json({ error: 'from must be <= to' });
    record = mergeDateRange(from, to);
    if (record.timestamps.length === 0) return emptyResponse();
  } else {
    return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?from=...&to=...' });
  }

  const result = { pointCount: record.timestamps.length };
  wantedKeys.forEach(k => { result[k] = record[k] || []; });
  res.json(result);
});

app.get('/api/summary', (req, res) => {
    const { date } = req.query;
    const dk = date || todayKey();
    const record = dateStore[dk];
    if (!record || record.timestamps.length === 0) {
        return res.status(404).json({ error: `No data for ${dk}` });
    }

    function stats(arr) {
        const valid = arr.filter(v => v !== 0);
        if (!valid.length) return { min: 0, max: 0, avg: 0, last: 0 };
        return {
            min:  +Math.min(...valid).toFixed(2),
            max:  +Math.max(...valid).toFixed(2),
            avg:  +(valid.reduce((a,b)=>a+b,0)/valid.length).toFixed(2),
            last: +valid[valid.length-1].toFixed(2)
        };
    }

    res.json({
        date: dk,
        pointCount: record.timestamps.length,
        timeRange: {
            first: record.timestamps[0],
            last:  record.timestamps[record.timestamps.length-1]
        },
        kwTotal:     stats(record.kwTotal),
        kvaTotal:    stats(record.kvaTotal),
        frequency:   stats(record.frequency),
        voltL1N:     stats(record.voltL1N),
        currL1:      stats(record.currL1),
        coolantTempF:stats(record.coolantTempF),
        oilPressPsi: stats(record.oilPressPsi),
        battV:       stats(record.battV),
        fuelLevelPct:stats(record.fuelLevelPct),
        utilVoltL1N: stats(record.utilVoltL1N),
        engineRPM:   stats(record.engineRPM)
    });
});

function buildBroadcast() {
  return {
    latest:  latestReading,
    history: liveHistory,
    derived: {
      lastTransferSec: amfStateTracker.lastTransferMs
        ? +(amfStateTracker.lastTransferMs / 1000).toFixed(1) : null,
      lastCrankSec: crankTracker.lastCrankMs
        ? +(crankTracker.lastCrankMs / 1000).toFixed(1) : null,
      transferLog: amfStateTracker.transferLog,
      crankLog:    crankTracker.crankLog,
      gensetInfo
    }
  };
}

// ════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log(`[WS] Connected: ${socket.id}  (total: ${io.engine.clientsCount})`);
    if (latestReading) {
        // Only send if data is fresh (within last 30 seconds)
        const age = Date.now() - new Date(latestReading.serverTime || 0).getTime();
        if (age < 30000) {
            socket.emit('genset:update', buildBroadcast());
        } else {
            // Data is stale — clear it so dashboard shows STANDBY
            latestReading = null;
        }
    }
    socket.on('disconnect', () => {
        console.log(`[WS] Disconnected: ${socket.id}  (total: ${io.engine.clientsCount})`);
    });
});

setInterval(() => {
    io.emit('clients:count', io.engine.clientsCount);
}, 5000);

// ════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════
server.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  GenSight v3.0 - Cummins 400kVA PS0600                      ║');
    console.log(`║  Dashboard : http://localhost:${PORT}                             ║`);
    console.log(`║  History   : http://localhost:${PORT}/api/history?date=YYYY-MM-DD ║`);
    console.log(`║  Dates     : http://localhost:${PORT}/api/dates                   ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
});