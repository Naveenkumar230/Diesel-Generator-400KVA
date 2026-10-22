'use strict';

(function () {

  const TZ = 'Asia/Kolkata';
  const todayStr   = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const daysAgoStr = n => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  const fmtDay     = d => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN',
                          { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });

  const STYLE = `
  #dpOverlay { display:none; position:fixed; inset:0; z-index:999997; background:rgba(15,23,42,.6);
    backdrop-filter:blur(5px); align-items:center; justify-content:center; padding:14px; box-sizing:border-box; }
  #dpOverlay.open { display:flex; }
  .dp-box { background:#fff; border-radius:18px; border:2px solid #2563EB; box-shadow:0 24px 64px rgba(37,99,235,.25);
    width:100%; max-width:380px; font-family:'Nunito',sans-serif; overflow:hidden; }
  .dp-head { background:linear-gradient(135deg,#2563EB,#1D4ED8); padding:14px 18px; display:flex; align-items:center; gap:10px; }
  .dp-title { font-size:.98rem; font-weight:900; color:#fff; flex:1; }
  .dp-close { background:rgba(255,255,255,.15); border:none; color:#fff; width:28px; height:28px; border-radius:8px; cursor:pointer; }
  .dp-close:hover { background:rgba(255,255,255,.3); }
  .dp-body { padding:18px; display:flex; flex-direction:column; gap:12px; }
  .dp-sub { font-size:.74rem; color:#4A5568; line-height:1.5; }
  .dp-input { width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid #C8D5EF; border-radius:10px;
    font-family:'JetBrains Mono',monospace; font-size:.9rem; font-weight:700; color:#1A2340; background:#F8FAFF; outline:none; }
  .dp-input:focus { border-color:#2563EB; background:#fff; }
  .dp-presets { display:flex; gap:8px; }
  .dp-pre { flex:1; background:#F0F4FF; color:#4A5568; border:1.5px solid #C8D5EF; padding:8px; border-radius:8px;
    cursor:pointer; font-family:inherit; font-size:.74rem; font-weight:800; }
  .dp-pre:hover { background:#E2E8F5; color:#1A2340; }
  .dp-err { color:#DC2626; font-size:.74rem; font-weight:800; min-height:1.1em; }
  .dp-go { background:linear-gradient(135deg,#2563EB,#1D4ED8); color:#fff; border:none; padding:12px; border-radius:10px;
    font-family:inherit; font-size:.88rem; font-weight:900; cursor:pointer; }
  .dp-go:hover { background:linear-gradient(135deg,#1D4ED8,#1E40AF); }

  #viewDateBanner { display:none; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 20px;
    background:#FEF3C7; border-bottom:2px solid #D97706; font-family:'Nunito',sans-serif; }
  #viewDateBanner.show { display:flex; }
  #vdbText { flex:1; font-size:.78rem; font-weight:800; color:#92400E; min-width:220px; }
  #viewDateBanner button { background:#fff; border:1.5px solid #D97706; color:#92400E; padding:5px 12px;
    border-radius:8px; cursor:pointer; font-family:inherit; font-size:.72rem; font-weight:800; }
  #viewDateBanner button:hover { background:#FDE68A; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Date picker popup ─────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'dpOverlay';
  overlay.innerHTML = `
    <div class="dp-box">
      <div class="dp-head">
        <span style="font-size:1.3rem">📅</span>
        <span class="dp-title">View a past day</span>
        <button class="dp-close" id="dpClose">✕</button>
      </div>
      <div class="dp-body">
        <div class="dp-sub">Pick a date. The Min / Avg / Max tables, diesel consumption and run time on the home page will show that whole day.</div>
        <input type="date" class="dp-input" id="dpDate">
        <div class="dp-presets">
          <button class="dp-pre" data-n="0">Today</button>
          <button class="dp-pre" data-n="1">Yesterday</button>
          <button class="dp-pre" data-n="2">2 days ago</button>
        </div>
        <div class="dp-err" id="dpErr"></div>
        <button class="dp-go" id="dpGo">Show this day</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = id => document.getElementById(id);

  function openPicker() {
    const cur = window._viewDateValue || todayStr();
    $('dpDate').max = todayStr();
    $('dpDate').value = cur;
    $('dpErr').textContent = '';
    overlay.classList.add('open');
  }
  function closePicker() { overlay.classList.remove('open'); }

  function apply(d) {
    if (!d) { $('dpErr').textContent = 'Select a date first'; return; }
    if (d > todayStr()) { $('dpErr').textContent = 'Pick today or an earlier date'; return; }
    if (typeof window.setViewDate !== 'function') {
      $('dpErr').textContent = 'App not updated — hard refresh (Ctrl+Shift+R)';
      return;
    }
    closePicker();
    window.setViewDate(d);     // defined in app.js
  }

  $('dpClose').addEventListener('click', closePicker);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePicker(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closePicker(); });
  $('dpGo').addEventListener('click', () => apply($('dpDate').value));
  $('dpDate').addEventListener('keydown', e => { if (e.key === 'Enter') apply($('dpDate').value); });
  overlay.querySelectorAll('.dp-pre').forEach(b =>
    b.addEventListener('click', () => apply(daysAgoStr(parseInt(b.dataset.n, 10)))));

  // ── "Viewing date" banner ─────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'viewDateBanner';
  banner.innerHTML = `<span id="vdbText"></span>
    <button id="vdbChange">Change date</button>
    <button id="vdbBack">Back to today</button>`;
  const ref = document.querySelector('.hero-bar');
  if (ref && ref.parentNode) ref.parentNode.insertBefore(banner, ref); else document.body.appendChild(banner);

  $('vdbChange').addEventListener('click', openPicker);
  $('vdbBack').addEventListener('click', () => {
    if (typeof window.setViewDate === 'function') window.setViewDate(null);
  });

  // app.js calls this whenever the viewed date changes
  window.onViewDateChange = function (d) {
    if (d) {
      $('vdbText').textContent = `📅 Viewing ${fmtDay(d)} — Min / Avg / Max, diesel and run time are for this whole day. Live tiles still show current values.`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  };

  // ── Hook up the existing 📝 button ────────────────────────
  function wireButton() {
    const btn = $('dailySummaryBtn') || document.querySelector('.summary-card');
    if (!btn || btn.dataset.dpWired) return;
    btn.dataset.dpWired = '1';
    btn.addEventListener('click', openPicker);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
  else setTimeout(wireButton, 300);

})();