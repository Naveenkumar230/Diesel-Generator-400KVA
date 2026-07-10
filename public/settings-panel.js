'use strict';

(function () {

  const TANK_CAPACITY = 780;

  // ── CSS ──────────────────────────────────────────────────────
  const STYLE = `
  #stgGearBtn {
    display: inline-flex; align-items: center; justify-content: center;
    background: #F0F4FF; border: 1.5px solid #C8D5EF;
    color: #4A5568; width: 30px; height: 30px; padding: 0; border-radius: 50%;
    font-size: .95rem; cursor: pointer; transition: all .18s; margin-left: 8px;
  }
  #stgGearBtn:hover { background: #E2E8F5; color: #1A2340; border-color: #2563EB; }

  #stgOverlay {
    display: none; position: fixed; inset: 0; z-index: 999998;
    background: rgba(15,23,42,.65); backdrop-filter: blur(6px);
    align-items: center; justify-content: center; padding: 14px;
    box-sizing: border-box;
  }
  #stgOverlay.open { display: flex; }

  .stg-box {
    background: #fff; border-radius: 18px; border: 2px solid #2563EB;
    box-shadow: 0 24px 64px rgba(37,99,235,.25);
    width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto;
    font-family: 'Nunito', sans-serif;
    animation: stgSlide .25s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes stgSlide { from{transform:translateY(30px) scale(.96);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }

  .stg-head {
    background: linear-gradient(135deg,#2563EB,#1D4ED8);
    padding: 16px 20px; display: flex; align-items: center; gap: 10px;
    position: sticky; top: 0; z-index: 2;
  }
  .stg-head-icon { font-size: 1.6rem; }
  .stg-head-title { font-size: 1rem; font-weight: 900; color: #fff; flex: 1; }
  .stg-close-btn {
    background: rgba(255,255,255,.15); border: none; color: #fff;
    width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
    font-size: 1rem; line-height: 1;
  }
  .stg-close-btn:hover { background: rgba(255,255,255,.3); }

  .stg-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }

  /* ── Professional lock screen ── */
  .stg-pw-screen {
    display: flex; flex-direction: column; align-items: center;
    padding: 36px 28px 28px;
    background: radial-gradient(circle at 50% 0%, rgba(37,99,235,.06), transparent 70%);
  }
  .stg-pw-badge {
    width: 64px; height: 64px; border-radius: 18px;
    background: linear-gradient(135deg,#2563EB,#1D4ED8);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 20px rgba(37,99,235,.35);
    margin-bottom: 18px;
  }
  .stg-pw-badge svg { width: 30px; height: 30px; }
  .stg-pw-heading { font-size: 1.02rem; font-weight: 900; color: #1A2340; margin-bottom: 4px; }
  .stg-pw-sub { font-size: .76rem; color: #8A9BB5; font-weight: 600; margin-bottom: 24px; text-align: center; line-height: 1.5; }

  .stg-pw-field { width: 100%; position: relative; margin-bottom: 6px; }
  .stg-pw-field-icon {
    position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
    font-size: .92rem; color: #8A9BB5; pointer-events: none;
  }
  .stg-pw-input {
    width: 100%; padding: 13px 44px 13px 40px; border-radius: 11px;
    border: 1.5px solid #E2E8F5; background: #F8FAFF;
    font-family: 'Nunito', sans-serif; font-size: .92rem; font-weight: 700;
    color: #1A2340; outline: none; box-sizing: border-box;
    transition: border-color .15s, background .15s, box-shadow .15s;
    letter-spacing: .02em;
  }
  .stg-pw-input::placeholder { color: #B0BDD6; font-weight: 600; }
  .stg-pw-input:focus {
    border-color: #2563EB; background: #fff;
    box-shadow: 0 0 0 4px rgba(37,99,235,.08);
  }
  .stg-pw-toggle {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    font-size: .82rem; color: #8A9BB5; padding: 8px; border-radius: 7px;
    transition: color .15s, background .15s;
  }
  .stg-pw-toggle:hover { color: #2563EB; background: #EFF6FF; }

  .stg-pw-error {
    width: 100%; min-height: 18px; margin-top: 8px;
    color: #DC2626; font-size: .74rem; font-weight: 700;
    display: flex; align-items: center; gap: 5px;
  }
  .stg-pw-error.shake { animation: stgShake .35s; }
  @keyframes stgShake {
    0%,100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }

  .stg-pw-btn {
    width: 100%; padding: 13px; border-radius: 11px; border: none;
    background: linear-gradient(135deg,#2563EB,#1D4ED8); color: #fff;
    font-family: 'Nunito', sans-serif; font-size: .88rem; font-weight: 900;
    cursor: pointer; margin-top: 14px;
    box-shadow: 0 4px 14px rgba(37,99,235,.3);
    transition: transform .12s, box-shadow .12s, background .15s;
    display: flex; align-items: center; justify-content: center; gap: 7px;
  }
  .stg-pw-btn:hover { background: linear-gradient(135deg,#1D4ED8,#1E40AF); box-shadow: 0 6px 18px rgba(37,99,235,.4); }
  .stg-pw-btn:active { transform: scale(.98); }
  .stg-pw-btn:disabled { opacity: .65; cursor: not-allowed; transform: none; }
  .stg-pw-btn .stg-spin {
    width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4);
    border-top-color: #fff; border-radius: 50%;
    animation: stgPwSpin .7s linear infinite;
  }
  @keyframes stgPwSpin { to { transform: rotate(360deg); } }

  .stg-pw-footnote {
    display: flex; align-items: center; gap: 6px;
    margin-top: 20px; font-size: .66rem; color: #B0BDD6; font-weight: 700;
  }

  .stg-section { border: 1.5px solid #E2E8F5; border-radius: 12px; padding: 14px 16px; }
  .stg-section-title {
    font-size: .76rem; font-weight: 900; color: #1A2340;
    display: flex; align-items: center; gap: 7px; margin-bottom: 12px;
  }
  .stg-field { margin-bottom: 12px; }
  .stg-field:last-child { margin-bottom: 0; }
  .stg-label {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: .72rem; font-weight: 800; color: #6B7280; margin-bottom: 6px;
  }
  .stg-label-val { color: #2563EB; font-family: 'JetBrains Mono', monospace; font-weight: 900; }
  .stg-row { display: flex; align-items: center; gap: 10px; }
  .stg-row input[type=range] { flex: 1; accent-color: #2563EB; }
  .stg-num {
    width: 78px; padding: 7px 9px; border-radius: 8px; border: 1.5px solid #D1D5DB;
    font-family: 'JetBrains Mono', monospace; font-size: .82rem; text-align: center;
    outline: none; box-sizing: border-box;
  }
  .stg-num:focus { border-color: #2563EB; }
  .stg-hint { font-size: .66rem; color: #9CA3AF; margin-top: 5px; }
  .stg-text-input {
    width: 100%; padding: 9px 12px; border-radius: 9px; border: 1.5px solid #D1D5DB;
    font-family: 'Nunito', sans-serif; font-size: .82rem; outline: none; box-sizing: border-box;
  }
  .stg-text-input:focus { border-color: #2563EB; }

  /* ── Unsaved-changes banner ── */
  .stg-dirty-banner {
    display: none; align-items: center; gap: 6px;
    background: #FFF7ED; border: 1.5px solid #FED7AA; color: #C2410C;
    font-size: .72rem; font-weight: 800; padding: 9px 12px;
    border-radius: 9px; margin: 0 20px 4px;
  }
  .stg-dirty-banner.show { display: flex; }

  .stg-footer {
    display: flex; gap: 10px; padding: 4px 20px 20px;
    position: sticky; bottom: 0; background: #fff;
  }
  .stg-save-btn {
    flex: 1; padding: 12px; border-radius: 10px; border: none;
    background: linear-gradient(135deg,#059669,#047857); color: #fff;
    font-family: inherit; font-size: .86rem; font-weight: 900; cursor: pointer;
    transition: background .15s;
  }
  .stg-save-btn:hover { background: linear-gradient(135deg,#047857,#065F46); }
  .stg-save-btn:disabled { opacity: .6; cursor: not-allowed; }
  .stg-save-btn.is-dirty {
    background: linear-gradient(135deg,#D97706,#B45309);
    box-shadow: 0 0 0 3px rgba(217,119,6,.15);
  }
  .stg-save-btn.is-dirty:hover { background: linear-gradient(135deg,#B45309,#92400E); }
  .stg-saved-msg {
    font-size: .72rem; font-weight: 800; color: #059669; text-align: center;
    padding: 6px; display: none;
  }
  .stg-saved-msg.show { display: block; }

  /* ── Email chip manager ── */
  .stg-email-add-row { display: flex; gap: 8px; }
  .stg-email-add-row .stg-text-input { flex: 1; }
  .stg-email-add-btn {
    padding: 9px 16px; border-radius: 9px; border: none;
    background: linear-gradient(135deg,#059669,#047857); color: #fff;
    font-family: 'Nunito', sans-serif; font-size: .78rem; font-weight: 900;
    cursor: pointer; white-space: nowrap; transition: background .15s;
  }
  .stg-email-add-btn:hover { background: linear-gradient(135deg,#047857,#065F46); }
  .stg-email-add-btn:disabled { opacity: .5; cursor: not-allowed; }

  .stg-email-list {
    display: flex; flex-direction: column; gap: 6px; margin-top: 10px;
  }
  .stg-email-empty {
    font-size: .72rem; color: #B0BDD6; font-style: italic;
    padding: 10px 0; text-align: center;
  }
  .stg-email-chip {
    display: flex; align-items: center; gap: 8px;
    background: #F0F4FF; border: 1.5px solid #E2E8F5; border-radius: 9px;
    padding: 8px 8px 8px 12px;
  }
  .stg-email-chip-icon { font-size: .8rem; flex-shrink: 0; }
  .stg-email-chip-text {
    flex: 1; font-size: .78rem; font-weight: 700; color: #1A2340;
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .stg-email-chip-del {
    background: none; border: none; cursor: pointer;
    color: #DC2626; font-size: .82rem; padding: 5px 8px;
    border-radius: 6px; transition: background .15s; flex-shrink: 0;
  }
  .stg-email-chip-del:hover { background: rgba(220,38,38,.1); }
  .stg-email-count {
    font-size: .68rem; font-weight: 800; color: #059669;
    background: #ECFDF5; border: 1.5px solid #BBF7D0;
    padding: 2px 9px; border-radius: 20px;
  }
  .stg-email-err { font-size: .68rem; color: #DC2626; font-weight: 700; margin-top: 6px; min-height: 14px; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Defaults (mirrored from backend defaults) ───────────────
  const DEFAULTS = {
    refillThresholdL:    30,
    lowFuelPct:           30,
    overloadPct:          90,
    ratedKw:             320,
    serviceIntervalHrs:  500,
    alertEmails:          ''
  };

  let emailList = [];
  let isDirty   = false;

  function parseEmails(str) {
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  let settings = { ...DEFAULTS };
  let authed   = false;

  // ── Modal markup ─────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'stgOverlay';
  overlay.innerHTML = `
    <div class="stg-box">
      <div class="stg-head">
        <span class="stg-head-icon">⚙️</span>
        <span class="stg-head-title" id="stgTitle">Settings — Enter Password</span>
        <button class="stg-close-btn" id="stgCloseBtn">✕</button>
      </div>
      <div class="stg-body" id="stgBody"></div>
      <div class="stg-dirty-banner" id="stgDirtyBanner">⚠️ You have unsaved changes — click Save Settings to apply</div>
      <div class="stg-footer" style="display:none" id="stgFooter">
        <button class="stg-save-btn" id="stgSaveBtn">💾 Save Settings</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function buildSettingsForm() {
    return `
      <div class="stg-saved-msg" id="stgSavedMsg">✅ Settings saved &amp; applied</div>

      <div class="stg-section">
        <div class="stg-section-title">⛽ Refill Detection</div>
        <div class="stg-field">
          <div class="stg-label">Jump needed to count as a refill
            <span class="stg-label-val" id="lblRefill">${settings.refillThresholdL} L</span>
          </div>
          <div class="stg-row">
            <input type="range" id="numRefillSlider" min="10" max="150" step="5" value="${settings.refillThresholdL}">
          </div>
          <div class="stg-hint">Fuel level must jump by this much between readings to be logged as a refill.</div>
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-title">🔴 Low Fuel Email Alert</div>
        <div class="stg-field">
          <div class="stg-label">Trigger when fuel drops below
            <span class="stg-label-val" id="lblLowFuel">${settings.lowFuelPct}% (${Math.round(settings.lowFuelPct/100*TANK_CAPACITY)} L)</span>
          </div>
          <input type="range" id="numLowFuelSlider" min="5" max="60" step="1" value="${settings.lowFuelPct}">
          <div class="stg-hint">Based on a ${TANK_CAPACITY} L tank. One email per drop below this level (re-arms after refuel).</div>
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-title">⚡ Overload Email Alert</div>
        <div class="stg-field">
          <div class="stg-label">Rated capacity
            <span class="stg-label-val"><input type="number" class="stg-num" id="numRatedKw" value="${settings.ratedKw}"> kW</span>
          </div>
        </div>
        <div class="stg-field">
          <div class="stg-label">Trigger when load exceeds
            <span class="stg-label-val" id="lblOverload">${settings.overloadPct}% (${Math.round(settings.overloadPct/100*settings.ratedKw)} kW)</span>
          </div>
          <input type="range" id="numOverloadSlider" min="50" max="120" step="1" value="${settings.overloadPct}">
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-title">🔧 Service Reminder</div>
        <div class="stg-field">
          <div class="stg-label">Remind every
            <span class="stg-label-val"><input type="number" class="stg-num" id="numServiceHrs" value="${settings.serviceIntervalHrs}"> h</span>
          </div>
          <div class="stg-hint">Based on cumulative PLC engine hours. Email sent once per service milestone crossed.</div>
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-title" style="justify-content:space-between;display:flex;align-items:center">
          <span>📧 Alert Recipients</span>
          <span class="stg-email-count" id="stgEmailCount">0</span>
        </div>
        <div class="stg-field">
          <div class="stg-email-add-row">
            <input type="text" class="stg-text-input" id="txtEmailNew" placeholder="name@company.com">
            <button type="button" class="stg-email-add-btn" id="btnEmailAdd">➕ Add</button>
          </div>
          <div class="stg-email-err" id="stgEmailErr"></div>
          <div class="stg-email-list" id="stgEmailList"></div>
          <div class="stg-hint">Add as many recipients as you need. All alerts (low fuel, overload, service due) go to every address listed here.</div>
        </div>
      </div>
    `;
  }

  // ── Dirty-state helpers ───────────────────────────────────────
  function markDirty() {
    isDirty = true;
    const banner  = document.getElementById('stgDirtyBanner');
    const saveBtn = document.getElementById('stgSaveBtn');
    if (banner)  banner.classList.add('show');
    if (saveBtn) saveBtn.classList.add('is-dirty');
  }
  function clearDirty() {
    isDirty = false;
    const banner  = document.getElementById('stgDirtyBanner');
    const saveBtn = document.getElementById('stgSaveBtn');
    if (banner)  banner.classList.remove('show');
    if (saveBtn) saveBtn.classList.remove('is-dirty');
  }

  // ── Email chip rendering ──────────────────────────────────────
  function renderEmailChips() {
    const listEl  = document.getElementById('stgEmailList');
    const countEl = document.getElementById('stgEmailCount');
    if (!listEl) return;
    countEl.textContent = emailList.length;

    if (emailList.length === 0) {
      listEl.innerHTML = '<div class="stg-email-empty">No recipients added yet — alerts won\'t be sent until you add one.</div>';
      return;
    }
    listEl.innerHTML = emailList.map((email, i) => `
      <div class="stg-email-chip">
        <span class="stg-email-chip-icon">📨</span>
        <span class="stg-email-chip-text">${email}</span>
        <button type="button" class="stg-email-chip-del" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.stg-email-chip-del').forEach(btn => {
      btn.addEventListener('click', () => {
        emailList.splice(parseInt(btn.dataset.idx, 10), 1);
        renderEmailChips();
        markDirty();
      });
    });
  }

  function wireEmailAdd() {
    const input  = document.getElementById('txtEmailNew');
    const addBtn = document.getElementById('btnEmailAdd');
    const errEl  = document.getElementById('stgEmailErr');
    if (!input || !addBtn || !errEl) return;

    function tryAdd() {
      const val = input.value.trim();
      errEl.textContent = '';
      if (!val) return;
      if (!isValidEmail(val)) {
        errEl.textContent = '⚠️ Enter a valid email address';
        return;
      }
      if (emailList.some(e => e.toLowerCase() === val.toLowerCase())) {
        errEl.textContent = '⚠️ That email is already in the list';
        return;
      }
      emailList.push(val);
      input.value = '';
      renderEmailChips();
      markDirty();
      input.focus();
    }

    addBtn.addEventListener('click', tryAdd);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });
  }

  // ── Wire up all form controls ─────────────────────────────────
  function wireFormEvents() {
    // Initialize email list + chips + add button right away (not tied to any slider)
    emailList = parseEmails(settings.alertEmails);
    renderEmailChips();
    wireEmailAdd();
    clearDirty();

    const refillSlider   = document.getElementById('numRefillSlider');
    const lowFuelSlider  = document.getElementById('numLowFuelSlider');
    const overloadSlider = document.getElementById('numOverloadSlider');
    const ratedKwInput   = document.getElementById('numRatedKw');
    const serviceHrsInput = document.getElementById('numServiceHrs');

    // Any change to any parameter marks the form dirty
    [refillSlider, lowFuelSlider, overloadSlider, ratedKwInput, serviceHrsInput]
      .forEach(el => { if (el) el.addEventListener('input', markDirty); });

    refillSlider.addEventListener('input', () => {
      document.getElementById('lblRefill').textContent = refillSlider.value + ' L';
    });

    function refreshLowFuelLabel() {
      const pct = parseInt(lowFuelSlider.value, 10);
      const l   = Math.round(pct / 100 * TANK_CAPACITY);
      document.getElementById('lblLowFuel').textContent = `${pct}% (${l} L)`;
    }
    lowFuelSlider.addEventListener('input', refreshLowFuelLabel);

    function refreshOverloadLabel() {
      const pct = parseInt(overloadSlider.value, 10);
      const kw  = Math.round(pct / 100 * (parseFloat(ratedKwInput.value) || DEFAULTS.ratedKw));
      document.getElementById('lblOverload').textContent = `${pct}% (${kw} kW)`;
    }
    overloadSlider.addEventListener('input', refreshOverloadLabel);
    ratedKwInput.addEventListener('input', refreshOverloadLabel);
  }

  function collectFormValues() {
    return {
      refillThresholdL:   parseInt(document.getElementById('numRefillSlider').value, 10) || DEFAULTS.refillThresholdL,
      lowFuelPct:         parseInt(document.getElementById('numLowFuelSlider').value, 10) || DEFAULTS.lowFuelPct,
      overloadPct:        parseInt(document.getElementById('numOverloadSlider').value, 10) || DEFAULTS.overloadPct,
      ratedKw:            parseFloat(document.getElementById('numRatedKw').value) || DEFAULTS.ratedKw,
      serviceIntervalHrs: parseInt(document.getElementById('numServiceHrs').value, 10) || DEFAULTS.serviceIntervalHrs,
      alertEmails:        emailList.join(',')
    };
  }

  // ── Open / close ──────────────────────────────────────────────
  function openSettings() {
    overlay.classList.add('open');
    if (authed) showSettingsForm();
    else showPasswordPrompt();
  }
  function closeSettings() {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Close without saving?');
      if (!ok) return;
    }
    overlay.classList.remove('open');
  }

  function showPasswordPrompt() {
    document.getElementById('stgTitle').textContent = 'Restricted Access';
    document.getElementById('stgFooter').style.display = 'none';
    document.getElementById('stgDirtyBanner').classList.remove('show');
    document.getElementById('stgBody').innerHTML = `
      <div class="stg-pw-screen">
        <div class="stg-pw-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <div class="stg-pw-heading">Genset Configuration Locked</div>
        <div class="stg-pw-sub">Enter the administrator password to access<br>alert thresholds and system settings.</div>

        <div class="stg-pw-field">
          <span class="stg-pw-field-icon">🔑</span>
          <input type="password" class="stg-pw-input" id="stgPwInput" placeholder="Enter password" autocomplete="off">
          <button type="button" class="stg-pw-toggle" id="stgPwToggle">👁️</button>
        </div>
        <div class="stg-pw-error" id="stgPwError"></div>

        <button class="stg-pw-btn" id="stgPwSubmit">
          <span id="stgPwBtnLabel">Unlock Settings</span>
        </button>

        <div class="stg-pw-footnote">🛡️ Access is restricted to authorized personnel</div>
      </div>
    `;

    const input  = document.getElementById('stgPwInput');
    const toggle = document.getElementById('stgPwToggle');
    const btn    = document.getElementById('stgPwSubmit');
    const errEl  = document.getElementById('stgPwError');

    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? '👁️' : '🙈';
    });

    const submit = () => {
      if (!input.value) {
        errEl.innerHTML = '⚠️ Please enter a password';
        errEl.classList.add('shake');
        setTimeout(() => errEl.classList.remove('shake'), 350);
        return;
      }
      verifyPassword(input.value, btn, errEl);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 80);
  }

  async function verifyPassword(pw, btn, errEl) {
    errEl.innerHTML = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="stg-spin"></span> Verifying…';
    try {
      const r = await fetch('/api/settings/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await r.json();
      if (data.ok) {
        authed = true;
        await loadSettings();
        showSettingsForm();
      } else {
        errEl.innerHTML = '❌ Incorrect password — please try again';
        errEl.classList.add('shake');
        setTimeout(() => errEl.classList.remove('shake'), 350);
        btn.disabled = false;
        btn.innerHTML = '<span id="stgPwBtnLabel">Unlock Settings</span>';
        document.getElementById('stgPwInput').value = '';
        document.getElementById('stgPwInput').focus();
      }
    } catch (e) {
      errEl.innerHTML = '⚠️ Could not reach server';
      btn.disabled = false;
      btn.innerHTML = '<span id="stgPwBtnLabel">Unlock Settings</span>';
    }
  }

  async function loadSettings() {
    try {
      const r = await fetch('/api/settings');
      if (r.ok) {
        const data = await r.json();
        settings = { ...DEFAULTS, ...data };
      }
    } catch (e) { console.warn('[Settings] load error:', e.message); }
  }

  function showSettingsForm() {
    document.getElementById('stgTitle').textContent = '⚙️ Genset Settings';
    document.getElementById('stgBody').innerHTML = buildSettingsForm();
    document.getElementById('stgFooter').style.display = 'flex';
    wireFormEvents();
    document.getElementById('stgSaveBtn').addEventListener('click', saveSettings);
  }

  async function saveSettings() {
    const btn = document.getElementById('stgSaveBtn');
    const originalLabel = '💾 Save Settings';
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const payload = collectFormValues();
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (data.ok) {
        settings = { ...settings, ...payload };
        clearDirty();
        const msg = document.getElementById('stgSavedMsg');
        if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
      } else {
        alert('Save failed: ' + (data.error || 'unknown error'));
      }
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = originalLabel;
  }

  document.getElementById('stgCloseBtn').addEventListener('click', closeSettings);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSettings(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeSettings(); });

  // ── Inject the gear button next to the Live badge ────────────
  function injectGearButton() {
    const liveBadge = document.getElementById('connBadge');
    if (!liveBadge || document.getElementById('stgGearBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'stgGearBtn';
    btn.innerHTML = '⚙️';
    btn.title = 'Settings';
    btn.addEventListener('click', openSettings);
    liveBadge.parentNode.insertBefore(btn, liveBadge.nextSibling);
  }

  function init() {
    injectGearButton();
    loadSettings(); // load defaults for display even before auth (used by refill card etc. if needed)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }

})();