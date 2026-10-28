'use strict';
process.env.TZ = 'Asia/Kolkata';   // ← add this as the very first line
require('dotenv').config();
const mqtt = require('mqtt');
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const { MongoClient } = require('mongodb');


const { tplLowFuel, tplOverload, tplFrequency, tplPowerFactor, tplRpm, tplDailySummary, tplServiceDue, sendEmail } = require('./email.js');
const PORT            = process.env.PORT || 3000;
const MAX_HISTORY     = 60;    // live rolling window (~2 min at 2s polls)
const MAX_DAY_POINTS  = 43200; // 24h at 2s = 43200 points max per day

const compression = require('compression');
const { createDgEngine } = require('./dg-engine');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(compression());  // gzip all responses — cuts JS/CSS/HTML/JSON size ~70-80%
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',   // browser caches static files for a day — instant on repeat visits
  etag: true
}));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 200) console.warn(`[SLOW] ${req.method} ${req.originalUrl} took ${ms}ms`);
  });
  next();
});

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
db.collection('fuel_events').createIndex({ date: 1, category: 1 });
db.collection('history').createIndex({ date: 1, timestamps: 1 });
db.collection('engine_events').createIndex({ date: 1, timestamp: 1 }); // ADD THIS

setupRefillCollections().then(loadRefillCache).then(() => dgEngine.load());
loadRefillDetectorState();
loadGensetSettings();
loadRuntimeState();
loadEngineHoursBaseline();
loadDeviceStatus();

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
`[MQTT] [${new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })}] ` +
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

let engineHoursBaseline = { dateKey: null, baselineHours: null };

// ── Engine start/stop event tracking ──
let engineRunTracker = { isRunning: null, lastStartTs: null };

async function loadGensetSettings() {
  if (!db) return;
  try {
    const doc = await db.collection('settings').findOne({ _id: 'config' });
    if (doc) gensetSettings = { ...gensetSettings, ...doc };
  } catch (e) { console.error('[Settings] load error:', e.message); }
}

//  Needs a new Render env var:  NOREFILL_PASSWORD
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
app.set('trust proxy', 1);   // Render sits behind a proxy (needed for per-IP rate limit)

// ── Settings: prediction thresholds + detection rules (separate!) ──
const REFILL_DEFAULTS = {
  refillPredictLowL:  25,   // prediction range (does NOT gate detection/confirmation)
  refillPredictHighL: 70,
  refillMinRiseL:     70,   // detection: minimum sustained rise to raise a candidate
  refillSettleSec:    90,   // detection: level must stop rising this long
  refillNoiseBandL:   10,   // detection: rises smaller than this are sensor noise
  tankCapacityL:      785
};

const REFILL_MIN_RISE_L = 100;

