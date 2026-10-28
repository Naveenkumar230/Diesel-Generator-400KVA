'use strict';
/* ════════════════════════════════════════════════════════════════════
   dg-engine.js — DG runtime detection + fuel consumption (one engine)
   ----------------------------------------------------------------------
   • Run state comes ONLY from the electrical signals (voltage + freq/load),
     with hysteresis + confirm (debounce) windows.  Same state drives runtime,
     fuel consumption, start/stop events and the cycle counter.
   • A run is cut into IST-hour segments (so midnight splits itself).
     Fuel per segment = stable level (3-min median) at start − at end
     (+ CONFIRMED refills).  Noise, spikes, rises and impossible drops are
     flagged "unavailable" – never turned into fake litres.
   • Persisted in the existing `fuel_runs` collection (status active → final).
   ==================================================================== */

const IST_MS = 330 * 60000, HOUR_MS = 3600000, DAY_MS = 86400000;
const envNum = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

const DEFAULTS = {
  // ── electrical run detection (override with env vars, see /api/dg/status) ──
  voltOnV:       envNum('DG_VOLT_ON_V', 180),     // avg L-N volts to call output "present"
  voltOffV:      envNum('DG_VOLT_OFF_V', 100),    // avg L-N volts below which DG is "stopped" (hysteresis gap)
  freqOnHz:      envNum('DG_FREQ_ON_HZ', 40),     // corroboration #1
  currOnA:       envNum('DG_CURR_ON_A', 2),       // corroboration #2 (any phase)
  kwOn:          envNum('DG_KW_ON', 1),           // corroboration #3
  confirmOnSec:  envNum('DG_CONFIRM_ON_SEC', 10), // output must hold this long to start the timer
  confirmOffSec: envNum('DG_CONFIRM_OFF_SEC', 20),// output must be gone this long to stop it
  shortGapSec:   envNum('DG_SHORT_GAP_SEC', 30),  // readings further apart than this are "a gap"
  resumeSec:     envNum('DG_RESUME_SEC', 600),    // a run survives a data/server gap up to this long
  // ── fuel filtering ──
  smoothSec:     envNum('FUEL_SMOOTH_SEC', 180),  // stable level = median of last N sec
  anchorSec:     envNum('FUEL_ANCHOR_SEC', 120),  // run start level = median of N sec before start
  settleSec:     envNum('FUEL_SETTLE_SEC', 120),  // wait after stop before measuring end level
  endWindowSec:  envNum('FUEL_END_WINDOW_SEC', 90),
  minSamples:    envNum('FUEL_MIN_SAMPLES', 5),
  deadbandL:     envNum('FUEL_DEADBAND_L', 5),    // ≈ sensor noise / resolution (tune to your sensor)
  maxBurnLph:    envNum('FUEL_MAX_BURN_LPH', 100),// physical ceiling (OEM table tops at ~87 L/h)
  idleLossL:     envNum('FUEL_IDLE_LOSS_L', 20)   // level fell this much while DG was OFF ⇒ log it
};

const istDate     = ms => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istHour     = ms => new Date(ms + IST_MS).getUTCHours();
const istHms      = ms => new Date(ms + IST_MS).toISOString().slice(11, 19);
const dayStartMs  = key => Date.parse(key + 'T00:00:00Z') - IST_MS;
const hourStartMs = ms => Math.floor((ms + IST_MS) / HOUR_MS) * HOUR_MS - IST_MS;
const nextBoundary = ms => hourStartMs(ms) + HOUR_MS;
const iso = ms => new Date(ms).toISOString();
const r1  = x => Math.round(x * 10) / 10;
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const validDay = k => /^\d{4}-\d{2}-\d{2}$/.test(k || '') && !isNaN(Date.parse(k + 'T00:00:00Z'));

