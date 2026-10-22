'use strict';
// ════════════════════════════════════════════════════════════════
//  GenSight Refill — v2  (REPLACES the whole old refill-prediction.js)
//  • Homepage: only a "Refill" button in the header (+ pending badge)
//  • Server detects candidates → popup asks Refill / No Refill
//  • Full-page details view: filters, chart, history, review log, settings
// ════════════════════════════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const TZ = 'Asia/Kolkata';
    const MIN_REFILL_L = 100;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fDate = iso => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const fTime = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });
  const dtToInput = d => new Date(d.getTime() + 19800000).toISOString().slice(0, 16);          // → "YYYY-MM-DDTHH:mm" in IST
  const inputToIso = (v, end) => new Date(v + (end ? ':59.999' : ':00') + '+05:30').toISOString();

  let settings = { refillPredictLowL: 25, refillPredictHighL: 70, refillMinRiseL: 70, refillSettleSec: 90, refillNoiseBandL: 10, tankCapacityL: 785 };
  let confirmed = [], review = [], queue = [], current = null, busy = false, chart = null;
  const snoozed = new Set();

  async function api(url, opt) {
    const r = await fetch(url, opt); let j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (!r.ok) { const e = new Error((j && j.error) || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  const post = (url, body, headers) => api(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });

  // Prediction thresholds classify an amount. They NEVER block detection or confirmation.
  function classify(L) {
    if (L < settings.refillPredictLowL)  return { k: 'below',  t: 'Below predicted range' };
    if (L > settings.refillPredictHighL) return { k: 'above',  t: 'Above predicted range' };
    return { k: 'within', t: 'Within predicted range' };
  }
  const badge = L => { const c = classify(L); return `<span class="rf-b rf-b-${c.k}">${c.t}</span>`; };

  // ── CSS ───────────────────────────────────────────────────────
  const st = document.createElement('style');
  st.textContent = `
  .btn-refill{position:relative;display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:10px;background:#ECFDF5;border:1px solid rgba(5,150,105,.35);cursor:pointer;font-family:inherit;font-size:.74rem;font-weight:800;color:#047857;white-space:nowrap;flex-shrink:0;transition:all .18s}
  .btn-refill:hover{background:#D1FAE5;border-color:#059669}
  .rf-hdr-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#DC2626;color:#fff;font-size:.62rem;font-weight:900;display:grid;place-items:center;animation:rfPulse 1.4s infinite}
  @keyframes rfPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}

  #refillPopupOverlay{display:none;position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.65);backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
  #refillPopupOverlay.open{display:flex}
  .rp-box{background:#fff;border-radius:20px;border:2px solid #059669;box-shadow:0 24px 64px rgba(5,150,105,.25);width:100%;max-width:480px;max-height:96vh;overflow-y:auto;font-family:'Nunito',sans-serif}
  .rp-head{background:linear-gradient(135deg,#059669,#047857);padding:16px 20px;display:flex;align-items:center;gap:12px}
  .rp-icon{font-size:2rem}.rp-title{font-size:1rem;font-weight:900;color:#fff}.rp-subtitle{font-size:.74rem;color:rgba(255,255,255,.85);margin-top:2px}
  .rp-body{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
  .rp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .rp-stat{background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:10px;padding:10px 6px;text-align:center}
  .rp-stat-val{font-size:1.1rem;font-weight:900;color:#059669;font-family:'JetBrains Mono',monospace}
  .rp-stat-lbl{font-size:.58rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.06em}
  .rp-meta{font-size:.74rem;color:#4A5568;line-height:1.7;background:#F8FAFF;border:1.5px solid #E2E8F5;border-radius:10px;padding:8px 12px}
  .rp-note{font-size:.70rem;color:#92400E;background:#FEF3C7;border-radius:8px;padding:7px 10px}
  .rp-lbl{font-size:.66rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .rp-input{width:100%;padding:10px 12px;border-radius:10px;border:2px solid #D1D5DB;background:#F9FAFB;font-family:inherit;font-size:.9rem;font-weight:700;color:#1A2340;outline:none;box-sizing:border-box}
  .rp-input:focus{border-color:#059669;background:#fff}
  .rp-err{color:#DC2626;font-size:.76rem;font-weight:800;min-height:1.1em}
  .rp-actions{display:flex;gap:10px}
  .rp-btn{flex:1;padding:12px;border-radius:10px;border:none;font-family:inherit;font-size:.88rem;font-weight:900;cursor:pointer;transition:all .15s}
  .rp-btn:disabled{opacity:.55;cursor:wait}
  .rp-yes{background:linear-gradient(135deg,#059669,#047857);color:#fff}
  .rp-no{background:#FEE2E2;color:#B91C1C;border:1.5px solid #FCA5A5}
  .rp-later{flex:0 0 auto;padding:12px 14px;background:#F9FAFB;color:#6B7280;border:1.5px solid #D1D5DB}

  #refillToast{display:none;position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:1000000;background:#1A2340;color:#fff;border-radius:12px;padding:11px 18px;font:800 .8rem 'Nunito',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)}

  #refillOverlay{display:none;position:fixed;inset:0;z-index:9998;background:#F0F4FF;font-family:'Nunito',sans-serif;color:#1A2340;overflow-y:auto}
  #refillOverlay.open{display:block}
  .rf-top{display:flex;align-items:center;gap:14px;padding:14px 28px;background:#fff;border-bottom:2px solid #E2E8F5;position:sticky;top:0;z-index:5;box-shadow:0 2px 12px rgba(37,99,235,.07);flex-wrap:wrap}
  .rf-back{background:#F0F4FF;border:1.5px solid #C8D5EF;color:#4A5568;padding:8px 16px;border-radius:8px;cursor:pointer;font:800 .82rem inherit}
  .rf-title{font-size:1.1rem;font-weight:900;flex:1}
  .rf-body{padding:20px 28px 80px;display:flex;flex-direction:column;gap:18px;max-width:1500px;margin:0 auto}
  .rf-panel{background:#fff;border:1.5px solid #E2E8F5;border-radius:16px;padding:18px 20px;box-shadow:0 1px 8px rgba(37,99,235,.05)}
  .rf-ph{font-size:.84rem;font-weight:900;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
  .rf-card{background:#fff;border:1.5px solid #E2E8F5;border-radius:12px;padding:12px 14px}
  .rf-card-l{font-size:.64rem;font-weight:800;color:#8A9BB5;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .rf-card-v{font-size:1.3rem;font-weight:900;font-family:'JetBrains Mono',monospace}
  .rf-card-s{font-size:.66rem;color:#8A9BB5;margin-top:3px}
  .rf-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .rf-bar label{font-size:.68rem;font-weight:800;color:#8A9BB5;text-transform:uppercase}
  .rf-bar input{background:#F8FAFF;border:1.5px solid #C8D5EF;color:#1A2340;padding:7px 10px;border-radius:8px;font:.8rem 'JetBrains Mono',monospace;outline:none}
  .rf-btn{padding:8px 16px;border-radius:8px;border:1.5px solid #C8D5EF;background:#F0F4FF;color:#4A5568;font:800 .78rem inherit;cursor:pointer}
  .rf-btn.p{background:#2563EB;border-color:#2563EB;color:#fff}.rf-btn.g{background:#F0FDF4;border-color:#BBF7D0;color:#059669}
  .rf-msg{font-size:.76rem;font-weight:800;min-height:1.2em;margin-top:8px}
  .rf-msg.err{color:#DC2626}.rf-msg.ok{color:#059669}
  .rf-chartwrap{position:relative;height:260px;margin-top:14px}
  .rf-empty{text-align:center;padding:34px 12px;color:#8A9BB5;font-size:.84rem;font-style:italic}
  .rf-scroll{overflow-x:auto;border:1.5px solid #E2E8F5;border-radius:10px;margin-top:14px}
  .rf-t{width:100%;min-width:900px;border-collapse:collapse;font-size:.74rem}
  .rf-t th{background:#1A2340;color:#fff;padding:8px 10px;text-align:left;font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  .rf-t td{padding:8px 10px;border-bottom:1px solid #F0F4FF;white-space:nowrap}
  .rf-t tr:nth-child(even) td{background:#F8FAFF}
  .rf-mono{font-family:'JetBrains Mono',monospace}.rf-add{font-weight:900;color:#059669}
  .rf-b{font-size:.6rem;font-weight:800;padding:2px 8px;border-radius:12px;white-space:nowrap}
  .rf-b-below{background:#FEF3C7;color:#92400E}.rf-b-within{background:#D1FAE5;color:#065F46}.rf-b-above{background:#DBEAFE;color:#1E40AF}
  .rf-b-conf{background:#D1FAE5;color:#065F46}.rf-b-leg{background:#E5E7EB;color:#374151}.rf-b-pend{background:#FEF3C7;color:#92400E}.rf-b-rej{background:#FEE2E2;color:#991B1B}
  .rf-grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .rf-f label{display:block;font-size:.64rem;font-weight:800;color:#6B7280;text-transform:uppercase;margin-bottom:4px}
  .rf-f input{width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #C8D5EF;border-radius:8px;font:700 .85rem 'JetBrains Mono',monospace;background:#F8FAFF;outline:none}
  .rf-f small{display:block;font-size:.6rem;color:#8A9BB5;margin-top:3px}
  .rf-sec{font-size:.7rem;font-weight:900;color:#8A9BB5;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 8px}
  @media(max-width:700px){.rf-top,.rf-body{padding-left:14px;padding-right:14px}}
  `;
  document.head.appendChild(st);

  // ── Popup ─────────────────────────────────────────────────────
  const popup = document.createElement('div');
  popup.id = 'refillPopupOverlay';
  popup.innerHTML = `
    <div class="rp-box">
      <div class="rp-head"><div class="rp-icon">⛽</div>
        <div><div class="rp-title">Possible refill detected</div><div class="rp-subtitle" id="rpSub"></div></div></div>
      <div class="rp-body">
        <div class="rp-stats">
          <div class="rp-stat"><div class="rp-stat-val" id="rpBefore">—</div><div class="rp-stat-lbl">Previous (L)</div></div>
          <div class="rp-stat"><div class="rp-stat-val" id="rpAfter">—</div><div class="rp-stat-lbl">Now (L)</div></div>
          <div class="rp-stat"><div class="rp-stat-val" id="rpInc">—</div><div class="rp-stat-lbl">Increase (L)</div></div>
        </div>
        <div class="rp-meta" id="rpMeta"></div>
        <div id="rpMain">
          <div class="rp-lbl">👤 Who refilled? (optional)</div>
          <input class="rp-input" id="rpPerson" maxlength="60" placeholder="Name" autocomplete="off">
          <div class="rp-err" id="rpErr1" style="margin-top:6px"></div>
          <div class="rp-actions" style="margin-top:6px">
            <button class="rp-btn rp-later" id="rpLater">Decide later</button>
            <button class="rp-btn rp-no" id="rpNo">❌ No Refill</button>
            <button class="rp-btn rp-yes" id="rpYes">✅ Refill</button>
          </div>
        </div>
        <div id="rpPw" style="display:none">
          <div class="rp-note">Password required to classify this as <b>No Refill</b>.</div>
          <input class="rp-input" id="rpPass" type="password" placeholder="Password" autocomplete="off" style="margin-top:10px">
          <div class="rp-err" id="rpErr2" style="margin-top:6px"></div>
          <div class="rp-actions" style="margin-top:6px">
            <button class="rp-btn rp-later" id="rpBack">Back</button>
            <button class="rp-btn rp-no" id="rpNoOk">Confirm No Refill</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(popup);
  const toast = document.createElement('div'); toast.id = 'refillToast'; document.body.appendChild(toast);
  let _tt = null;
  function showToast(m) { toast.textContent = m; toast.style.display = 'block'; clearTimeout(_tt); _tt = setTimeout(() => { toast.style.display = 'none'; }, 3500); }

  function setBusy(b) { busy = b; ['rpYes', 'rpNo', 'rpNoOk', 'rpLater', 'rpBack'].forEach(id => { const e = $(id); if (e) e.disabled = b; }); }

  function renderPopup() {
    const c = current; if (!c) return;
    $('rpSub').textContent = `${fDate(c.detectedAt)} · ${fTime(c.detectedAt)}`;
    $('rpBefore').textContent = c.beforeL; $('rpAfter').textContent = c.afterL; $('rpInc').textContent = '+' + c.increaseL;
    $('rpMeta').innerHTML = `Detected: <b>${fDate(c.detectedAt)} ${fTime(c.detectedAt)}</b><br>DG status: <b>${esc(c.dgStatus || 'Unknown')}</b><br>${badge(c.increaseL)}` +
      (queue.length > 1 ? `<br><span style="color:#92400E">${queue.length - 1} more event(s) waiting</span>` : '');
    $('rpPerson').value = ''; $('rpPass').value = ''; $('rpErr1').textContent = ''; $('rpErr2').textContent = '';
    $('rpMain').style.display = ''; $('rpPw').style.display = 'none';
    setBusy(false); popup.classList.add('open');
  }
  function showNext(force) {
    if (current) return;
    const c = queue.find(x => force || !snoozed.has(x.id));
    if (!c) { popup.classList.remove('open'); return; }
    current = c; renderPopup();
  }
  function closePopup() { current = null; popup.classList.remove('open'); }
  function dropFromQueue(id) { queue = queue.filter(x => x.id !== id); updateBadge(); if (current && current.id === id) closePopup(); }
  function updateBadge() {
    const b = $('refillHdrBadge'); if (!b) return;
    b.style.display = queue.length ? 'grid' : 'none'; b.textContent = queue.length;
    const chip = $('rfPendChip'); if (chip) { chip.style.display = queue.length ? '' : 'none'; chip.innerHTML = `<span class="rf-b rf-b-pend">${queue.length} pending decision(s)</span>`; }
  }

  popup.addEventListener('click', async e => {
    const id = e.target.id; if (!id || busy || !current) return;
    const c = current;
    if (id === 'rpLater') { snoozed.add(c.id); closePopup(); showNext(); }
    else if (id === 'rpNo') { $('rpMain').style.display = 'none'; $('rpPw').style.display = ''; $('rpPass').focus(); }
    else if (id === 'rpBack') { $('rpPw').style.display = 'none'; $('rpMain').style.display = ''; $('rpErr2').textContent = ''; }
    else if (id === 'rpYes') {
      setBusy(true); $('rpErr1').textContent = '';
      try {
        await post(`/api/refill-candidates/${c.id}/confirm`, { person: $('rpPerson').value.trim() });
        showToast(`✅ Refill recorded: +${c.increaseL} L`);
        dropFromQueue(c.id); afterChange(); showNext();
      } catch (err) {
        if (err.status === 409 || err.status === 404) { dropFromQueue(c.id); afterChange(); showToast('Already handled: ' + err.message); showNext(); }
        else { $('rpErr1').textContent = err.message; setBusy(false); }
      }
    }
    else if (id === 'rpNoOk') {
      const pw = $('rpPass').value; if (!pw) { $('rpErr2').textContent = 'Enter the password'; return; }
      setBusy(true); $('rpErr2').textContent = '';
      try {
        await post(`/api/refill-candidates/${c.id}/reject`, { password: pw });
        $('rpPass').value = '';
        showToast('Marked as No Refill'); dropFromQueue(c.id); afterChange(); showNext();
      } catch (err) {
        if (err.status === 409 || err.status === 404) { dropFromQueue(c.id); afterChange(); showNext(); }
        else { $('rpErr2').textContent = err.message; $('rpPass').value = ''; setBusy(false); $('rpPass').focus(); }
      }
    }
  });
  popup.addEventListener('keydown', e => { if (e.key === 'Enter' && $('rpPw').style.display !== 'none') $('rpNoOk').click(); });

  async function loadPending() {
    try {
      const list = await api('/api/refill-candidates?status=pending');
      queue = list.filter(c => c.increaseL >= MIN_REFILL_L)
                  .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
                        if (current && !queue.find(x => x.id === current.id)) closePopup();
      updateBadge(); showNext();
    } catch (e) { /* offline: try again on next poll */ }
  }

  // ── Details page ──────────────────────────────────────────────
  const ov = document.createElement('div'); ov.id = 'refillOverlay';
  ov.innerHTML = `
    <div class="rf-top"><button class="rf-back" id="rfBack">← Back</button>
      <span class="rf-title">⛽ Refill History &amp; Tracker</span><span id="rfPendChip" style="display:none"></span></div>
    <div class="rf-body">
      <div class="rf-cards" id="rfCards"></div>
      <div class="rf-panel" id="rfPred"></div>
      <div class="rf-panel">
        <div class="rf-ph">📅 Refill history <span style="flex:1"></span>
          <button class="rf-btn g" id="rfManual">➕ Manual entry</button></div>
        <div class="rf-bar">
          <label>From</label><input type="datetime-local" id="rfFrom">
          <label>To</label><input type="datetime-local" id="rfTo">
          <button class="rf-btn p" id="rfFetch">⬇ Fetch</button><button class="rf-btn" id="rfReset">Reset</button>
        </div>
        <div class="rf-msg" id="rfMsg"></div>
        <div id="rfChartBox"><div class="rf-chartwrap"><canvas id="rfChart"></canvas></div></div>
        <div id="rfTable"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  function openPage() {
    ov.classList.add('open'); document.body.style.overflow = 'hidden';
    if (queue.length) { snoozed.clear(); showNext(true); }
    resetFilters(false); loadAll();
  }
  function closePage() { ov.classList.remove('open'); document.body.style.overflow = ''; }
  function resetFilters(fetchNow) {
    const now = new Date(), from = new Date(now.getTime() - 30 * 86400000);
    $('rfFrom').value = dtToInput(from).slice(0, 10) + 'T00:00'; $('rfTo').value = dtToInput(now);
    $('rfMsg').textContent = ''; if (fetchNow) loadAll();
  }
  function msg(t, kind) { const m = $('rfMsg'); m.textContent = t || ''; m.className = 'rf-msg ' + (kind || ''); }
  function afterChange() { if (ov.classList.contains('open')) loadAll(); }

  async function loadAll() {
    const f = $('rfFrom').value, t = $('rfTo').value;
    if (!f || !t) return msg('Select both From and To.', 'err');
    if (f > t) return msg('"From" must not be later than "To".', 'err');
    msg('Loading…');
    $('rfTable').innerHTML = '<div class="rf-empty">Loading…</div>';
    const q = `from=${encodeURIComponent(inputToIso(f))}&to=${encodeURIComponent(inputToIso(t, true))}`;
    try {
            const [recs, s] = await Promise.all([
        api('/api/refills?' + q), api('/api/refill-settings')
      ]);
      settings = s; confirmed = recs;
      msg('');
      renderCards(); renderTable(); renderChart(); renderPred();
    } catch (e) { msg('Could not load: ' + e.message, 'err'); $('rfTable').innerHTML = ''; }
  }

  function renderCards() {
    const tot = confirmed.reduce((s, r) => s + (r.addedL || 0), 0), n = confirmed.length;
    const last = confirmed[0];
    const card = (l, v, s, c) => `<div class="rf-card"><div class="rf-card-l">${l}</div><div class="rf-card-v" style="color:${c || '#1A2340'}">${v}</div><div class="rf-card-s">${s || ''}</div></div>`;
    $('rfCards').innerHTML =
      card('Refills (period)', n, 'confirmed only') + card('Total added', tot + ' L', 'confirmed only', '#059669') +
      card('Average / refill', (n ? Math.round(tot / n) : 0) + ' L', '') +
      card('Latest refill', last ? '+' + last.addedL + ' L' : '—', last ? fDate(last.time) + ' ' + fTime(last.time) : 'none in period') +
      card('Pending decisions', queue.length, 'awaiting your answer', queue.length ? '#D97706' : '#1A2340');
  }

  function renderTable() {
    if (!confirmed.length) { $('rfTable').innerHTML = '<div class="rf-empty">⛽ No confirmed refills in the selected period.</div>'; return; }
    $('rfTable').innerHTML = `<div class="rf-scroll"><table class="rf-t"><thead><tr>
      <th>Event ID</th><th>Date</th><th>Time</th><th>Before (L)</th><th>After (L)</th><th>Added</th><th>Range</th><th>DG status</th><th>Status</th><th>Confirmed at</th><th>Person</th></tr></thead><tbody>` +
      confirmed.map(r => `<tr>
        <td class="rf-mono">${esc(String(r.id).slice(-6))}</td><td><b>${fDate(r.time)}</b></td><td>${fTime(r.time)}</td>
        <td class="rf-mono">${r.beforeL}</td><td class="rf-mono">${r.afterL}</td><td class="rf-mono rf-add">+${r.addedL} L</td>
        <td>${badge(r.addedL)}</td><td>${esc(r.dgStatus || '—')}</td>
        <td>${r.legacy ? '<span class="rf-b rf-b-leg">Legacy (auto-saved)</span>' : '<span class="rf-b rf-b-conf">Confirmed</span>'}</td>
        <td>${r.confirmedAt ? fDate(r.confirmedAt) + ' ' + fTime(r.confirmedAt) : '—'}</td>
        <td>${esc(r.person)} <button data-edit="${esc(r.id)}" title="Edit" style="border:none;background:none;cursor:pointer">✏️</button></td></tr>`).join('') +
      '</tbody></table></div>';
  }

  function renderChart() {
    if (chart) { chart.destroy(); chart = null; }
    const box = $('rfChartBox');
    if (!confirmed.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    const rows = [...confirmed].sort((a, b) => a.time.localeCompare(b.time));
    chart = new Chart($('rfChart').getContext('2d'), {
      type: 'bar',
      data: { labels: rows.map(r => fDate(r.time).slice(0, 6) + ' ' + fTime(r.time)),
        datasets: [{ label: 'Litres added', data: rows.map(r => r.addedL), backgroundColor: 'rgba(5,150,105,.8)', borderColor: '#059669', borderWidth: 1.5, borderRadius: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: {
          title: it => { const r = rows[it[0].dataIndex]; return fDate(r.time) + ' ' + fTime(r.time); },
          afterBody: it => { const r = rows[it[0].dataIndex]; return [`Before: ${r.beforeL} L (${r.beforePct}%)`, `After: ${r.afterL} L (${r.afterPct}%)`, `By: ${r.person}`]; } } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Litres added' } }, x: { ticks: { maxRotation: 40 } } } }
    });
  }

  // Next-refill estimate from live in-memory readings (dayStore from app.js)
  function renderPred() {
    const el = $('rfPred');
    const ds = (typeof dayStore !== 'undefined') ? dayStore : null;
    if (!ds || !ds.fuelPct || ds.fuelPct.length < 10) { el.innerHTML = '<div class="rf-ph">🔮 Next refill estimate</div><div class="rf-empty" style="padding:10px">Collecting live readings…</div>'; return; }
    const sec = s => { const p = String(s).split(':').map(Number); return p.length >= 3 && !p.some(isNaN) ? p[0] * 3600 + p[1] * 60 + p[2] : null; };
    const n = ds.fuelPct.length; let drop = 0, hrs = 0;
    for (let i = n - 1; i > 0 && hrs < 6; i--) {
      const a = sec(ds.timestamps[i - 1]), b = sec(ds.timestamps[i]); if (a == null || b == null) continue;
      let dt = b - a; if (dt < 0) dt += 86400; hrs += dt / 3600;
      const d = ds.fuelPct[i - 1] - ds.fuelPct[i]; if (d > 0) drop += d * settings.tankCapacityL / 100;   // rises are ignored, never negative burn
    }
    const curL = Math.round(ds.fuelPct[n - 1] * settings.tankCapacityL / 100), lowL = 0.2 * settings.tankCapacityL;
    const rate = hrs > 0.25 ? drop / hrs : 0;
    let big = '—', sub = 'Not enough burn data yet (engine idle?)';
    if (rate > 0.5) {
      const h = Math.max(0, curL - lowL) / rate, eta = new Date(Date.now() + h * 3600e3);
      big = eta.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });
      sub = `≈ ${Math.round(h)} h from now · burn ${rate.toFixed(1)} L/h · level reaches 20%`;
    }
    el.innerHTML = `<div class="rf-ph">🔮 Next refill estimate</div><div style="font:900 1.3rem 'JetBrains Mono',monospace">${big}</div><div class="rf-card-s">${sub}</div>`;
  }

    // ── Page events ───────────────────────────────────────────────
  ov.addEventListener('click', async e => {
    const t = e.target;
    if (t.id === 'rfBack') closePage();
    else if (t.id === 'rfFetch') loadAll();
    else if (t.id === 'rfReset') resetFilters(true);
    else if (t.id === 'rfManual') manualEntry();
    else if (t.dataset && t.dataset.edit) editPerson(t.dataset.edit);
  });

  async function manualEntry() {
    const b = prompt('Fuel level BEFORE refill (litres):'); if (b === null) return;
    const a = prompt('Fuel level AFTER refill (litres):'); if (a === null) return;
    const person = prompt('Who refilled? (name):') || 'Manual entry';
    const beforeL = parseInt(b, 10), afterL = parseInt(a, 10);
    if (isNaN(beforeL) || isNaN(afterL) || afterL <= beforeL) return alert('Invalid: After must be greater than Before.');
    if (afterL - beforeL < MIN_REFILL_L) return alert(`A refill must be at least ${MIN_REFILL_L} L.`);
        try { await post('/api/refills', { beforeL, afterL, person }); showToast('✅ Manual refill saved'); loadAll(); }
    catch (e) { alert(e.message); }
  }
  async function editPerson(id) {
    const r = confirmed.find(x => x.id === id); if (!r) return;
    const n = prompt(`Edit person for +${r.addedL} L refill:`, r.person || ''); if (n === null) return;
    try { await api('/api/refills/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person: n.trim() || 'Unknown' }) }); loadAll(); }
    catch (e) { alert(e.message); }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const btn = $('refillHdrBtn'); if (btn) btn.addEventListener('click', openPage);
    api('/api/refill-settings').then(s => { settings = s; }).catch(() => {});
    loadPending();
    setInterval(loadPending, 60000);                    // safety net if a socket event is missed
    const sock = (typeof socket !== 'undefined') ? socket : null;   // reuse app.js socket
    if (sock) {
      sock.on('refill:candidate', c => { if (c.increaseL >= MIN_REFILL_L && !queue.find(x => x.id === c.id)) { queue.push(c); updateBadge(); showNext(); } });
            sock.on('refill:resolved', ev => { dropFromQueue(ev.id); afterChange(); showNext(); });
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open') && !popup.classList.contains('open')) closePage(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();