function rs(k) {
  const v = Number(gensetSettings[k]);
  return Number.isFinite(v) && v > 0 ? v : REFILL_DEFAULTS[k];
}
const tankL    = () => rs('tankCapacityL');
const pctOf    = L  => Math.round(L / tankL() * 100);
const dayKeyOf = t  => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function getRefillSettings() {
  const o = {}; Object.keys(REFILL_DEFAULTS).forEach(k => { o[k] = rs(k); }); return o;
}
function safeEq(a, b) {
  if (!b) return false;
  const h = s => crypto.createHash('sha256').update(String(s == null ? '' : s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// ── Mappers ─────────────────────────────────────────────────────
function mapRefill(d) {
  return {
    id: String(d._id || d.id), time: d.time,
    beforeL: d.beforeL, afterL: d.afterL, addedL: d.addedL,
    beforePct: d.beforePct, afterPct: d.afterPct,
    person: d.person || 'Auto-detected', auto: d.auto !== false,
    status: d.status || 'confirmed', legacy: !!d.legacy,
    confirmedAt: d.confirmedAt || null, candidateId: d.candidateId || null,
    dgStatus: d.dgStatus || null
  };
}
function mapCandidate(d) {
  return {
    id: String(d._id), detectedAt: d.detectedAt,
    beforeL: d.beforeL, afterL: d.afterL, increaseL: d.increaseL,
    beforePct: d.beforePct, afterPct: d.afterPct,
    dgStatus: d.dgStatus || null, status: d.status, resolvedAt: d.resolvedAt || null
  };
}

// ── REPLACE your loadRefillCache() with this one ────────────────
async function loadRefillCache() {
  if (!db) return;
  try {
    const docs = await db.collection('refills').find({}).sort({ time: -1 }).limit(500).toArray();
    refillCache = docs.map(mapRefill);
    console.log(`[Refill] Loaded ${refillCache.length} confirmed records`);
  } catch (e) { console.error('[Refill] loadRefillCache error:', e.message); }
}

// ── Startup: indexes + legacy migration ─────────────────────────
// In connectMongo(), REPLACE the line  loadRefillCache();  with:
//     setupRefillCollections().then(loadRefillCache); loadRefillDetectorState();
async function setupRefillCollections() {
  try {
    const cands = db.collection('refill_candidates');
    const refs  = db.collection('refills');
    await cands.createIndex({ status: 1, detectedAt: -1 });
    await cands.createIndex({ fingerprint: 1 }, { unique: true });
    await refs.createIndex({ time: 1 });
    // exactly-once guarantee: one confirmed refill per candidate
    await refs.createIndex({ candidateId: 1 },
      { unique: true, partialFilterExpression: { candidateId: { $type: 'string' } } });
    // Old auto-saved refills (before manual confirmation existed): keep, flag as legacy
    const r = await refs.updateMany({ status: { $exists: false } },
      { $set: { status: 'confirmed', legacy: true, confirmedAt: null, confirmedBy: 'legacy-auto' } });
    if (r.modifiedCount) console.log(`[Refill] Migrated ${r.modifiedCount} legacy refills (kept as confirmed)`);
  } catch (e) { console.error('[Refill] setup error:', e.message); }
}

// ── Detection state machine (automatic; NEVER confirms) ─────────
let refillDetect = { baseL: null, rising: false, peakL: null, lastPeakMs: 0 };
let _detectSaveMs = 0;

async function loadRefillDetectorState() {
  if (!db) return;
  try {
    const d = await db.collection('runtime').findOne({ _id: 'refillDetector' });
    // A refill that happened while the server was down still shows up as a rise vs. this base
    if (d && d.baseL > 0 && Date.now() - d.savedAt < 6 * 3600e3 && !refillDetect.rising) {
      refillDetect.baseL = d.baseL;
    }
  } catch (e) { console.error('[Refill] detector load error:', e.message); }
}
function saveRefillDetectorState() {
  if (!db || refillDetect.baseL == null) return;
  _detectSaveMs = Date.now();
  db.collection('runtime').updateOne({ _id: 'refillDetector' },
    { $set: { baseL: refillDetect.baseL, savedAt: Date.now() } }, { upsert: true })
    .catch(e => console.error('[Refill] detector save error:', e.message));
}

// Call on every reading (from appendHistory)
function runRefillDetection(fuelL) {
  if (!(fuelL > 0)) return;                          // missing/zero reading → ignore
  const d = refillDetect, now = Date.now();
const noise = rs('refillNoiseBandL'), minRise = REFILL_MIN_RISE_L, settleMs = rs('refillSettleSec') * 1000;
  if (d.baseL === null) { d.baseL = fuelL; saveRefillDetectorState(); return; }

  if (!d.rising) {
    if (fuelL >= d.baseL + noise) { d.rising = true; d.peakL = fuelL; d.lastPeakMs = now; }
    else if (fuelL < d.baseL)     { d.baseL = fuelL; }          // follow consumption downward
    if (now - _detectSaveMs > 60000) saveRefillDetectorState();
    return;
  }

  // rising: wait for the level to stop climbing (a refill takes minutes)
  if (fuelL > d.peakL) { d.peakL = fuelL; d.lastPeakMs = now; }
  if (now - d.lastPeakMs < settleMs) return;

  const settledRise = fuelL - d.baseL;               // measured on the SETTLED level, so a spike that fell back is ignored
  if (settledRise >= minRise) createRefillCandidate(d.baseL, fuelL);
  d.baseL = fuelL; d.rising = false; d.peakL = null;
  saveRefillDetectorState();
}

async function createRefillCandidate(beforeL, afterL) {
  if (!db) { console.warn('[Refill] DB down — candidate not stored'); return; }
  const at = new Date();
  const doc = {
    fingerprint: `${Math.round(beforeL)}:${Math.round(afterL)}:${Math.floor(at.getTime() / 600000)}`, // blocks duplicates (e.g. restart mid-refill)
    detectedAt: at.toISOString(), date: todayKey(),
    beforeL: Math.round(beforeL), afterL: Math.round(afterL),
    increaseL: Math.round(afterL - beforeL),
    beforePct: pctOf(beforeL), afterPct: pctOf(afterL),
    dgStatus: (latestReading && latestReading.stateLabel) || null,
    status: 'pending'
  };
  try {
    const r = await db.collection('refill_candidates').insertOne(doc);
    doc._id = r.insertedId;
    console.log(`[Refill] Candidate +${doc.increaseL}L (${doc.beforeL}→${doc.afterL}) awaiting confirmation`);
    io.emit('refill:candidate', mapCandidate(doc));
  } catch (e) {
    if (e.code !== 11000) console.error('[Refill] candidate insert error:', e.message);
  }
}

// ── Candidates API ──────────────────────────────────────────────
function parseIso(v) { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }

app.get('/api/refill-candidates', async (req, res) => {
  if (!db) return res.json([]);
  const q = {};
  if (req.query.status) q.status = String(req.query.status);
  const from = req.query.from && parseIso(req.query.from), to = req.query.to && parseIso(req.query.to);
  if ((req.query.from && !from) || (req.query.to && !to)) return res.status(400).json({ error: 'Invalid date' });
  if (from || to) { q.detectedAt = {}; if (from) q.detectedAt.$gte = from; if (to) q.detectedAt.$lte = to; }
  try {
    const docs = await db.collection('refill_candidates').find(q).sort({ detectedAt: -1 }).limit(500).toArray();
    res.json(docs.map(mapCandidate));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/refill-candidates/:id/confirm', async (req, res) => {
  if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const _id = new ObjectId(id);
  const person = String((req.body && req.body.person) || '').trim().slice(0, 60) || 'Unknown';
  const cands = db.collection('refill_candidates');

  // atomic claim: only ONE request can move pending → confirming
  const c = await cands.findOneAndUpdate({ _id, status: 'pending' },
    { $set: { status: 'confirming', resolvedAt: new Date().toISOString() } }, { returnDocument: 'after' });
  if (!c) {
    const cur = await cands.findOne({ _id });
    return res.status(cur ? 409 : 404).json({ ok: false, error: cur ? `Already ${cur.status}` : 'Not found', status: cur && cur.status });
  }
  const rec = {
    time: c.detectedAt, beforeL: c.beforeL, afterL: c.afterL, addedL: c.increaseL,
    beforePct: c.beforePct, afterPct: c.afterPct, person, auto: false,
    status: 'confirmed', legacy: false, confirmedAt: new Date().toISOString(),
    candidateId: id, dgStatus: c.dgStatus
  };
  try {
    const r = await db.collection('refills').insertOne({ ...rec });
    rec._id = r.insertedId;
    await cands.updateOne({ _id }, { $set: { status: 'confirmed', refillId: String(r.insertedId) } });
        const mapped = mapRefill(rec);
    refillCache.unshift(mapped);
    onRefillConfirmed(mapped);                         // ← NEW LINE
    io.emit('refill:resolved', { id, status: 'confirmed', record: mapped });
    io.emit('genset:update', buildBroadcast());
    res.json({ ok: true, record: mapped });
  } catch (e) {
    if (e.code === 11000) {                            // refill already exists for this candidate
      await cands.updateOne({ _id }, { $set: { status: 'confirmed' } });
      return res.status(409).json({ ok: false, error: 'Already confirmed' });
    }
    await cands.updateOne({ _id, status: 'confirming' }, { $set: { status: 'pending' } });
    console.error('[Refill] confirm error:', e.message);
    res.status(500).json({ ok: false, error: 'Could not save refill' });
  }
});

const _noRefillFails = {};   // ip → { n, resetAt }
app.post('/api/refill-candidates/:id/reject', async (req, res) => {
  if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  if (!process.env.NOREFILL_PASSWORD)
    return res.status(503).json({ ok: false, error: 'No-Refill password is not configured on the server' });

  const ip = req.ip, now = Date.now();
  const b = _noRefillFails[ip] = (_noRefillFails[ip] && _noRefillFails[ip].resetAt > now) ? _noRefillFails[ip] : { n: 0, resetAt: now + 300000 };
  if (b.n >= 5) return res.status(429).json({ ok: false, error: 'Too many wrong attempts. Try again in a few minutes.' });

  if (!safeEq(req.body && req.body.password, process.env.NOREFILL_PASSWORD)) {
    b.n++;
    return res.status(401).json({ ok: false, error: 'Incorrect password' });
  }
  const _id = new ObjectId(id);
  const c = await db.collection('refill_candidates').findOneAndUpdate({ _id, status: 'pending' },
    { $set: { status: 'rejected', resolvedAt: new Date().toISOString() } }, { returnDocument: 'after' });
  if (!c) {
    const cur = await db.collection('refill_candidates').findOne({ _id });
    return res.status(cur ? 409 : 404).json({ ok: false, error: cur ? `Already ${cur.status}` : 'Not found', status: cur && cur.status });
  }
  // No refill record, no baseline change.
  io.emit('refill:resolved', { id, status: 'rejected' });
  res.json({ ok: true });
});

// ── Confirmed refills: list (with date/time filter) + manual entry ──
app.get('/api/refills', async (req, res) => {
  const from = req.query.from && parseIso(req.query.from), to = req.query.to && parseIso(req.query.to);
  if ((req.query.from && !from) || (req.query.to && !to)) return res.status(400).json({ error: 'Invalid date' });
  if (from && to && from > to) return res.status(400).json({ error: 'from must be <= to' });
  const inRange = r => (!from || r.time >= from) && (!to || r.time <= to);
  if (!db) return res.json(refillCache.filter(inRange));
  const q = {};
  if (from || to) { q.time = {}; if (from) q.time.$gte = from; if (to) q.time.$lte = to; }
  try {
    const docs = await db.collection('refills').find(q).sort({ time: -1 }).limit(from || to ? 2000 : 200).toArray();
    res.json(docs.map(mapRefill));
  } catch (e) { console.error('[Refill] GET error:', e.message); res.json(refillCache.filter(inRange)); }
});

app.post('/api/refills', async (req, res) => {   // manual entry = user-initiated confirmation
  const beforeL = Math.round(Number(req.body.beforeL)), afterL = Math.round(Number(req.body.afterL));
  if (!(beforeL >= 0) || !(afterL > beforeL) || afterL > tankL() * 1.05)
    return res.status(400).json({ error: 'Invalid levels: after must be greater than before and within tank capacity' });
  const t = req.body.time ? parseIso(req.body.time) : new Date().toISOString();
  if (!t) return res.status(400).json({ error: 'Invalid time' });

  if (afterL - beforeL < REFILL_MIN_RISE_L)
    return res.status(400).json({ error: `A refill must be at least ${REFILL_MIN_RISE_L} L` });
  
  const rec = {
    time: t, beforeL, afterL, addedL: afterL - beforeL,
    beforePct: pctOf(beforeL), afterPct: pctOf(afterL),
    person: String(req.body.person || 'Manual entry').slice(0, 60), auto: false,
    status: 'confirmed', legacy: false, manual: true, confirmedAt: new Date().toISOString(),
    dgStatus: (latestReading && latestReading.stateLabel) || null
  };
  if (!db) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const r = await db.collection('refills').insertOne({ ...rec });
    rec._id = r.insertedId;
        const mapped = mapRefill(rec);
    refillCache.unshift(mapped);
    onRefillConfirmed(mapped);                         // ← NEW LINE
    io.emit('refill:resolved', { id: mapped.id, status: 'confirmed', record: mapped });
    io.emit('genset:update', buildBroadcast());
    res.json({ ok: true, record: mapped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Refill settings (password = SETTINGS_PASSWORD, sent in a header) ──
app.get('/api/refill-settings', (req, res) => res.json(getRefillSettings()));
app.post('/api/refill-settings', async (req, res) => {
  if (!process.env.SETTINGS_PASSWORD) return res.status(503).json({ ok: false, error: 'SETTINGS_PASSWORD not configured' });
  if (!safeEq(req.get('x-settings-password'), process.env.SETTINGS_PASSWORD))
    return res.status(401).json({ ok: false, error: 'Incorrect settings password' });

  const b = req.body || {}, out = {};
  for (const k of Object.keys(REFILL_DEFAULTS)) {
    const v = b[k] === undefined ? rs(k) : Number(b[k]);
    if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ ok: false, error: `${k} must be a positive number` });
    out[k] = v;
  }
  if (out.refillPredictLowL >= out.refillPredictHighL) return res.status(400).json({ ok: false, error: 'Lower prediction threshold must be less than the upper one' });
  if (out.refillNoiseBandL >= out.refillMinRiseL)      return res.status(400).json({ ok: false, error: 'Noise band must be smaller than the minimum rise' });
  if (out.refillSettleSec < 20 || out.refillSettleSec > 900) return res.status(400).json({ ok: false, error: 'Settle time must be 20–900 seconds' });
  if (out.tankCapacityL < 100 || out.tankCapacityL > 5000)   return res.status(400).json({ ok: false, error: 'Tank capacity must be 100–5000 L' });

  gensetSettings = { ...gensetSettings, ...out };
  try {
    if (db) await db.collection('settings').updateOne({ _id: 'config' }, { $set: out }, { upsert: true });
    res.json({ ok: true, settings: getRefillSettings() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Fuel consumption: refill-aware ──────────────────────────────
function currentFuelL() {
  const f = (latestReading && latestReading.fuel) || {};
  const l = parseFloat(f.litres);
  if (l > 0) return Math.round(l);
  const p = parseFloat(f.pct) || 0;
  return p > 0 ? Math.round(p * tankL() / 100) : null;
}

// ── Fuel consumption now comes from dg-engine.js ──
function computeFuelConsumption() { return dgEngine.consumption(); }

// Called by the two refill routes (confirm + manual)
function onRefillConfirmed(r) {
  dgEngine.onRefillConfirmed(r)
    .catch(e => console.error('[DG] refill credit failed:', e.message));
}

app.get('/api/fuel/consumption', (req, res) => res.json(computeFuelConsumption()));


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
const HISTORY_RPM_THRESHOLD = 100;       // engine considered "running" above this
const IDLE_HEARTBEAT_MS     = 5 * 60000; // 1 snapshot every 5 min while idle — keeps charts continuous, cheap on storage
let _lastIdleHistorySaveMs  = 0;

let refillTracker = {
  prevFuelL:    null,   // last known fuel litres
  prevFuelPct:  null,   // last known fuel %
};


// ── Fuel consumption/noise classifier state ───────────────
let fuelClassifyTracker = { prevFuelL: null };

const RUN_VOLT_THRESHOLD = 20;   // volts — filters sensor floor
const RUN_CURR_THRESHOLD = 2;    // amps
const RUN_RPM_THRESHOLD  = 100;  // rpm


function trackEngineRunEvents(row, dk, ts, lifetimeHours) {
  const running = isEngineRunning(row);

  if (engineRunTracker.isRunning === null) {
    engineRunTracker.isRunning = running;
    if (running) engineRunTracker.lastStartTs = Date.now();
    return;
  }

  if (running && !engineRunTracker.isRunning) {
    // Engine just started
    engineRunTracker.lastStartTs = Date.now();
    const doc = { date: dk, type: 'start', time: ts, timestamp: new Date().toISOString(), lifetimeHours };
    if (db) db.collection('engine_events').insertOne(doc)
      .catch(e => console.error('[EngineEvents] insert error:', e.message));
    console.log(`[EngineEvents] ▶ Started at ${ts}`);
  } else if (!running && engineRunTracker.isRunning) {
    // Engine just stopped
    const durationSec = engineRunTracker.lastStartTs
      ? Math.round((Date.now() - engineRunTracker.lastStartTs) / 1000)
      : null;
    const doc = { date: dk, type: 'stop', time: ts, timestamp: new Date().toISOString(), durationSec, lifetimeHours };
    if (db) db.collection('engine_events').insertOne(doc)
      .catch(e => console.error('[EngineEvents] insert error:', e.message));
    console.log(`[EngineEvents] ⏹ Stopped at ${ts}${durationSec ? ` (ran ${(durationSec/3600).toFixed(2)}h)` : ''}`);
    engineRunTracker.lastStartTs = null;
  }

  engineRunTracker.isRunning = running;
}


function isEngineRunning(row) {
  const vMax = Math.max(row.voltL1N, row.voltL2N, row.voltL3N);
  const cMax = Math.max(row.currL1, row.currL2, row.currL3);
  return vMax > RUN_VOLT_THRESHOLD || cMax > RUN_CURR_THRESHOLD || row.engineRPM > RUN_RPM_THRESHOLD;
}

// Called from appendHistory() on every reading, AFTER detectRefill()
// so a real refill jump never gets double-classified as "noise recovery".
function classifyFuelEvent(row, dk, ts) {
const fuelL = row.fuelLevelL > 0 ? row.fuelLevelL : Math.round(row.fuelLevelPct * tankL() / 100);

  if (fuelClassifyTracker.prevFuelL === null) {
    fuelClassifyTracker.prevFuelL = fuelL;
    return;
  }

  const prevL = fuelClassifyTracker.prevFuelL;
  const delta = prevL - fuelL;           // positive = level dropped
  fuelClassifyTracker.prevFuelL = fuelL;

  if (delta === 0) return;
  if (Math.abs(delta) >= REFILL_THRESHOLD_L) return; // real refills are handled by detectRefill()

  const running = isEngineRunning(row);
  let category;
  if (delta > 0) {
    category = running ? 'actual_consumption' : 'sensor_noise';
  } else {
    // level went UP by a small amount while not refilling — this is the
    // "noise recovers" case from business rule 3 (e.g. sloshing settling back)
    category = running ? 'actual_consumption_correction' : 'sensor_noise_recovery';
  }

  const doc = {
    date: dk,
    time: ts,
    timestamp: new Date().toISOString(),
    fuelBeforeL: prevL,
    fuelAfterL:  fuelL,
    deltaL:      delta,           // +ve = drop, -ve = recovered
    category,
    running,
    voltMax:    Math.max(row.voltL1N, row.voltL2N, row.voltL3N),
    currMax:    Math.max(row.currL1, row.currL2, row.currL3),
    engineRPM:  row.engineRPM,
    kwTotal:    row.kwTotal
  };

  if (db) {
    db.collection('fuel_events').insertOne(doc)
      .catch(e => console.error('[FuelClassify] insert error:', e.message));
  } else {
    fuelEventCache.unshift(doc);
    if (fuelEventCache.length > 2000) fuelEventCache.pop();
  }
}

let fuelEventCache = []; // in-memory fallback when db is down

// ── Server-side "today" trackers — run 24/7, independent of browser ──
let engineHoursToday = { dateKey: null, seconds: 0, lastTs: null };
let fuelSession      = { dateKey: null, startL: null, startPct: null };
let _runtimeLastSaveMs = 0;

async function loadRuntimeState() {
  if (!db) return;
  try {
    const doc = await db.collection('runtime').findOne({ _id: 'today' });
    const dk = todayKey();
    if (doc && doc.dateKey === dk) {
      engineHoursToday = { dateKey: doc.dateKey, seconds: doc.engineSeconds || 0, lastTs: null };
      fuelSession      = { dateKey: doc.dateKey, startL: doc.fuelStartL, startPct: doc.fuelStartPct };
      console.log(`[Runtime] Restored today's state: ${(engineHoursToday.seconds/3600).toFixed(2)}h, fuel start ${fuelSession.startL}L`);
    } else {
      // No saved baseline for today: use the first fuel reading stored today
      const first = await db.collection('history')
        .find({ date: dk, fuelLevelL: { $gt: 0 } })
        .sort({ timestamps: 1 }).limit(1).toArray();
      if (first.length) {
        fuelSession = { dateKey: dk, startL: first[0].fuelLevelL, startPct: first[0].fuelLevelPct };
      }
    }
  } catch (e) {
    console.error('[Runtime] load error:', e.message);
  } finally {
    runtimeStateLoaded = true;
  }
}

let engineHoursBaselineLoaded = false;

async function loadEngineHoursBaseline() {
  if (!db) return;
  const dk = todayKey();
  try {
    const doc = await db.collection('runtime').findOne({ _id: 'engineHoursBaseline' });
    if (doc && doc.dateKey === dk && doc.baselineHours != null) {
      engineHoursBaseline = { dateKey: dk, baselineHours: doc.baselineHours };
      console.log(`[EngineHours] Restored baseline: ${doc.baselineHours}h for ${dk}`);
    } else {
      // No saved baseline: the counter at today's first engine start is the day-start value
      const first = await db.collection('engine_events')
        .find({ date: dk, type: 'start', lifetimeHours: { $gt: 0 } })
        .sort({ timestamp: 1 }).limit(1).toArray();
      if (first.length) {
        engineHoursBaseline = { dateKey: dk, baselineHours: first[0].lifetimeHours };
        await db.collection('runtime').updateOne({ _id: 'engineHoursBaseline' },
          { $set: { dateKey: dk, baselineHours: first[0].lifetimeHours } }, { upsert: true });
        console.log(`[EngineHours] Rebuilt baseline from first start: ${first[0].lifetimeHours}h`);
      }
    }
  } catch (e) {
    console.error('[EngineHours] load error:', e.message);
  } finally {
    engineHoursBaselineLoaded = true;
  }
}

async function saveRuntimeState() {
  if (!db) return;
  try {
    await db.collection('runtime').updateOne(
      { _id: 'today' },
      { $set: {
          dateKey: engineHoursToday.dateKey,
          engineSeconds: engineHoursToday.seconds,
          fuelStartL: fuelSession.startL,
          fuelStartPct: fuelSession.startPct
        } },
      { upsert: true }
    );
  } catch (e) { console.error('[Runtime] save error:', e.message); }
}

function updateEngineHoursBaseline(lifetimeHours) {
  if (db && !engineHoursBaselineLoaded) return engineHoursTodayComputed; // wait for the saved baseline
  const dk = todayKey();
  if (engineHoursBaseline.dateKey !== dk || engineHoursBaseline.baselineHours == null) {
    engineHoursBaseline = { dateKey: dk, baselineHours: lifetimeHours };
    if (db) {
      db.collection('runtime').updateOne({ _id: 'engineHoursBaseline' },
        { $set: { dateKey: dk, baselineHours: lifetimeHours } }, { upsert: true })
        .catch(e => console.error('[EngineHours] save baseline error:', e.message));
    }
    console.log(`[EngineHours] New day baseline set: ${lifetimeHours}h`);
  }
  return Math.max(0, +(lifetimeHours - engineHoursBaseline.baselineHours).toFixed(3));
}

let engineHoursTodayComputed = 0; // updated every reading, read by buildBroadcast/api

function updateEngineHoursTodayServer(isRunning) {
  const nowKey = todayKey();
  if (engineHoursToday.dateKey !== nowKey) {
    engineHoursToday = { dateKey: nowKey, seconds: 0, lastTs: null };
  }
  const now = Date.now();
  if (engineHoursToday.lastTs !== null) {
    const deltaSec = (now - engineHoursToday.lastTs) / 1000;
    if (isRunning && deltaSec > 0 && deltaSec < 120) {
      engineHoursToday.seconds += deltaSec;
    }
  }
  engineHoursToday.lastTs = now;
  return engineHoursToday.seconds / 3600;
}

let runtimeStateLoaded = false;

function updateFuelSessionServer(fuelL, fuelPct) {
  if ((db && !runtimeStateLoaded) || !(fuelL > 0)) return;
  const nowKey = todayKey();
  if (fuelSession.dateKey !== nowKey || fuelSession.startL == null) {
    fuelSession = { dateKey: nowKey, startL: fuelL, startPct: fuelPct };
    saveRuntimeState();
  }
}

// In-memory cache of recent refills (also persisted to MongoDB)
let refillCache = [];   // [{_id, time, beforeL, afterL, addedL, beforePct, afterPct, person, auto}]


// ── DG engine: runtime detection + fuel consumption (single source of truth) ──
const dgEngine = createDgEngine({
  getDb:      () => db,
  tankL:      () => tankL(),
  getRefills: () => refillCache,
  getStartL:  () => (fuelSession.dateKey === todayKey() && fuelSession.startL != null)
                      ? Math.round(fuelSession.startL) : null,
  log: console
});
dgEngine.registerRoutes(app);   // adds /api/dg/hourly, /api/dg/daily, /api/dg/status


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

// GET — fast fuel session baseline (start-of-day litres/pct)
app.get('/api/fuel/session-start', async (req, res) => {
  const dk = req.query.date || todayKey();
  if (!db) {
    return res.json({
      date: dk,
      litres: fuelSession.dateKey === dk ? fuelSession.startL   : null,
      pct:    fuelSession.dateKey === dk ? fuelSession.startPct : null
    });
  }
  try {
    const doc = await db.collection('history')
      .find({ date: dk, fuelLevelL: { $gt: 0 } },
             { projection: { _id: 0, fuelLevelL: 1, fuelLevelPct: 1, timestamps: 1 } })
      .sort({ timestamps: 1 })
      .limit(1)
      .toArray();
    if (!doc.length) return res.json({ date: dk, litres: null, pct: null });
    res.json({ date: dk, litres: doc[0].fuelLevelL, pct: doc[0].fuelLevelPct });
  } catch (e) {
    console.error('[FuelSession] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// GET — granular audit trail (Detail page)
app.get('/api/fuel/events', async (req, res) => {
  const { date, from, to, category } = req.query;
  if (!db) return res.json({ count: 0, events: [] });

  let query = {};
  if (date) query.date = date;
  else if (from && to) query.date = { $gte: from, $lte: to };
  else query.date = todayKey();
  if (category) query.category = category;

  try {
    const events = await db.collection('fuel_events')
      .find(query).sort({ timestamp: 1 }).limit(5000).toArray();
    res.json({ count: events.length, events });
  } catch (e) {
    console.error('[FuelEvents] error:', e.message);
    res.status(500).json({ error: e.message });
  }
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

// server.js
function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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

// ════════════════════════════════════════════════════════════════
//  DEVICE OFFLINE / BACK-ONLINE EMAIL ALERT
// ════════════════════════════════════════════════════════════════
const DEVICE_OFFLINE_AFTER_MS = 3 * 60 * 1000;   // no data for 3 min → offline
const DEVICE_CHECK_EVERY_MS   = 30 * 1000;       // watchdog interval

let deviceWatch = { lastSeenMs: null, offlineAlerted: false, offlineSinceMs: null };
const _watchStartMs = Date.now();
let _mqttDownMs = 0;

const fmtIST = ms => new Date(ms).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
});
function fmtDur(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function saveDeviceWatch() {
  if (!db) return;
  db.collection('runtime').updateOne({ _id: 'deviceStatus' },
    { $set: { offlineAlerted: deviceWatch.offlineAlerted, offlineSinceMs: deviceWatch.offlineSinceMs, lastSeenMs: deviceWatch.lastSeenMs } },
    { upsert: true }).catch(e => console.error('[DeviceWatch] save error:', e.message));
}

async function loadDeviceStatus() {
  if (!db) return;
  try {
    const d = await db.collection('runtime').findOne({ _id: 'deviceStatus' });
    if (d) {
      deviceWatch.offlineAlerted = !!d.offlineAlerted;
      deviceWatch.offlineSinceMs = d.offlineSinceMs || null;
      deviceWatch.lastSeenMs     = d.lastSeenMs || null;
      if (deviceWatch.offlineAlerted) console.log('[DeviceWatch] Restored: device was already marked offline');
    }
  } catch (e) { console.error('[DeviceWatch] load error:', e.message); }
}

function sendDeviceEmail(kind, durationMs) {
  const to = gensetSettings.alertEmails;
  if (!to) { console.warn('[DeviceWatch] No alert recipients configured — email skipped'); return; }

  const off   = kind === 'offline';
  const color = off ? '#DC2626' : '#059669';
  const subject = off ? '🔴 DG monitor OFFLINE — no data received' : '🟢 DG monitor is back ONLINE';
  const lastSeen = deviceWatch.lastSeenMs ? fmtIST(deviceWatch.lastSeenMs) : 'Not seen since server started';

  const rows = off
    ? `<tr><td style="padding:6px 0;color:#6B7280">Last data received</td><td style="padding:6px 0;font-weight:700">${lastSeen}</td></tr>
       <tr><td style="padding:6px 0;color:#6B7280">Offline for</td><td style="padding:6px 0;font-weight:700">${fmtDur(durationMs)}</td></tr>
       <tr><td style="padding:6px 0;color:#6B7280">Alert time</td><td style="padding:6px 0;font-weight:700">${fmtIST(Date.now())}</td></tr>`
    : `<tr><td style="padding:6px 0;color:#6B7280">Back online at</td><td style="padding:6px 0;font-weight:700">${fmtIST(Date.now())}</td></tr>
       <tr><td style="padding:6px 0;color:#6B7280">Was offline for</td><td style="padding:6px 0;font-weight:700">${fmtDur(durationMs)}</td></tr>`;

  const tips = off
    ? `<p style="margin:14px 0 0;font-size:13px;color:#4A5568;line-height:1.6">Please check: ESP32 power, site Wi-Fi / internet, and the RS485 link to the controller. Readings are not being recorded until it reconnects.</p>`
    : `<p style="margin:14px 0 0;font-size:13px;color:#4A5568">Live readings have resumed.</p>`;

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E2E8F5;border-radius:12px;overflow:hidden">
      <div style="background:${color};color:#fff;padding:16px 20px;font-size:18px;font-weight:800">${subject}</div>
      <div style="padding:18px 20px">
        <div style="font-size:14px;color:#1A2340;font-weight:700">GenSight · Cummins 400 kVA · Bannerughatta</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">${rows}</table>
        ${tips}
      </div>
    </div>`;

  Promise.resolve(sendEmail({ to, subject, html }))
    .then(() => console.log(`[DeviceWatch] ${kind} email sent`))
    .catch(e => console.error('[DeviceWatch] email error:', e.message));
}

// Called on every reading (from appendHistory)
function markDeviceSeen() {
  const now = Date.now();
  deviceWatch.lastSeenMs = now;
  if (deviceWatch.offlineAlerted) {
    const downMs = now - (deviceWatch.offlineSinceMs || now);
    deviceWatch.offlineAlerted = false;
    deviceWatch.offlineSinceMs = null;
    saveDeviceWatch();
    sendDeviceEmail('online', downMs);
  }
}

setInterval(() => {
  const now = Date.now();
  if (!mqttClient.connected) { _mqttDownMs = now; return; }   // our own broker link is down — not the device's fault
  if (deviceWatch.offlineAlerted) return;                      // already told you

  const ref = Math.max(deviceWatch.lastSeenMs || 0, _watchStartMs, _mqttDownMs);
  if (now - ref < DEVICE_OFFLINE_AFTER_MS) return;

  deviceWatch.offlineAlerted = true;
  deviceWatch.offlineSinceMs = deviceWatch.lastSeenMs || _watchStartMs;
  saveDeviceWatch();
  console.warn('[DeviceWatch] Device OFFLINE — no data received');
  sendDeviceEmail('offline', now - deviceWatch.offlineSinceMs);
}, DEVICE_CHECK_EVERY_MS);


const liveHistory = {};
HISTORY_KEYS.forEach(k => { liveHistory[k] = []; });

function appendHistory(payload) {
  markDeviceSeen();
// in appendHistory():
const ts = new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });
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

  const _fuelL = row.fuelLevelL > 0
    ? row.fuelLevelL
    : Math.round(row.fuelLevelPct * tankL() / 100);
   runRefillDetection(_fuelL);
  updateFuelSessionServer(_fuelL, row.fuelLevelPct);
  classifyFuelEvent(row, dk, ts);

  // ── DG runtime + fuel consumption (electrical-signal based) ──
  dgEngine.onReading(payload, _fuelL);
  const lifetimeHours = parseFloat(eng.hours) || 0;
  updateEngineHoursBaseline(lifetimeHours);                  // lifetime meter baseline only
  engineHoursTodayComputed = dgEngine.todayRuntimeHours();   // today's runtime = engine value
  // (trackEngineRunEvents removed: the engine now logs start/stop events itself)

  // ── Threshold-based email alerts ───────────────────────────
  checkAlertThresholds(row, payload);

  // ── Only persist to 'history' when the DG is actually running ──
  // (RPM is the strictest, most reliable "running" signal — no false
  // positives from voltage/current sensor noise while idle)
  // ── Persist to 'history' ──
  // Running: store every reading (full resolution, same as before).
  // Idle: store a low-frequency heartbeat so daily/multi-day charts stay
  //       continuous (real batt/coolant/fuel values, not stored gaps).
  const isRunningForHistory = row.engineRPM > HISTORY_RPM_THRESHOLD;
  const nowMs = Date.now();
  const idleHeartbeatDue = !isRunningForHistory && (nowMs - _lastIdleHistorySaveMs >= IDLE_HEARTBEAT_MS);

  if (db && (isRunningForHistory || idleHeartbeatDue)) {
    if (!isRunningForHistory) _lastIdleHistorySaveMs = nowMs;
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
        status:        'ok',
        mqttConnected: mqttClient.connected,
        mongoConnected: !!db,
        uptime:        process.uptime().toFixed(0) + 's',
        clients:       io.engine.clientsCount,
        lastSeen:      latestReading && latestReading.serverTime || null,
        datesStored:   Object.keys(dateStore).sort(),
        nfpaActive:    latestReading && (latestReading.nfpa110Active || []).length || 0
    });
});

app.get('/api/derived', (req, res) => {
  res.json({
    lastTransferSec , 
    lastCrankSec , 
    transferLog: amfStateTracker.transferLog,
    crankLog: crankTracker.crankLog,
    gensetInfo,
    engineHoursToday: engineHoursToday.seconds / 3600,   // ← add
    fuelSessionStartL: fuelSession.startL,                 // ← add
    fuelSessionStartPct: fuelSession.startPct              // ← add
  });
});

app.get('/api/dates', (req, res) => {
    const dates = Object.keys(dateStore).sort();
    res.json({ dates, count: dates.length });
});

app.get('/api/dates', (req, res) => {
    const dates = Object.keys(dateStore).sort();
    res.json({ dates, count: dates.length });
});

app.get('/api/engine/events', async (req, res) => {
  const { date, from, to } = req.query;
  if (!db) return res.json({ events: [] });

  let query = {};
  if (date) query.date = date;
  else if (from && to) query.date = { $gte: from, $lte: to };
  else query.date = todayKey();

  try {
    const events = await db.collection('engine_events')
      .find(query).sort({ timestamp: 1 }).limit(2000).toArray();
    res.json({ count: events.length, events });
  } catch (e) {
    console.error('[EngineEvents] fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET — per-day DG start/stop cycle counts (for home-page chart)
app.get('/api/engine/cycles', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD' });
  if (!db) return res.json({ days: [] });

  try {
    const rows = await db.collection('engine_events').aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: { date: '$date', type: '$type' }, count: { $sum: 1 } } }
    ]).toArray();

    // Build a complete day list (fills in zero-days so the chart has no gaps)
    const dayMap = {};
    const cursor = new Date(from + 'T00:00:00');
    const endD   = new Date(to   + 'T00:00:00');
    while (cursor <= endD) {
      const dk = cursor.toISOString().slice(0, 10);
      dayMap[dk] = { date: dk, starts: 0, stops: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.forEach(r => {
      const dk = r._id.date;
      if (!dayMap[dk]) dayMap[dk] = { date: dk, starts: 0, stops: 0 };
      if (r._id.type === 'start') dayMap[dk].starts = r.count;
      if (r._id.type === 'stop')  dayMap[dk].stops  = r.count;
    });

    res.json({ days: Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (e) {
    console.error('[EngineCycles] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/daily-rollup', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD' });
  if (!db) return res.json({ days: [] });

  try {
    const days = await db.collection('history').aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $sort: { date: 1, timestamps: 1 } },
      { $group: {
          _id: '$date',
          count:        { $sum: 1 },
          fuelFirst:    { $first: '$fuelLevelL' },
          fuelLast:     { $last:  '$fuelLevelL' },
          runSamples:   { $sum: { $cond: [{ $gt: ['$engineRPM', 200] }, 1, 0] } },
          peakKw:       { $max: '$kwTotal' },
          avgKw:        { $avg: '$kwTotal' },
          peakKva:      { $max: '$kvaTotal' },
          avgPf:        { $avg: '$pf' },
          peakRpm:      { $max: '$engineRPM' },
          maxCoolantF:  { $max: '$coolantTempF' },
          minOilPsi:    { $min: { $cond: [{ $gt: ['$oilPressPsi', 0] }, '$oilPressPsi', null] } },
          maxOilPsi:    { $max: '$oilPressPsi' },
          avgBattV:     { $avg: '$battV' }
      }},
      { $sort: { _id: 1 } }
    ]).toArray();

    const result = days.map(d => ({
      date:        d._id,
      consumedL:   Math.round((d.fuelFirst || 0) - (d.fuelLast || 0)),   // raw, adjusted for refills below
      engHours:    +((d.runSamples * 2 / 3600).toFixed(2)),
      peakKw:      +(d.peakKw || 0).toFixed(1),
      avgKw:       +(d.avgKw  || 0).toFixed(1),
      peakKva:     +(d.peakKva || 0).toFixed(1),
      avgPf:       +(d.avgPf  || 0).toFixed(3),
      peakRpm:     Math.round(d.peakRpm || 0),
      maxCoolantF: +(d.maxCoolantF || 0).toFixed(1),
      minOilPsi:   +(d.minOilPsi || 0).toFixed(1),
      maxOilPsi:   +(d.maxOilPsi || 0).toFixed(1),
      avgBattV:    +(d.avgBattV || 0).toFixed(2)
    }));

    // Add back confirmed refills so a refill can't hide real consumption
    const refs = await db.collection('refills').find({ time: {
      $gte: new Date(from + 'T00:00:00+05:30').toISOString(),
      $lte: new Date(to   + 'T23:59:59.999+05:30').toISOString()
    } }).toArray();
    const addedBy = {};
    refs.forEach(r => { const k = dayKeyOf(r.time); addedBy[k] = (addedBy[k] || 0) + (r.addedL || 0); });
    result.forEach(d => {
      d.refilledL = addedBy[d.date] || 0;
      d.consumedL = Math.max(0, d.consumedL + d.refilledL);
    });

    res.json({ days: result });
  } catch (e) {
    console.error('[DailyRollup] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function runHoursForDate(dk) {
  if (!db) return null;
  const ev = await db.collection('engine_events').find({ date: dk, type: 'stop' }).toArray();
  return +(ev.reduce((s, e) => s + (e.durationSec || 0), 0) / 3600).toFixed(2);
}

// ── Whole-day Min / Avg / Max, counted ONLY while the DG is running ──
app.get('/api/today-stats', async (req, res) => {
  const dk   = req.query.date || todayKey();
  const keys = String(req.query.keys || '').split(',')
                 .filter(k => HISTORY_KEYS.includes(k) && k !== 'timestamps');
  if (!keys.length) return res.status(400).json({ error: 'Provide ?keys=voltL1N,voltL2N' });

  const runHours = dk === todayKey() ? +(engineHoursTodayComputed || 0).toFixed(2) : await runHoursForDate(dk);
  try {
    if (db) {
            const RUNNING = { $and: [ { $gt: ['$engineRPM', HISTORY_RPM_THRESHOLD] }, { $gt: ['$voltL1N', 20] } ] };
      const g = { _id: null, runSamples: { $sum: { $cond: [RUNNING, 1, 0] } } };
      keys.forEach(k => {
        const run = { $cond: [RUNNING, `$${k}`, null] };
        g[`${k}_min`] = { $min: run };
        g[`${k}_max`] = { $max: run };
        g[`${k}_avg`] = { $avg: run };
      });
      const r = await db.collection('history').aggregate([
        { $match: { date: dk } }, { $group: g }
      ]).toArray();
      const d = r[0] || {};
      const stats = {};
      keys.forEach(k => {
        stats[k] = {
          min: +(d[`${k}_min`] ?? 0).toFixed(3),
          max: +(d[`${k}_max`] ?? 0).toFixed(3),
          avg: +(d[`${k}_avg`] ?? 0).toFixed(3)
        };
      });
      return res.json({ date: dk, ran: (d.runSamples || 0) > 0, runHours, stats });
    }

    const rec = dateStore[dk];
    const stats = {};
    let ran = false;
    keys.forEach(k => {
      const v = [];
      if (rec) rec.engineRPM.forEach((rpm, i) => { if (rpm > HISTORY_RPM_THRESHOLD && rec.voltL1N[i] > 20) v.push(rec[k][i]); });
            if (v.length) ran = true;
      stats[k] = v.length
        ? { min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3),
            avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) }
        : { min: 0, max: 0, avg: 0 };
    });
    res.json({ date: dk, ran, runHours, stats });
  } catch (e) {
    console.error('[TodayStats] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Diesel + runtime summary for one day
app.get('/api/day-summary', async (req, res) => {
  const dk = req.query.date || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD' });
  if (!db) return res.json({ date: dk, available: false });

  try {
    const dayFrom = new Date(dk + 'T00:00:00+05:30').toISOString();
    const dayTo   = new Date(dk + 'T23:59:59.999+05:30').toISOString();
    const proj = { projection: { _id: 0, fuelLevelL: 1, timestamps: 1 } };

    const [first, last, runs, events, refs] = await Promise.all([
      db.collection('history').find({ date: dk, fuelLevelL: { $gt: 0 } }, proj).sort({ timestamps: 1 }).limit(1).toArray(),
      db.collection('history').find({ date: dk, fuelLevelL: { $gt: 0 } }, proj).sort({ timestamps: -1 }).limit(1).toArray(),
      db.collection('fuel_runs').find({ date: dk }).toArray(),
      db.collection('engine_events').find({ date: dk }).toArray(),
      db.collection('refills').find({ time: { $gte: dayFrom, $lte: dayTo } }).toArray()
    ]);

    if (!first.length) return res.json({ date: dk, available: false });

    const startL    = Math.round(first[0].fuelLevelL);
    const endL      = Math.round(last[0].fuelLevelL);
    const refilledL = refs.reduce((s, r) => s + (r.addedL || 0), 0);
    const balanceL  = Math.max(0, startL + refilledL - endL);
    const runL      = runs.reduce((s, r) => s + (r.consumedL || 0), 0);
        const tot = await dgEngine.dayTotals(dk);
    const consumedL = (tot.status === 'ok' || tot.status === 'partial')
      ? tot.consumedL : (runs.length ? runL : balanceL);

    let runSec = events.filter(e => e.type === 'stop').reduce((s, e) => s + (e.durationSec || 0), 0);
    if (!runSec) runSec = runs.reduce((s, r) => s + (r.durationSec || 0), 0);
    if (tot.runSec > 0) runSec = tot.runSec;
    const runHours = +(runSec / 3600).toFixed(2);

    res.json({
      date: dk, available: true, startL, endL, refilledL, consumedL,
      source: runs.length ? 'runs' : 'balance',
      runHours, starts: events.filter(e => e.type === 'start').length,
      burnLph: runHours > 0.05 && consumedL > 0 ? +(consumedL / runHours).toFixed(1) : null
    });
  } catch (e) {
    console.error('[DaySummary] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.get('/api/history', async (req, res) => {
  const { date, from, to, keys } = req.query;
  const wantedKeys = keys ? keys.split(',').filter(k => HISTORY_KEYS.includes(k)) : HISTORY_KEYS;

  function emptyResponse() {
    const result = { pointCount: 0, noData: true, availableDates: Object.keys(dateStore).sort() };
    wantedKeys.forEach(k => { result[k] = []; });
    return res.status(200).json(result);
  }

  const isRange = from && to && from !== to;

  if (db) {
    try {
      if (date || (from && to && !isRange)) {
  const q = date || from;
  const numericKeys = wantedKeys.filter(k => k !== 'timestamps');

  // Group by "HH:MM" (2-min buckets) — matches the frontend's own day-grid,
  // so we send ~720 averaged rows instead of ~43,200 raw ones.
  const groupStage = { _id: { $substrCP: ['$timestamps', 0, 5] }, count: { $sum: 1 } };
  numericKeys.forEach(k => { groupStage[k] = { $avg: `$${k}` }; });

  const buckets = await db.collection('history').aggregate([
    { $match: { date: q } },
    { $sort: { timestamps: 1 } },
    { $group: groupStage },
    { $sort: { _id: 1 } }
  ]).toArray();

  if (!buckets.length) return emptyResponse();

  const result = { pointCount: buckets.length, rawPointCount: buckets.reduce((s,b)=>s+b.count,0) };
  result.timestamps = buckets.map(b => b._id + ':00');
  numericKeys.forEach(k => { result[k] = buckets.map(b => +(b[k] ?? 0).toFixed(3)); });
  return res.json(result);
}

      if (from && to) {
        if (from > to) return res.status(400).json({ error: 'from must be <= to' });

        // Multi-day range → aggregate min/max/avg PER DAY on the DB side
        const numericKeys = wantedKeys.filter(k => k !== 'timestamps');
        const groupStage = { _id: '$date', count: { $sum: 1 } };
        numericKeys.forEach(k => {
          groupStage[`${k}_min`]  = { $min: `$${k}` };
          groupStage[`${k}_max`]  = { $max: `$${k}` };
          groupStage[`${k}_avg`]  = { $avg: `$${k}` };
          groupStage[`${k}_last`] = { $last: `$${k}` };
        });

        const days = await db.collection('history').aggregate([
          { $match: { date: { $gte: from, $lte: to } } },
          { $sort: { date: 1, timestamps: 1 } },
          { $group: groupStage },
          { $sort: { _id: 1 } }
        ]).toArray();

        if (!days.length) return emptyResponse();

        const dates = days.map(d => d._id);
        const totalPoints = days.reduce((s, d) => s + d.count, 0);
        const daily = {}, overall = {};

        numericKeys.forEach(k => {
          daily[k] = {
            min:  days.map(d => +(d[`${k}_min`]  ?? 0).toFixed(3)),
            max:  days.map(d => +(d[`${k}_max`]  ?? 0).toFixed(3)),
            avg:  days.map(d => +(d[`${k}_avg`]  ?? 0).toFixed(3)),
            last: days.map(d => +(d[`${k}_last`] ?? 0).toFixed(3))
          };
          const mins = days.map(d => d[`${k}_min`]).filter(v => typeof v === 'number');
          const maxs = days.map(d => d[`${k}_max`]).filter(v => typeof v === 'number');
          const weighted = days.filter(d => typeof d[`${k}_avg`] === 'number');
          overall[k] = {
            min: mins.length ? +Math.min(...mins).toFixed(3) : 0,
            max: maxs.length ? +Math.max(...maxs).toFixed(3) : 0,
            avg: weighted.length
              ? +(weighted.reduce((s,d) => s + d[`${k}_avg`]*d.count, 0) / weighted.reduce((s,d) => s + d.count, 0)).toFixed(3)
              : 0,
            last: daily[k].last[daily[k].last.length - 1] ?? 0
          };
        });

        return res.json({ isRange: true, pointCount: totalPoints, dates, daily, overall });
      }

      return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?from=...&to=...' });
    } catch (e) {
      console.error('[MongoDB] /api/history error:', e.message);
    }
  }

  // in-memory fallback unchanged...
  let record;
  if (date) { record = dateStore[date]; if (!record) return emptyResponse(); }
  else if (from && to) {
    if (from > to) return res.status(400).json({ error: 'from must be <= to' });
    record = mergeDateRange(from, to);
    if (record.timestamps.length === 0) return emptyResponse();
  } else return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?from=...&to=...' });

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
      gensetInfo,
      engineHoursToday: engineHoursTodayComputed,
      fuelConsumption:  computeFuelConsumption()
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