function createDgEngine(deps) {
  const cfg = Object.assign({}, DEFAULTS, deps.cfg || {});
  const now = deps.now || Date.now;
  const log = deps.log || console;
  const getDb = deps.getDb;
  const tankL = deps.tankL || (() => 785);
  const getRefills = deps.getRefills || (() => []);
  const getStartL = deps.getStartL || (() => null);

  let fuelBuf = [], stockShownL = null, lastFuelT = 0;
  const dg = { running: false, onSince: null, offSince: null, lastReadingMs: null, sess: null, lastSig: null };
  let pending = [];          // runs that stopped and are waiting for the level to settle
  let memRuns = [];          // today's run docs (incl. active) – source for the live dashboard
  let lastFinal = null;
  let lastPersistMs = 0;
  let sinceCache = { refillTime: null, consumedL: 0 }, sinceDirty = true, sinceBusy = false;
  const warned = {};
  const warnOnce = (k, msg) => { const t = now(); if (!warned[k] || t - warned[k] > 60000) { warned[k] = t; log.warn(msg); } };
  const col = n => getDb().collection(n);

  // ───────────────────────── fuel level filtering ─────────────────────────
  const medianRange = (from, to) => {
    const v = [];
    for (const e of fuelBuf) if (e.t >= from && e.t <= to) v.push(e.L);
    return v.length >= cfg.minSamples ? median(v) : null;
  };
  const stable = t => medianRange(t - cfg.smoothSec * 1000, t);

  function pushFuel(L, t) {
    if (!(L > 0) || L > tankL() * 1.05) { warnOnce('fuelrange', `[DG] Invalid fuel reading ignored: ${L}`); return; }
    if (t - lastFuelT < 400) return;                     // duplicate / burst delivery
    lastFuelT = t;
    fuelBuf.push({ t, L });
    const cut = t - 20 * 60000;
    while (fuelBuf.length && fuelBuf[0].t < cut) fuelBuf.shift();
    const sm = stable(t);
    if (sm != null && (stockShownL == null || Math.abs(sm - stockShownL) >= cfg.deadbandL)) stockShownL = Math.round(sm);
  }

  // ───────────────────────── segments (hour slices of a run) ─────────────────────────
  function evalSeg(s) {
    if (s.startL == null || s.endL == null) { s.dropL = null; s.valid = false; s.consumedL = null; s.reason = 'no_fuel_data'; return s; }
    s.dropL = r1(s.startL - s.endL);
    const net = s.dropL + (s.refilledL || 0);
    const maxNet = cfg.maxBurnLph * s.runSec / 3600 + 2 * cfg.deadbandL;
    s.valid = false; s.consumedL = null; s.reason = null;
    if (net < -2 * cfg.deadbandL) s.reason = 'unconfirmed_level_rise';   // looks like a refill nobody confirmed
    else if (net > maxNet)        s.reason = 'implausible_drop';         // faster than the engine can burn
    else { s.valid = true; s.consumedL = r1(Math.max(0, net)); }
    return s;
  }

  function cutSegment(doc, endTs, endL) {
    const cp = doc.cp;
    if (!cp || endTs <= cp.ts) return null;
    const seg = {
      startTs: iso(cp.ts), endTs: iso(endTs), date: istDate(cp.ts), hour: istHour(cp.ts),
      runSec: Math.round((endTs - cp.ts) / 1000),
      startL: cp.L, endL: endL == null ? null : r1(endL), refilledL: cp.refilledL || 0
    };
    evalSeg(seg);
    doc.segments.push(seg);
    doc.cp = { ts: endTs, L: seg.endL, refilledL: 0 };
    sinceDirty = true;
    return seg;
  }

  function advance(doc, uptoMs, level) {                 // cut at every IST hour boundary ≤ uptoMs
    let first = true;
    while (doc.cp && nextBoundary(doc.cp.ts) <= uptoMs) {
      cutSegment(doc, nextBoundary(doc.cp.ts), first ? level : null);
      first = false;
    }
  }

  function segmentsOf(doc) {
    if (Array.isArray(doc.segments)) return doc.segments;
    const st = Date.parse(doc.startTs);                  // legacy run: whole run on its start hour
    return [{ startTs: doc.startTs, endTs: doc.endTs, date: doc.date || istDate(st), hour: istHour(st),
              runSec: doc.durationSec || 0, consumedL: doc.consumedL == null ? null : doc.consumedL,
              valid: doc.consumedL != null, refilledL: doc.refilledL || 0, legacy: true }];
  }

  function liveSeg(doc, t) {                             // the not-yet-closed slice of an active / settling run
    if (!doc.cp || (doc.status !== 'active' && doc.status !== 'stopping')) return null;
    const endMs = doc.status === 'stopping' ? Date.parse(doc.endTs) : t;
    if (endMs <= doc.cp.ts) return null;
    const lvl = stable(t);
    const s = {
      startTs: iso(doc.cp.ts), endTs: iso(endMs), date: istDate(doc.cp.ts), hour: istHour(doc.cp.ts),
      runSec: Math.round((endMs - doc.cp.ts) / 1000), startL: doc.cp.L,
      endL: lvl != null ? r1(lvl) : (stockShownL != null ? stockShownL : null),
      refilledL: doc.cp.refilledL || 0, live: true
    };
    return evalSeg(s);
  }
  const allSegs = (doc, t) => { const a = segmentsOf(doc).slice(), l = liveSeg(doc, t); if (l) a.push(l); return a; };

  // ───────────────────────── persistence ─────────────────────────
  function persist(doc) {
    const db = getDb(); if (!db) return;
    lastPersistMs = now();
    const { _id, ...rest } = JSON.parse(JSON.stringify(doc));
    db.collection('fuel_runs').updateOne({ _id: doc._id }, { $set: rest }, { upsert: true })
      .catch(e => log.error('[DG] persist failed:', e.message));
  }
  function logEvent(type, ms, extra) {
    const db = getDb(); if (!db) return;
    db.collection('engine_events').insertOne(Object.assign(
      { date: istDate(ms), type, time: istHms(ms), timestamp: iso(ms), source: 'electrical' }, extra || {}))
      .catch(e => log.error('[DG] event insert failed:', e.message));
  }
  const runTotals = doc => {
    let c = 0, valid = 0, unavail = 0;
    segmentsOf(doc).forEach(s => { if (s.valid) { c += s.consumedL; valid++; } else unavail += s.runSec; });
    return { consumedL: c, valid, unavailSec: unavail };
  };

  // ───────────────────────── run lifecycle ─────────────────────────
  function startSession(startTs, t, sig) {
    flushPending(t, true);
    const L = medianRange(startTs - cfg.anchorSec * 1000, startTs);        // level BEFORE the engine started
    const Lr = L == null ? null : r1(L);
    const doc = {
      _id: 'run_' + startTs, status: 'active', startTs: iso(startTs), endTs: null, lastSeenTs: iso(t),
      date: istDate(startTs), startL: Lr, endL: null, segments: [], cp: { ts: startTs, L: Lr, refilledL: 0 },
      source: 'electrical',
      thresholds: { voltOnV: cfg.voltOnV, voltOffV: cfg.voltOffV, confirmOnSec: cfg.confirmOnSec, confirmOffSec: cfg.confirmOffSec }
    };
    if (Lr != null && lastFinal && lastFinal.endL != null && lastFinal.endL - Lr >= cfg.idleLossL) {
      const drop = r1(lastFinal.endL - Lr);                                // level fell while the DG was OFF
      log.warn(`[DG] Fuel level fell ${drop} L while the DG was stopped (${lastFinal.endL} → ${Lr}) — not counted as consumption`);
      const db = getDb();
      if (db) db.collection('fuel_events').insertOne({ date: istDate(startTs), time: istHms(startTs), timestamp: iso(startTs),
        fuelBeforeL: lastFinal.endL, fuelAfterL: Lr, deltaL: drop, category: 'unexplained_idle_drop', running: false })
        .catch(e => log.error('[DG] fuel_events insert failed:', e.message));
    }
    dg.running = true; dg.sess = doc; dg.onSince = dg.offSince = null;
    memRuns.push(doc); persist(doc);
    logEvent('start', startTs, { lifetimeHours: sig ? sig.hours : 0 });
    log.log(`[DG] ▶ RUN STARTED ${istHms(startTs)} IST — level before start: ${Lr == null ? 'n/a' : Lr + ' L'}`);
  }

  function stopSession(endTs, reason, t, hours) {
    const doc = dg.sess;
    dg.running = false; dg.onSince = dg.offSince = null; dg.sess = null;
    if (!doc) return;
    doc.status = 'stopping'; doc.endTs = iso(endTs); doc.endReason = reason;
    const gap = reason === 'data_gap';
    pending.push({ doc, endTs, gap, dueMs: gap ? t : t + cfg.settleSec * 1000 });
    persist(doc);
    logEvent('stop', endTs, { durationSec: Math.round((endTs - Date.parse(doc.startTs)) / 1000), lifetimeHours: hours || 0, reason });
    log.log(`[DG] ⏹ RUN STOPPED ${istHms(endTs)} IST (${reason})`);
  }

  function finalizeRun(doc, endTs, t, gap) {
    const ref = gap ? endTs : t;
    let L = medianRange(ref - cfg.endWindowSec * 1000, ref);
    if (L == null && gap && doc.lastL != null) L = doc.lastL;
    if (L == null) L = stable(ref);
    advance(doc, endTs, L);
    cutSegment(doc, endTs, L);
    doc.endL = L == null ? null : r1(L);
    doc.status = 'final'; doc.final = true; doc.endTs = iso(endTs);
    doc.durationSec = Math.round((endTs - Date.parse(doc.startTs)) / 1000);
    const tot = runTotals(doc);
    doc.consumedL = tot.valid ? r1(tot.consumedL) : null; doc.unavailableSec = tot.unavailSec;
    persist(doc);
    lastFinal = { endL: doc.endL, endTs };
    log.log(`[DG] Run closed: ${Math.round(doc.durationSec / 60)} min, fuel ${doc.consumedL == null ? 'unavailable' : doc.consumedL + ' L'}` +
            (tot.unavailSec ? `, ${Math.round(tot.unavailSec / 60)} min without valid fuel data` : ''));
  }

  function flushPending(t, all) {
    pending = pending.filter(p => {
      if (all || t >= p.dueMs) { try { finalizeRun(p.doc, p.endTs, t, p.gap); } catch (e) { log.error('[DG] finalize failed:', e.stack || e.message); } return false; }
      return true;
    });
  }

  // ───────────────────────── electrical state machine ─────────────────────────
  function readSignals(p) {
    const ac = (p && p.ac) || {}, eng = (p && p.engine) || {};
    const v = [ac.voltL1N, ac.voltL2N, ac.voltL3N].map(parseFloat);
    if (v.some(x => !Number.isFinite(x) || x < 0 || x > 1000)) return null;         // missing / absurd ⇒ invalid, NOT zero
    const c = [ac.currL1, ac.currL2, ac.currL3].map(parseFloat).map(x => (Number.isFinite(x) && x >= 0 ? x : 0));
    const f = parseFloat(ac.freq), kw = parseFloat(ac.kwTotal);
    return { vAvg: (v[0] + v[1] + v[2]) / 3, vMin: Math.min(...v), freq: Number.isFinite(f) ? f : 0,
             currMax: Math.max(...c), kw: Number.isFinite(kw) ? kw : 0,
             rpm: parseFloat(eng.rpm) || 0, hours: parseFloat(eng.hours) || 0 };
  }

  function step(sig, t) {
    const gapMs = dg.lastReadingMs == null ? 0 : t - dg.lastReadingMs;
    if (dg.running && gapMs > cfg.resumeSec * 1000) stopSession(dg.lastReadingMs, 'data_gap', t, sig.hours);
    if (dg.onSince != null && gapMs > cfg.shortGapSec * 1000) dg.onSince = null;
    const onCond  = sig.vAvg >= cfg.voltOnV && (sig.freq >= cfg.freqOnHz || sig.currMax >= cfg.currOnA || sig.kw >= cfg.kwOn);
    const offCond = sig.vAvg < cfg.voltOffV;
    if (!dg.running) {
      if (onCond) {
        if (dg.onSince == null) dg.onSince = t;
        if (t - dg.onSince >= cfg.confirmOnSec * 1000) startSession(dg.onSince, t, sig);   // timer starts when output first appeared
      } else dg.onSince = null;
    } else if (offCond) {
      if (dg.offSince == null) dg.offSince = gapMs > cfg.shortGapSec * 1000 ? dg.lastReadingMs : t;
      if (t - dg.offSince >= cfg.confirmOffSec * 1000) stopSession(dg.offSince, 'voltage_lost', t, sig.hours);
    } else dg.offSince = null;                                                         // brief dip while running ⇒ ignored
    dg.lastReadingMs = t;
  }

  function housekeeping(t) {
    const doc = dg.sess;
    if (doc) {
      const eff = dg.offSince != null ? dg.offSince : t;
      const lvl = stable(t);
      if (doc.cp.L == null && lvl != null && t - doc.cp.ts < 600000) doc.cp.L = r1(lvl);   // late anchor (e.g. after restart)
      let dirty = false;
      if (nextBoundary(doc.cp.ts) <= eff) { advance(doc, eff, lvl != null ? lvl : stockShownL); dirty = true; }
      if (dirty || t - lastPersistMs > 30000) { doc.lastSeenTs = iso(t); if (lvl != null) doc.lastL = r1(lvl); persist(doc); }
    }
    flushPending(t, false);
    const ds = dayStartMs(istDate(t));
    memRuns = memRuns.filter(d => d.status === 'active' || d.status === 'stopping' || !d.endTs || Date.parse(d.endTs) >= ds);
    if (sinceDirty && !sinceBusy) refreshSince();
  }

  function onReading(payload, fuelL) {
    try {
      const t = now();
      pushFuel(fuelL, t);
      const sig = readSignals(payload);
      if (!sig) warnOnce('sig', '[DG] Missing/invalid voltage readings — run state left unchanged');
      else { dg.lastSig = Object.assign({ at: t }, sig); step(sig, t); }
      housekeeping(t);
    } catch (e) { log.error('[DG] onReading failed:', e.stack || e.message); }
  }

  // ───────────────────────── reading runs back (same code for live + history) ─────────────────────────
  async function getRuns(fromMs, toMs) {
    const db = getDb(); let docs = [];
    if (db) docs = await db.collection('fuel_runs').find({
      startTs: { $lte: iso(toMs) }, $or: [{ endTs: { $gte: iso(fromMs) } }, { endTs: null }] }).toArray();
    const mem = new Map(memRuns.map(d => [String(d._id), d]));
    const out = docs.map(d => mem.get(String(d._id)) || d);
    memRuns.forEach(d => {
      if (docs.some(x => String(x._id) === String(d._id))) return;
      const e = d.endTs ? Date.parse(d.endTs) : Infinity;
      if (Date.parse(d.startTs) <= toMs && e >= fromMs) out.push(d);
    });
    return out;
  }

  async function presence(kind, a, b) {     // does the DB hold sensor data? → separates "0 L" from "no data"
    const db = getDb(); if (!db) return null;
    try {
      if (kind === 'hour') {
        const r = await db.collection('history').aggregate([{ $match: { date: a } },
          { $group: { _id: { $substrCP: ['$timestamps', 0, 2] }, n: { $sum: 1 } } }]).toArray();
        const m = {}; r.forEach(x => { m[parseInt(x._id, 10) % 24] = (m[parseInt(x._id, 10) % 24] || 0) + x.n; }); return m;
      }
      const r = await db.collection('history').aggregate([{ $match: { date: { $gte: a, $lte: b } } },
        { $group: { _id: '$date', n: { $sum: 1 } } }]).toArray();
      const m = {}; r.forEach(x => { m[x._id] = x.n; }); return m;
    } catch (e) { log.error('[DG] presence query failed:', e.message); return null; }
  }

  async function hourly(dk) {
    const from = dayStartMs(dk), to = from + DAY_MS, t = now();
    const runs = await getRuns(from, to);
    const pres = await presence('hour', dk);
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: String(h).padStart(2, '0') + ':00',
      runSec: 0, consumedL: 0, unavailableSec: 0, refilledL: 0, legacy: false, status: 'idle' }));
    runs.forEach(d => allSegs(d, t).forEach(s => {
      const st = Date.parse(s.startTs); if (st < from || st >= to) return;
      const h = hours[s.hour];
      h.runSec += s.runSec; h.refilledL += s.refilledL || 0; if (s.legacy) h.legacy = true;
      if (s.valid) h.consumedL += s.consumedL; else h.unavailableSec += s.runSec;
    }));
    let total = 0, runSec = 0, unavail = 0;
    hours.forEach(h => {
      const hs = from + h.hour * HOUR_MS;
      h.consumedL = r1(h.consumedL); h.refilledL = r1(h.refilledL);
      if (hs > t) { h.status = 'future'; h.consumedL = null; return; }
      if (h.runSec > 0) {
        h.status = h.unavailableSec === 0 ? 'ok' : (h.unavailableSec >= h.runSec ? 'unavailable' : 'partial');
        if (h.status === 'unavailable') h.consumedL = null;
      } else if (pres === null) { h.status = 'unknown'; h.consumedL = null; }
      else if (!pres[h.hour]) { h.status = 'no_data'; h.consumedL = null; }
      else h.status = 'idle';                                                   // DG off, sensor alive ⇒ a true zero
      total += h.consumedL || 0; runSec += h.runSec; unavail += h.unavailableSec;
    });
    const sessions = [];
    runs.forEach(d => {
      const s = Date.parse(d.startTs), e = d.endTs ? Date.parse(d.endTs) : t, running = d.status === 'active';
      const cs = Math.max(s, from), ce = Math.min(e, to);
      if (ce > cs) sessions.push({ startTs: iso(cs), endTs: running ? null : iso(ce), runSec: Math.round((ce - cs) / 1000),
        running, continuesFromPrevDay: s < from, continuesToNextDay: !running && e > to });
    });
    sessions.sort((a, b) => a.startTs.localeCompare(b.startTs));
    return { date: dk, tankL: tankL(), noiseBandL: cfg.deadbandL, totalL: r1(total), runSec, unavailableSec: unavail, hours, sessions };
  }

  async function daily(fromKey, toKey) {
    const from = dayStartMs(fromKey), to = dayStartMs(toKey) + DAY_MS, t = now();
    const runs = await getRuns(from, to);
    const pres = await presence('day', fromKey, toKey);
    const refills = getRefills();
    const days = [];
    for (let ms = from; ms < to; ms += DAY_MS) {
      const key = istDate(ms);
      days.push({ date: key, runSec: 0, consumedL: 0, unavailableSec: 0, refilledL: 0, starts: 0, legacy: false, status: 'idle' });
    }
    const idx = {}; days.forEach((d, i) => { idx[d.date] = i; });
    runs.forEach(d => {
      const sd = istDate(Date.parse(d.startTs)); if (idx[sd] != null) days[idx[sd]].starts++;
      allSegs(d, t).forEach(s => {
        const i = idx[s.date]; if (i == null) return;
        const x = days[i]; x.runSec += s.runSec; if (s.legacy) x.legacy = true;
        if (s.valid) x.consumedL += s.consumedL; else x.unavailableSec += s.runSec;
      });
    });
    refills.forEach(r => { const i = idx[istDate(Date.parse(r.time))]; if (i != null) days[i].refilledL += r.addedL || 0; });
    const today = istDate(t); let total = 0, runSec = 0, unavail = 0;
    days.forEach(x => {
      x.consumedL = r1(x.consumedL);
      if (x.date > today) { x.status = 'future'; x.consumedL = null; return; }
      if (x.runSec > 0) {
        x.status = x.unavailableSec === 0 ? 'ok' : (x.unavailableSec >= x.runSec ? 'unavailable' : 'partial');
        if (x.status === 'unavailable') x.consumedL = null;
      } else if (pres === null) { x.status = 'unknown'; x.consumedL = null; }
      else if (!pres[x.date]) { x.status = 'no_data'; x.consumedL = null; }
      else x.status = 'idle';
      total += x.consumedL || 0; runSec += x.runSec; unavail += x.unavailableSec;
    });
    return { from: fromKey, to: toKey, tankL: tankL(), noiseBandL: cfg.deadbandL, totalL: r1(total), runSec, unavailableSec: unavail, days };
  }

  // ───────────────────────── live numbers (sync, used by the 2-s broadcast) ─────────────────────────
  function todayStats(t) {
    const dk = istDate(t); let runSec = 0, consumedL = 0, validSec = 0, unavailSec = 0;
    memRuns.forEach(d => allSegs(d, t).forEach(s => {
      if (s.date !== dk) return;
      runSec += s.runSec;
      if (s.valid) { consumedL += s.consumedL; validSec += s.runSec; } else unavailSec += s.runSec;
    }));
    return { runSec, consumedL, validSec, unavailSec };
  }
  const lastRefill = () => [...getRefills()].sort((a, b) => String(b.time).localeCompare(String(a.time)))[0] || null;

  async function refreshSince() {
    sinceBusy = true; sinceDirty = false;
    try {
      const last = lastRefill();
      if (!last) { sinceCache = { refillTime: null, consumedL: 0 }; return; }
      const from = Date.parse(last.time), t = now();
      const runs = await getRuns(from, t); let sum = 0;
      runs.forEach(d => segmentsOf(d).forEach(s => { if (s.valid && Date.parse(s.startTs) >= from) sum += s.consumedL; }));
      sinceCache = { refillTime: last.time, consumedL: sum };
    } catch (e) { log.error('[DG] since-refill refresh failed:', e.message); }
    finally { sinceBusy = false; }
  }

  function consumption() {
    const t = now(), ts = todayStats(t), dk = istDate(t);
    const out = {
      available: false, stockL: stockShownL, currentL: stockShownL, startL: getStartL(), refillsTodayL: 0,
      todayConsumedL: null, runningNow: dg.running, runSecToday: ts.runSec, unavailableSecToday: ts.unavailSec,
      partial: ts.unavailSec > 0 && ts.validSec > 0, sinceRefill: null, estimated: false, noiseBandL: cfg.deadbandL
    };
    if (stockShownL == null) return out;                                    // no valid sensor data ⇒ say so, don't guess
    if (ts.runSec > 0 && ts.validSec === 0) { out.reason = 'no_valid_fuel_data_during_run'; return out; }
    out.available = true; out.todayConsumedL = Math.round(ts.consumedL);
    out.refillsTodayL = getRefills().filter(r => istDate(Date.parse(r.time)) === dk).reduce((s, r) => s + (r.addedL || 0), 0);
    const last = lastRefill();
    if (last) {
      let live = 0; const lf = Date.parse(last.time);
      [dg.sess, ...pending.map(p => p.doc)].forEach(d => { if (!d) return; const l = liveSeg(d, t); if (l && l.valid && Date.parse(l.startTs) >= lf) live += l.consumedL; });
      out.sinceRefill = { baselineL: last.afterL, refillTime: last.time, source: 'refill', consumedL: Math.round(sinceCache.consumedL + live) };
    } else out.sinceRefill = { baselineL: out.startL, refillTime: null, source: 'day-start', consumedL: out.todayConsumedL };
    return out;
  }

  // ───────────────────────── refills (confirmed only) ─────────────────────────
  async function onRefillConfirmed(r) {
    const tMs = Date.parse(r.time) || now();
    if (Math.abs(now() - tMs) < 5 * 60000) {   // only reset the filter for a fresh refill, not a late confirmation
      fuelBuf = []; if (r.afterL > 0) stockShownL = Math.round(r.afterL);
    }
        let remaining = Number(r.addedL) || 0; if (remaining <= 0) return;
    const runs = (await getRuns(tMs - 2 * HOUR_MS, tMs + 60000)).sort((a, b) => Date.parse(a.startTs) - Date.parse(b.startTs));
    const touched = new Set(); let lastSeg = null, lastDoc = null;
    for (const d of runs) {
      if (!Array.isArray(d.segments)) continue;
      for (const s of d.segments) {
        const st = Date.parse(s.startTs);
        if (st < tMs - 2 * HOUR_MS || st > tMs) continue;
        lastSeg = s; lastDoc = d;
        const needed = -((s.dropL == null ? 0 : s.dropL) + (s.refilledL || 0));   // net rise that nobody explained yet
        if (remaining > 0 && needed > cfg.deadbandL) {
          const c = Math.min(remaining, needed); s.refilledL = r1((s.refilledL || 0) + c); evalSeg(s); remaining -= c; touched.add(d);
        }
      }
    }
        if (remaining > 0) {
      const act = [dg.sess, ...pending.map(p => p.doc)].find(d => d && d.cp && Date.parse(d.startTs) <= tMs);
      if (act) { act.cp.refilledL = r1((act.cp.refilledL || 0) + remaining); touched.add(act); }
      else log.log(`[DG] Refill +${remaining} L happened while the DG was off — consumption unchanged`);
    }
    touched.forEach(d => { if (d.status === 'final') { const t = runTotals(d); d.consumedL = t.valid ? r1(t.consumedL) : null; d.unavailableSec = t.unavailSec; } persist(d); });
    sinceDirty = true;
    log.log(`[DG] Refill +${r.addedL} L credited to ${touched.size} run(s)`);
  }

  // ───────────────────────── startup / restart recovery ─────────────────────────
  async function load() {
    const db = getDb(); if (!db) return;
    try {
      ['date', 'startTs', 'endTs', 'status'].forEach(k => db.collection('fuel_runs').createIndex({ [k]: 1 }).catch(() => {}));
      const t = now();
      const open = (await db.collection('fuel_runs').find({ status: { $in: ['active', 'stopping'] } }).toArray())
        .sort((a, b) => String(b.startTs).localeCompare(String(a.startTs)));
      for (let i = 0; i < open.length; i++) {
        const d = open[i], seen = Date.parse(d.lastSeenTs) || Date.parse(d.startTs);
        if (i === 0 && d.status === 'active' && t - seen <= cfg.resumeSec * 1000) {
          dg.sess = d; dg.running = true; dg.lastReadingMs = seen;           // resume – runtime keeps counting
          log.log('[DG] Resumed active run after restart');
        } else {
          const end = d.status === 'stopping' ? Date.parse(d.endTs) : seen;
          d.endReason = d.endReason || 'server_gap';
          advance(d, end, d.lastL); cutSegment(d, end, d.lastL == null ? null : d.lastL);
          d.endL = d.lastL == null ? null : d.lastL; d.status = 'final'; d.final = true; d.endTs = iso(end);
          d.durationSec = Math.round((end - Date.parse(d.startTs)) / 1000);
          const tot = runTotals(d); d.consumedL = tot.valid ? r1(tot.consumedL) : null; d.unavailableSec = tot.unavailSec;
          persist(d); log.log('[DG] Closed orphan run left by a restart');
        }
      }
      const ds = dayStartMs(istDate(t));
      const today = await db.collection('fuel_runs').find({ startTs: { $lte: iso(t) }, $or: [{ endTs: { $gte: iso(ds) } }, { endTs: null }] }).toArray();
      memRuns = today.map(d => (dg.sess && String(d._id) === String(dg.sess._id)) ? dg.sess : d);
      if (dg.sess && !memRuns.includes(dg.sess)) memRuns.push(dg.sess);
      const fin = await db.collection('fuel_runs').find({ status: 'final' }).toArray();
      fin.sort((a, b) => String(b.endTs).localeCompare(String(a.endTs)));
      if (fin[0]) lastFinal = { endL: fin[0].endL == null ? null : fin[0].endL, endTs: Date.parse(fin[0].endTs) };
      sinceDirty = true;
      log.log(`[DG] Engine loaded — ${memRuns.length} run(s) today`);
    } catch (e) { log.error('[DG] load failed:', e.stack || e.message); }
  }

  // ───────────────────────── HTTP API ─────────────────────────
  function registerRoutes(app) {
    app.get('/api/dg/hourly', async (req, res) => {
      const dk = req.query.date || istDate(now());
      if (!validDay(dk)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      try { res.json(await hourly(dk)); }
      catch (e) { log.error('[DG] /hourly failed:', e.message); res.status(500).json({ error: 'Could not read run history: ' + e.message }); }
    });
    app.get('/api/dg/daily', async (req, res) => {
      const to = req.query.to || istDate(now()), from = req.query.from || istDate(Date.parse(to + 'T00:00:00Z') - 6 * DAY_MS);
      if (!validDay(from) || !validDay(to)) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
      if (from > to) return res.status(400).json({ error: 'from must be <= to' });
      if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 365) return res.status(400).json({ error: 'range limited to 366 days' });
      try { res.json(await daily(from, to)); }
      catch (e) { log.error('[DG] /daily failed:', e.message); res.status(500).json({ error: 'Could not read run history: ' + e.message }); }
    });
    app.get('/api/dg/status', (req, res) => res.json({
      running: dg.running, onSince: dg.onSince, offSince: dg.offSince, runStart: dg.sess ? dg.sess.startTs : null,
      lastSignals: dg.lastSig, stockL: stockShownL, fuelSamples: fuelBuf.length, settling: pending.length,
      runsInMemory: memRuns.length, thresholds: cfg }));
  }

  return {
    onReading, onRefillConfirmed, load, registerRoutes, consumption, hourly, daily,
    isRunning: () => dg.running,
    todayRuntimeHours: () => +(todayStats(now()).runSec / 3600).toFixed(3),
    runSecForDate: async dk => (await daily(dk, dk)).days[0].runSec,
    dayTotals: async dk => { const d = (await daily(dk, dk)).days[0]; return { consumedL: d.consumedL, runSec: d.runSec, starts: d.starts, status: d.status }; },
    dailyTotals: async (f, t) => { const m = {}; (await daily(f, t)).days.forEach(d => { m[d.date] = d; }); return m; },
    _debug: { get memRuns() { return memRuns; } }
  };
}

module.exports = { createDgEngine, DEFAULTS };