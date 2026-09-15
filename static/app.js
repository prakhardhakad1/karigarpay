import { parseVoice } from '/static/voice.js';

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const app = $('#app');
const modal = $('#modal');
const state = { lang: 'en', session: null, route: '', data: {}, authMode: 'login', authRole: 'owner', generation: 0, filters: {}, installPrompt: null };
try { state.lang = localStorage.getItem('karigarpay-language') === 'hi' ? 'hi' : 'en'; } catch {}
let draft = null;
let photoFile = null;
let photoObjectURL = null;
let recognition = null;
let recognizing = false;
let voiceStopped = false;
let voiceStartTime = 0;
let voicePointer = false;
let confirmationAction = null;
let preview = null;
let busy = false;
const t = (en, hi) => state.lang === 'hi' && hi ? hi : en;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => new Intl.NumberFormat(state.lang === 'hi' ? 'hi-IN' : 'en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: n(value) % 1 ? 2 : 0 }).format(n(value));
const count = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n(value));
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(key => parts.find(x => x.type === key).value).join('-');
};
const dateLabel = (date, short = false) => {
  if (!date) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00+05:30` : date);
  if (Number.isNaN(d.getTime())) return esc(date);
  return new Intl.DateTimeFormat(state.lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) }).format(d);
};
const initials = name => String(name || 'K').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const uid = () => crypto.randomUUID();
const policy = worker => worker?.overtime_policy || state.session?.business?.overtime_policy || { mode: 'none' };
const modelLabel = model => ({ piece: t('Piece rate', 'प्रति इकाई'), daily: t('Daily wage', 'दैनिक वेतन'), monthly: t('Monthly salary', 'मासिक वेतन') }[model] || esc(model));
const statusLabel = status => ({ pending: t('In review', 'समीक्षा में'), approved: t('Approved', 'मंज़ूर'), rejected: t('Needs correction', 'सुधार चाहिए'), settled: t('Paid', 'भुगतान हुआ') }[status] || esc(status));
const attendanceLabel = a => ({ full: t('Full day', 'पूरा दिन'), half: t('Half day', 'आधा दिन'), absent: t('Absent', 'अनुपस्थित') }[a] || '—');
const statusChip = s => `<span class="chip ${s === 'pending' ? 'chip-amber' : s === 'rejected' ? 'chip-red' : ''}"><span class="dot"></span>${statusLabel(s)}</span>`;
const paths = {
  'layout-dashboard': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  'clipboard-check': '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V6"/><path d="M21 12h-6v5h6"/><path d="M17 14.5h.01"/>',
  'banknote': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  'list-checks': '<path d="m3 6 2 2 4-4m-6 13 2 2 4-4M13 6h8M13 17h8"/>',
  settings: '<path d="m9 3-1 3-3 1v4l-2 1 2 2v3l3 1 1 3h5l1-3 3-1 2-3-2-3V7l-3-1-1-3z"/><circle cx="11.5" cy="12" r="3"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  'check-check': '<path d="m2 12 4 4L16 6m-5 10 4 4L25 10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  'shield-check': '<path d="M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11Z"/><path d="m8 12 3 3 5-6"/>',
  'languages': '<path d="M3 5h12M9 3v2M5 5s1 7 8 10M13 5s-1 7-10 11m11 5 4-11 4 11m-7-3h6"/>',
  'building-2': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  'circle-help': '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h6"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  'circle-alert': '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  'refresh-cw': '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  'package': '<path d="m12 3 9 5-9 5-9-5zM3 8v10l9 4 9-4V8M12 13v9M7 5.8l10 5.4"/>',
  'pencil': '<path d="m16 3 5 5L8 21H3v-5zM14 5l5 5"/>',
  'archive': '<rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v14h14V7M10 11h4"/>',
  'key-round': '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/>',
  'eye': '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'camera': '<path d="M14 4h-4L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="13" r="4"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m21 15-5-5L5 21"/>',
  'download': '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/>',
  'printer': '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v8H6z"/>',
  'more-horizontal': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  'history': '<path d="M3 3v6h6"/><path d="M3 9a9 9 0 1 1 .3 7M12 7v5l4 2"/>',
  'sparkles': '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  'receipt': '<path d="M5 3 8 5l4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2zM8 9h8m-8 4h8m-8 4h4"/>',
  'wifi-off': '<path d="m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2M2 8.8A16 16 0 0 1 7 6m7 0a16 16 0 0 1 8 2.8M12 20h.01"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" data-lucide="${esc(name)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['circle-help']}</svg>`; }
function icons() { if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
function brand() { return `<div class="brand"><span class="brand-mark" aria-hidden="true">k<span>p</span></span><span>karigar<span class="brand-pay">pay</span><span class="brand-dot">.</span></span></div>`; }
function langButton() { return `<button class="language-btn" data-action="language" aria-label="${esc(t('Switch to Hindi', 'Switch to English'))}">${icon('languages')}<span>${state.lang === 'en' ? 'हिन्दी' : 'English'}</span></button>`; }
function toast(message, error = false) {
  const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.innerHTML = `${icon(error ? 'circle-alert' : 'circle-check')}<span>${esc(message)}</span>`;
  $('#toast-region').append(item); icons(); setTimeout(() => item.remove(), error ? 7000 : 4500);
}
function setSession(session) { state.session = session; state.data = {}; state.filters = {}; }
async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.session?.csrf_token) headers['X-CSRF-Token'] = state.session.csrf_token;
  let response;
  try { response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) }); }
  catch { throw new Error(t('Could not connect. Check your connection and try again. Nothing was submitted automatically.', 'कनेक्शन नहीं हो पाया। इंटरनेट जाँचें और फिर कोशिश करें। कुछ अपने-आप जमा नहीं किया गया।')); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : t('Something could not be saved. Please check your details.', 'जानकारी सेव नहीं हो सकी। कृपया विवरण जाँचें।'));
    error.status = response.status; error.code = data.code; error.fields = data.errors;
    if (response.status === 401 && state.session && !quiet) { clearPrivateState(); renderAuth(); }
    throw error;
  }
  return data;
}
function qs(params) { const values = Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null); return values.length ? `?${new URLSearchParams(values)}` : ''; }
function safeURL(value, type = 'local') {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, location.origin);
    if (type === 'local' && url.origin === location.origin && url.pathname.startsWith('/api/')) return url.href;
    if (type === 'whatsapp' && url.protocol === 'https:' && ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname)) return url.href;
    if (type === 'upi' && url.protocol === 'upi:' && url.hostname === 'pay') return value;
  } catch {}
  return '';
}
function formError(form, error) {
  let box = $('.form-error', form);
  if (!box) { box = document.createElement('div'); box.className = 'form-error'; box.setAttribute('role', 'alert'); form.prepend(box); }
  box.textContent = [error.message, ...(Array.isArray(error.fields) ? error.fields.map(f => `${f.field}: ${f.message}`) : [])].join(' ');
  box.scrollIntoView({ block: 'nearest' });
}
async function submitBusy(form, fn) {
  if (form.dataset.busy) return;
  form.dataset.busy = 'true';
  const buttons = $$('button[type="submit"]', form); buttons.forEach(b => { b.disabled = true; });
  const errorBox = $('.form-error', form); if (errorBox) errorBox.textContent = '';
  try { await fn(); } catch (error) { formError(form, error); }
  finally { delete form.dataset.busy; buttons.forEach(b => { b.disabled = form.dataset.stale === 'true'; }); }
}
function field(label, name, value = '', { type = 'text', required = false, hint = '', attrs = '', cls = '' } = {}) {
  return `<div class="field ${cls}"><label for="${esc(name)}">${label}</label><input id="${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>${hint ? `<small>${hint}</small>` : ''}</div>`;
}
function selectField(label, name, options, value, extra = '') { return `<div class="field"><label for="${esc(name)}">${label}</label><select id="${esc(name)}" name="${esc(name)}" ${extra}>${options.map(([id, text]) => `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`; }
function empty(title, text, symbol = 'clipboard-check', action = '', compact = false) { return `<div class="empty ${compact ? 'compact' : ''}"><div class="empty-icon">${icon(symbol, 'icon-lg')}</div><h3>${title}</h3><p>${text}</p>${action}</div>`; }
function actionButton(action, label, symbol = 'plus', attrs = '', style = '') { return `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${icon(symbol)}${label}</button>`; }
function openDialog(title, body, { subtitle = '', wide = false } = {}) {
  modal.className = wide ? 'dialog-wide' : '';
  modal.innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p class="dialog-subheading">${subtitle}</p>` : ''}</div><div class="row gap-sm">${langButton()}<button type="button" class="btn btn-ghost btn-icon" data-action="close-modal" aria-label="${t('Close dialog', 'बंद करें')}">${icon('x')}</button></div></div><div class="dialog-body">${body}</div>`;
  for (const control of $$('input[id],select[id],textarea[id]', modal)) {
    if ($$('[id]', app).some(el => el.id === control.id)) {
      const previous = control.id; control.id = `dialog-${previous}`;
      $$('label', modal).filter(label => label.htmlFor === previous).forEach(label => { label.htmlFor = control.id; });
    }
  }
  if (!modal.open) modal.showModal(); icons();
}
function closeDialog() {
  if ($('[data-busy="true"]', modal)) return;
  entryDateGeneration++;
  stopVoice();
  if (draft?.ownerEntry) { clearPhoto(); draft = null; }
  if (modal.open) modal.close();
  modal.innerHTML = ''; confirmationAction = null; dialogRender = null; preview = null;
}
function confirmDialog(title, text, action, label = t('Confirm', 'पुष्टि करें'), danger = false) {
  confirmationAction = action;
  dialogRender = () => openDialog(title, `<p>${text}</p><form id="confirm-form"><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">${t('Cancel', 'रद्द करें')}</button><button class="btn ${danger ? 'btn-danger' : ''}" type="submit">${label}</button></div></form>`);
  dialogRender();
}
function clearPhoto() { if (photoObjectURL) URL.revokeObjectURL(photoObjectURL); photoObjectURL = null; photoFile = null; }
function clearPrivateState() {
  stopVoice(); clearPhoto(); state.generation++; entryDateGeneration++;
  state.session = null; state.data = {}; state.filters = {};
  delete state.entryWorkers; delete state.entryTasks; delete state.entryDateContext;
  draft = null; preview = null; finishDialog();
}

function renderAuth() {
  document.documentElement.lang = state.lang;
  const register = state.authMode === 'register';
  app.innerHTML = `<div class="auth"><section class="auth-story"><div>${brand()}</div><div class="auth-copy"><span class="eyebrow">${t('MADE FOR THE HANDS THAT MAKE', 'मेहनत करने वाले हाथों के लिए')}</span><h1>${t('Good work deserves', 'हर मेहनत का')}<span>${t('a clear payday.', 'हिसाब साफ़।')}</span></h1><p>${t('From the first piece to the final payment. A simpler way to keep work and wages together.', 'पहले काम से आख़िरी भुगतान तक। काम और वेतन का हिसाब रखने का आसान तरीका।')}</p><div class="auth-illustration" aria-label="${t('Work to payment workflow', 'काम से भुगतान तक')}" ><div class="row between"><span class="eyebrow">${t('A BETTER WORKDAY', 'बेहतर काम का दिन')}</span>${icon('sparkles')}</div><div class="illustration-rule"></div>${[['mic', t('Say it. Record it.', 'बोलें। दर्ज करें।'), t('Daily work, in your own words', 'रोज़ का काम, अपने शब्दों में')], ['clipboard-check', t('Review it together.', 'मिलकर जाँचें।'), t('A shared record, no guesswork', 'साझा हिसाब, बिना अंदाज़े के')], ['wallet', t('Pay with clarity.', 'साफ़ हिसाब से भुगतान।'), t('Every rupee, accounted for', 'हर रुपये का हिसाब')]].map(([ic, title, text]) => `<div class="illustration-step"><div class="step-orb">${icon(ic)}</div><div><strong>${title}</strong><span>${text}</span></div></div>`).join('')}</div></div><footer>${icon('shield-check', 'icon-sm')}${t('Your workshop. Your people. Your records.', 'आपकी कार्यशाला। आपके लोग। आपका हिसाब।')}</footer></section><section class="auth-form-side"><div class="auth-mobile-brand">${brand()}</div><div class="auth-top">${langButton()}</div><main class="auth-form-wrap" id="main"><h2>${register ? t('A fresh start for your team.', 'अपनी टीम की नई शुरुआत।') : t('Welcome to your workday.', 'आपके काम के दिन में स्वागत है।')}</h2><p class="muted">${register ? t('Set up your business. Bring everyone together.', 'अपना व्यवसाय बनाएँ और टीम को साथ लाएँ।') : t('A little less paperwork. A lot more clarity.', 'कम कागज़ी काम। ज़्यादा साफ़ हिसाब।')}</p><div class="tabs" aria-label="${t('Account options', 'खाता विकल्प')}"><button class="tab ${!register ? 'active' : ''}" data-action="auth-mode" data-mode="login">${t('Sign in', 'साइन इन')}</button><button class="tab ${register ? 'active' : ''}" data-action="auth-mode" data-mode="register">${t('Create business', 'व्यवसाय बनाएँ')}</button></div><form id="auth-form"><div class="form-error" role="alert"></div>${register ? `${field(t('Business name', 'व्यवसाय का नाम'), 'name', '', { required: true, attrs: 'autocomplete="organization" maxlength="100" placeholder="e.g. Sharma Handicrafts"' })}${field(t('Your full name', 'आपका पूरा नाम'), 'owner_name', '', { required: true, attrs: 'autocomplete="name" maxlength="100"' })}${field(t('Mobile number', 'मोबाइल नंबर'), 'owner_phone', '', { type: 'tel', required: true, attrs: 'autocomplete="tel" inputmode="tel" maxlength="15" pattern="[+0-9 ]{10,15}"' })}` : `<div class="role-select" aria-label="${t('Sign in as', 'भूमिका चुनें')}"><button type="button" class="role-btn ${state.authRole === 'owner' ? 'active' : ''}" data-action="auth-role" data-role="owner" aria-pressed="${state.authRole === 'owner'}">${icon('building-2')}${t('Business owner', 'व्यवसाय मालिक')}</button><button type="button" class="role-btn ${state.authRole === 'worker' ? 'active' : ''}" data-action="auth-role" data-role="worker" aria-pressed="${state.authRole === 'worker'}">${icon('users')}${t('Team member', 'टीम सदस्य')}</button></div>${field(t('Business code', 'व्यवसाय कोड'), 'business_id', '', { required: true, hint: t('Use the code shared by your business owner.', 'अपने व्यवसाय मालिक से मिला कोड डालें।'), attrs: 'autocomplete="organization" autocapitalize="none" spellcheck="false" maxlength="80"' })}${field(t('Mobile number', 'मोबाइल नंबर'), 'phone', '', { required: true, type: 'tel', attrs: 'autocomplete="tel" inputmode="tel" maxlength="15" pattern="[+0-9 ]{10,15}"' })}`}
<div class="field"><label for="pin">${register ? t('Choose a 4-digit PIN', '4 अंक का PIN चुनें') : t('Your 4-digit PIN', 'आपका 4 अंक का PIN')}</label><div class="pin-wrap"><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="${register ? 'new-password' : 'current-password'}" required><button class="btn btn-ghost btn-icon" type="button" data-action="toggle-pin" data-target="pin" aria-label="${t('Show or hide PIN', 'PIN दिखाएँ या छिपाएँ')}">${icon('eye')}</button></div></div><button type="submit" class="btn btn-wide">${register ? t('Create my workspace', 'अपना कार्यस्थल बनाएँ') : t('Enter my workspace', 'कार्यस्थल खोलें')}${icon('arrow-right')}</button></form><p class="auth-fine">${register ? t('Your business code is created after registration. Share it with workers you add to your team.', 'पंजीकरण के बाद व्यवसाय कोड मिलेगा। इसे अपनी टीम के सदस्यों के साथ साझा करें।') : t('Forgot your PIN? Team members can ask their business owner to reset it.', 'PIN भूल गए? टीम सदस्य अपने व्यवसाय मालिक से रीसेट करवा सकते हैं।')}</p><div class="ledger-note">${icon('shield-check', 'icon-sm')}${t('Secure sign-in · Hindi & English · Made for mobile', 'सुरक्षित साइन इन · हिन्दी और English · मोबाइल के लिए')}</div></main></section></div>`;
  icons();
}
const ownerNav = () => [
  ['overview', 'layout-dashboard', t('Overview', 'अवलोकन')], ['review', 'clipboard-check', t('Review work', 'काम जाँचें')], ['workers', 'users', t('My team', 'मेरी टीम')], ['catalog', 'package', t('Work catalog', 'काम की सूची')], ['payroll', 'wallet', t('Payroll', 'वेतन')], ['advances', 'banknote', t('Advances', 'अग्रिम')], ['settings', 'settings', t('Settings', 'सेटिंग्स')]
];
const workerNav = () => [['home', 'layout-dashboard', t('My workday', 'मेरा काम')], ['history', 'history', t('My ledger', 'मेरा खाता')], ['slips', 'receipt', t('Payment slips', 'भुगतान पर्चियाँ')], ['settings', 'settings', t('My account', 'मेरा खाता विवरण')]];
function navigate(route) { if (state.route === route && location.hash === `#${route}`) loadRoute(); else location.hash = route; }
function renderShell() {
  const { user, business } = state.session;
  const owner = user.role === 'owner';
  const nav = owner ? ownerNav() : workerNav();
  const routeTitle = nav.find(x => x[0] === state.route)?.[2] || t('More', 'अन्य');
  const navHTML = nav.map(([route, symbol, title]) => `<a href="#${route}" class="nav-item ${state.route === route ? 'active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></a>`).join('');
  const bottomNav = owner ? [ownerNav()[0], ownerNav()[1], ownerNav()[2], ownerNav()[4], ['more', 'more-horizontal', t('More', 'अन्य')]] : workerNav();
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a href="#${owner ? 'overview' : 'home'}" aria-label="KarigarPay">${brand()}</a><div class="workspace-pill"><span class="workspace-avatar">${esc(initials(business.name))}</span><div><div class="workspace-name">${esc(business.name)}</div><small>${t('Your workspace', 'आपका कार्यस्थल')}</small></div></div><p class="nav-label">${t('WORKSPACE', 'कार्यस्थल')}</p><nav class="nav-list" aria-label="${t('Main navigation', 'मुख्य नेविगेशन')}">${navHTML}</nav><div class="sidebar-bottom"><a class="nav-item" href="#settings">${icon('circle-help')}<span>${t('Help & guidance', 'सहायता और जानकारी')}</span></a><button class="nav-item" data-action="logout" style="border:0;background:transparent;width:100%">${icon('log-out')}${t('Sign out', 'साइन आउट')}</button><p class="sidebar-note">${icon('shield-check', 'icon-sm')}${t('Every day, accounted for.', 'हर दिन का साफ़ हिसाब।')}</p></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb"><div class="mobile-brand hidden">${brand()}</div><span class="desktop-crumb">${esc(business.name)}</span><span class="desktop-crumb">/</span><strong class="desktop-crumb">${routeTitle}</strong></div><div class="topbar-actions"><button class="chip business-code" style="border:0;min-height:52px;cursor:pointer" data-action="copy-code" title="${t('Copy business code', 'व्यवसाय कोड कॉपी करें')}">${icon('building-2', 'icon-sm')}<span>${esc(business.id)}</span></button>${state.installPrompt ? `<button class="btn btn-ghost btn-icon" data-action="install" aria-label="${t('Install app', 'ऐप इंस्टॉल करें')}">${icon('download')}</button>` : ''}${langButton()}<a href="#settings" class="profile" aria-label="${t('Account settings', 'खाता सेटिंग्स')}"><span class="avatar">${esc(initials(user.name))}</span><span><span class="profile-name">${esc(user.name)}</span><span class="profile-role" style="display:block">${owner ? t('Business owner', 'व्यवसाय मालिक') : t('Team member', 'टीम सदस्य')}</span></span></a></div></header><div id="connection-status">${!navigator.onLine ? offlineHTML() : ''}</div><main id="main" class="content" tabindex="-1"></main></div><nav class="bottom-nav ${!owner ? 'worker-nav' : ''}" aria-label="${t('Mobile navigation', 'मोबाइल नेविगेशन')}">${bottomNav.map(([route, symbol, title]) => `<a href="#${route}" class="${state.route === route || (route === 'more' && ['catalog', 'advances', 'more'].includes(state.route)) ? 'active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></a>`).join('')}</nav></div>`;
  icons();
}
function offlineHTML() { return `<div class="offline-banner">${t('You are offline. Your records are not cached. Reconnect to load or save work.', 'आप ऑफ़लाइन हैं। रिकॉर्ड कैश में नहीं रखे जाते। देखने या सेव करने के लिए इंटरनेट जोड़ें।')}</div>`; }
function skeleton() { return '<div class="skeleton-page" role="status" aria-label="Loading"><div class="skeleton skeleton-title"></div><div class="skeleton-cards">' + '<div class="skeleton skeleton-card"></div>'.repeat(4) + '</div><div class="skeleton skeleton-main"></div></div>'; }
function pageHead(title, subtitle, actions = '', eyebrow = '') { return `<div class="page-head"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`; }
function dateChip() { return `<div class="date-chip">${icon('calendar', 'icon-sm')}${dateLabel(today(), true)}</div>`; }
async function loadRoute() {
  if (!state.session) return renderAuth();
  syncDraft(); stopVoice();
  const owner = state.session.user.role === 'owner';
  const valid = owner ? [...ownerNav().map(x => x[0]), 'more'] : workerNav().map(x => x[0]);
  const hash = location.hash.slice(1);
  state.route = valid.includes(hash) ? hash : owner ? 'overview' : 'home';
  const generation = ++state.generation;
  renderShell(); $('#main').innerHTML = skeleton();
  const f = state.filters[state.route] || {};
  try {
    let data = {};
    switch (state.route) {
      case 'overview': data = await api(`/dashboard${qs({ date: today() })}`); break;
      case 'workers': data = await api('/workers'); break;
      case 'catalog': data = await api('/tasks'); break;
      case 'review': {
        const [submissions, workers] = await Promise.all([api(`/submissions${qs({ status: f.status ?? 'pending', date: f.date ?? '', worker_id: f.worker_id ?? '', limit: 200 })}`), api('/workers')]);
        data = { ...submissions, workers: workers.items }; break;
      }
      case 'payroll': data = await api(`/payroll${qs(f)}`); break;
      case 'advances': {
        const [advances, workers] = await Promise.all([api(`/advances${qs(f)}`), api('/workers')]); data = { ...advances, workers: workers.items }; break;
      }
      case 'home': {
        const [dashboard, tasks] = await Promise.all([api('/worker/dashboard'), api('/tasks')]); data = { ...dashboard, tasks: tasks.items };
        if (!draft || draft.worker?.id !== dashboard.worker.id || draft.submitted) initDraft(dashboard.worker, dashboard.today_submission, tasks.items);
        else draft.catalog = tasks.items;
        break;
      }
      case 'history': {
        const [submissions, advances] = await Promise.all([api(`/submissions${qs({ ...f, limit: 200 })}`), api('/advances')]); data = { items: submissions.items, advances: advances.items }; break;
      }
      case 'slips': data = await api('/settlements'); break;
      case 'settings': {
        const business = await api('/business');
        state.session.business = business.business || business;
        data = { business: state.session.business }; break;
      }
    }
    if (generation !== state.generation || !state.session) return;
    state.data = data;
    const screens = { overview: renderOverview, workers: renderWorkers, catalog: renderCatalog, review: renderReview, payroll: renderPayroll, advances: renderAdvances, home: renderWorkerHome, history: renderHistory, slips: renderSlips, settings: renderSettings, more: renderMore };
    $('#main').innerHTML = `<div class="page-enter">${screens[state.route](data)}</div>`;
    icons();
    if (state.route === 'home') prepareEntry();
  } catch (error) {
    if (generation !== state.generation || !state.session) return;
    $('#main').innerHTML = `<div class="error-page"><div class="empty-icon">${icon('wifi-off')}</div><h2>${t('Let’s try that again.', 'फिर कोशिश करते हैं।')}</h2><p class="muted" style="margin:12px auto 24px;max-width:420px">${esc(error.message)}</p>${actionButton('refresh', t('Try again', 'फिर कोशिश करें'), 'refresh-cw')}</div>`;
    icons();
  }
}
function metric(title, value, foot, symbol, featured = false) { return `<section class="stat ${featured ? 'stat-featured' : ''}"><div class="stat-head"><span>${title}</span><span class="stat-icon">${icon(symbol, 'icon-sm')}</span></div><div class="stat-value number">${value}</div><div class="stat-foot">${foot}</div></section>`; }
function renderOverview(d) {
  const greeting = t('A good day to get things done.', 'आज काम को आगे बढ़ाएँ।');
  const week = Array.isArray(d.week) ? d.week : [];
  const max = Math.max(1, ...week.map(x => Math.max(n(x.work), n(x.overtime))));
  const weeklyWork = week.reduce((sum, x) => sum + n(x.work), 0), weeklyOT = week.reduce((sum, x) => sum + n(x.overtime), 0);
  const pending = d.pending_submissions || [];
  const chart = week.length ? `<div class="bar-chart" role="img" aria-label="${t('Last seven days of recorded wages and overtime', 'पिछले सात दिनों का काम और ओवरटाइम')}">${week.map(day => `<div class="bar-column ${day.date === today() ? 'today' : ''}" title="${esc(`${dateLabel(day.date, true)}: ${t('Work', 'काम')} ${money(day.work)}, ${t('Overtime', 'ओवरटाइम')} ${money(day.overtime)}`)}"><div class="bar-track"><div class="bar-pair"><span class="bar" style="height:${Math.max(1, n(day.work) / max * 95)}%"></span><span class="bar light" style="height:${Math.max(1, n(day.overtime) / max * 95)}%"></span></div></div><span class="bar-label">${new Intl.DateTimeFormat(state.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${day.date}T12:00:00+05:30`))}</span></div>`).join('')}</div>` : empty(t('A fresh week ahead', 'नए सप्ताह की शुरुआत'), t('Approved work will bring this chart to life.', 'मंज़ूर काम यहाँ चार्ट में दिखेगा।'), 'calendar', '', true);
  return `${pageHead(esc(t(`Hello, ${state.session.user.name.split(' ')[0]}.`, `नमस्ते, ${state.session.user.name.split(' ')[0]}।`)), greeting, dateChip() + actionButton('worker-add', t('Add team member', 'सदस्य जोड़ें'), 'plus'), t('YOUR WORKSHOP, AT A GLANCE', 'आपकी कार्यशाला, एक नज़र में'))}
<div class="welcome-banner"><div><h2>${n(d.worker_count) ? t('Small details. A stronger team.', 'साफ़ हिसाब। मज़बूत टीम।') : t('Your next chapter starts with your team.', 'अगली शुरुआत अपनी टीम के साथ।')}</h2><p>${n(d.worker_count) ? t('Keep work moving, review the day’s entries, and make every payday feel simple.', 'काम आगे बढ़ाएँ, रोज़ की एंट्री जाँचें और भुगतान को आसान बनाएँ।') : t('Add your first team member, share your business code, and start recording a fair day’s work.', 'पहला सदस्य जोड़ें, व्यवसाय कोड साझा करें और रोज़ के काम का साफ़ हिसाब शुरू करें।')}</p></div><div class="banner-art">${icon('sparkles')}</div></div>
<div class="stats-grid">${metric(t('Team members', 'टीम सदस्य'), count(d.worker_count), t('Your active workforce', 'आपकी सक्रिय टीम'), 'users')}${metric(t('Today’s work', 'आज का काम'), money(d.work_today), t('Base earnings recorded today', 'आज का दर्ज मूल वेतन'), 'banknote')}${metric(t('Awaiting review', 'समीक्षा बाकी'), count(d.pending_count), t('Entries that need your attention', 'आपकी समीक्षा के लिए एंट्री'), 'clipboard-check')}${metric(t('Outstanding wages', 'बाकी वेतन'), money(d.total_outstanding), t('Approved work, less advances', 'मंज़ूर काम, अग्रिम घटाकर'), 'wallet', true)}</div>
<div class="dashboard-grid"><div class="stack"><section class="panel"><div class="panel-head"><div><h2>${t('The week in work', 'इस सप्ताह का काम')}</h2><p>${t('A little progress, every day.', 'हर दिन, थोड़ी तरक्की।')}</p></div><div class="chart-legend"><span><i class="legend-dot"></i>${t('Work', 'काम')}</span><span><i class="legend-dot light"></i>${t('Overtime', 'ओवरटाइम')}</span></div></div><div class="panel-body"><div class="chart-summary"><div><strong>${money(weeklyWork)}</strong><span>${t('Work recorded this week', 'इस सप्ताह का दर्ज काम')}</span></div><div><strong style="color:#94a780">${money(weeklyOT)}</strong><span>${t('Overtime this week', 'इस सप्ताह का ओवरटाइम')}</span></div></div>${chart}</div><div class="panel-footer"><span>${icon('calendar', 'icon-sm')} ${t('Last 7 days', 'पिछले 7 दिन')}</span><a href="#review" class="link-btn">${t('View work entries', 'काम की एंट्री देखें')}${icon('arrow-right', 'icon-sm')}</a></div></section>
<section class="panel"><div class="panel-head"><div><h2>${t('Today, together', 'आज की टीम')}</h2><p>${t('Attendance from recorded daily and monthly work.', 'दैनिक और मासिक काम में दर्ज उपस्थिति।')}</p></div>${icon('users')}</div><div class="panel-body"><div class="row between wrap"><div><strong style="font-size:23px">${count(d.attendance?.full)}</strong><p class="small muted">${t('Full day', 'पूरा दिन')}</p></div><div><strong style="font-size:23px">${count(d.attendance?.half)}</strong><p class="small muted">${t('Half day', 'आधा दिन')}</p></div><div><strong style="font-size:23px">${count(d.attendance?.absent)}</strong><p class="small muted">${t('Absent', 'अनुपस्थित')}</p></div><div><strong style="font-size:23px">${money(d.overtime_today)}</strong><p class="small muted">${t('Overtime', 'ओवरटाइम')}</p></div></div></div></section></div>
<div class="stack"><section class="panel"><div class="panel-head"><div><h2>${t('Ready for your review', 'आपकी समीक्षा के लिए')}</h2><p>${t('A quick check makes a clear record.', 'एक जाँच, साफ़ हिसाब।')}</p></div><span class="chip chip-amber">${count(d.pending_count)}</span></div>${pending.length ? `<div class="queue-list">${pending.slice(0, 4).map(s => `<div class="queue-row"><span class="avatar">${esc(initials(s.worker_name))}</span><div class="queue-info"><strong>${esc(s.worker_name)}</strong><small>${dateLabel(s.work_date, true)} · ${s.items?.length ? `${count(s.items.length)} ${t('tasks', 'काम')}` : attendanceLabel(s.attendance)}</small></div><span class="queue-amount">${money(s.total)}</span><button class="btn btn-soft" data-action="review-entry" data-id="${esc(s.id)}">${t('Review', 'जाँचें')}</button></div>`).join('')}</div>` : empty(t('All caught up.', 'सब कुछ जाँच लिया गया।'), t('New work entries will appear here, ready for a quick review.', 'नई काम की एंट्री यहाँ समीक्षा के लिए दिखेंगी।'), 'circle-check', '', true)}<div class="panel-footer"><span>${t('Good records build trust.', 'साफ़ हिसाब, पक्का भरोसा।')}</span><a href="#review" class="link-btn">${t('View all', 'सभी देखें')}${icon('arrow-right', 'icon-sm')}</a></div></section>
<section class="panel"><div class="panel-head"><h2>${t('A little head start', 'काम आगे बढ़ाएँ')}</h2></div><div class="panel-body" style="padding-top:8px">${quickAction('worker-add', 'users', t('Grow your team', 'टीम बढ़ाएँ'), t('Add a worker and set their wage', 'सदस्य जोड़ें और वेतन तय करें'))}${quickAction('owner-entry', 'clipboard-check', t('Record a day’s work', 'एक दिन का काम दर्ज करें'), t('Add an entry for your team', 'टीम के लिए एंट्री जोड़ें'))}${quickAction('advance-add', 'banknote', t('Give an advance', 'अग्रिम दें'), t('Keep every payment in the ledger', 'हर भुगतान का हिसाब रखें'))}</div></section><div class="balance-card"><h3>${t('Next payroll check-in', 'अगला वेतन हिसाब')}</h3><strong style="font-size:21px">${dateLabel(d.payroll_due_on, true)}</strong><p>${t('Review work first. Settle wages when you’re ready.', 'पहले काम जाँचें। तैयार होने पर वेतन चुकाएँ।')}</p></div></div></div><p class="ledger-note">${icon('shield-check', 'icon-sm')}${t('Real work. Clear records. No payments happen automatically.', 'असली काम। साफ़ हिसाब। कोई भुगतान अपने-आप नहीं होता।')}</p>`;
}
function quickAction(action, symbol, title, subtitle) { return `<button type="button" class="quick-action" data-action="${action}" style="width:100%;text-align:left;background:none;border-width:0 0 1px"><span class="action-icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${subtitle}</small></span>${icon('chevron-right')}</button>`; }

function renderWorkers(d) {
  const workers = d.items || [];
  return `${pageHead(t('Good people. Great work.', 'अच्छे लोग। बेहतरीन काम।'), t('A place for everyone who keeps your workshop moving.', 'आपकी कार्यशाला को आगे बढ़ाने वाले हर व्यक्ति के लिए।'), actionButton('worker-add', t('Add team member', 'सदस्य जोड़ें'), 'plus'), t('MY TEAM', 'मेरी टीम'))}<div class="filters"><div class="search-wrap">${icon('search')}<input id="worker-search" type="search" placeholder="${t('Find a team member…', 'सदस्य खोजें…')}" aria-label="${t('Search team members', 'टीम सदस्य खोजें')}"></div><span class="chip">${count(workers.filter(w => w.active).length)} ${t('active members', 'सक्रिय सदस्य')}</span></div>${workers.length ? `<div class="worker-grid">${workers.map(w => `<article class="worker-card" data-worker-search="${esc(`${w.name} ${w.phone}`.toLowerCase())}"><div class="worker-card-top"><span class="avatar">${esc(initials(w.name))}</span><div style="min-width:0"><h3>${esc(w.name)}</h3><small>${esc(w.phone)}</small></div></div><span class="chip ${w.active ? '' : 'chip-gray'}">${w.active ? t('Active', 'सक्रिय') : t('Archived', 'संग्रहीत')}</span><div class="worker-card-details"><small>${modelLabel(w.payment_model)}</small><strong class="small">${w.payment_model === 'piece' ? t('Per task rate', 'काम की दर') : `${money(w.salary)} / ${w.payment_model === 'daily' ? t('day', 'दिन') : t('month', 'माह')}`}</strong></div><button class="btn btn-secondary card-action" data-action="worker-edit" data-id="${esc(w.id)}">${icon('pencil', 'icon-sm')}${t('Manage member', 'सदस्य प्रबंधन')}</button></article>`).join('')}</div><div id="worker-no-results" class="hidden">${empty(t('No matching team member', 'कोई सदस्य नहीं मिला'), t('Try a different name or phone number.', 'दूसरा नाम या मोबाइल नंबर खोजें।'), 'search')}</div>` : `<section class="panel">${empty(t('Good work starts with good people.', 'अच्छे लोगों से अच्छा काम शुरू होता है।'), t('Add your first team member and set how they earn — by the piece, day or month.', 'पहला सदस्य जोड़ें। प्रति इकाई, दैनिक या मासिक वेतन तय करें।'), 'users', actionButton('worker-add', t('Add your first member', 'पहला सदस्य जोड़ें')))}</section>`}<div class="notice" style="margin-top:22px">${icon('key-round')}<div>${t('Workers sign in with your business code, their mobile number and the PIN you set. Share these privately.', 'सदस्य व्यवसाय कोड, मोबाइल नंबर और आपके तय PIN से साइन इन करते हैं। इन्हें निजी रूप से साझा करें।')}<br><strong>${t('Business code', 'व्यवसाय कोड')}: ${esc(state.session.business.id)}</strong></div></div>`;
}
function renderCatalog(d) {
  const tasks = d.items || [];
  return `${pageHead(t('Every task has its worth.', 'हर काम की अपनी कीमत।'), t('Set clear rates. Give your team a shared vocabulary.', 'साफ़ दरें तय करें। टीम के लिए काम के नाम जोड़ें।'), actionButton('task-add', t('Add a task', 'काम जोड़ें')), t('WORK CATALOG', 'काम की सूची'))}<div class="notice" style="margin-bottom:23px">${icon('mic')}<div>${t('Add Hindi or English aliases so voice entries recognise your workshop’s words. Rates apply to new entries; approved history stays unchanged.', 'हिन्दी या English के अन्य नाम जोड़ें ताकि आवाज़ से काम पहचाना जा सके। नई दरें नई एंट्री पर लागू होंगी; मंज़ूर इतिहास नहीं बदलेगा।')}</div></div><section class="panel">${tasks.length ? tasks.map(task => `<div class="catalog-row"><span class="catalog-symbol">${icon('package')}</span><div class="catalog-copy"><div class="row gap-sm wrap"><h3>${esc(task.name)}</h3>${!task.active ? `<span class="chip chip-gray">${t('Archived', 'संग्रहीत')}</span>` : ''}</div><p>${task.aliases?.length ? `${t('Also called', 'अन्य नाम')}: ${task.aliases.map(esc).join(' · ')}` : t('Add aliases to make voice entry easier', 'आवाज़ से एंट्री आसान बनाने के लिए अन्य नाम जोड़ें')}</p></div><div class="catalog-price">${money(task.rate)}<small>${t('per', 'प्रति')} ${esc(task.unit)}</small></div><button class="btn btn-ghost btn-icon" data-action="task-edit" data-id="${esc(task.id)}" aria-label="${esc(`${t('Edit', 'बदलें')} ${task.name}`)}">${icon('pencil')}</button></div>`).join('') : empty(t('Give each task a name.', 'हर काम को नाम दें।'), t('Create your first task and set a rate your whole team can see.', 'पहला काम बनाएँ और सबके लिए दर तय करें।'), 'package', actionButton('task-add', t('Add a task', 'काम जोड़ें')))}</section>`;
}
function submissionText(s) { return s.items?.length ? s.items.map(i => `${count(i.quantity)} ${esc(i.unit)} ${esc(i.name)}`).join(' · ') : attendanceLabel(s.attendance); }
function reviewCard(s) {
  return `<article class="panel review-card"><div class="row between wrap"><div class="person-cell"><span class="avatar">${esc(initials(s.worker_name))}</span><div><strong>${esc(s.worker_name)}</strong><small>${dateLabel(s.work_date)} · ${modelLabel(s.payment_model)}</small></div></div>${statusChip(s.settlement_id ? 'settled' : s.status)}</div><div class="review-body"><div style="flex:1;min-width:150px"><small>${t('WORK RECORDED', 'दर्ज काम')}</small><strong>${submissionText(s)}</strong></div><div><small>${t('OVERTIME', 'ओवरटाइम')}</small><strong>${count(s.ot_hours)} ${t('hrs', 'घंटे')}</strong></div><div><small>${t('TOTAL EARNINGS', 'कुल कमाई')}</small><strong>${money(s.total)}</strong></div></div>${s.note ? `<p class="submission-note">${icon('file-text', 'icon-sm')} ${esc(s.note)}</p>` : ''}${s.review_note ? `<div class="notice notice-amber" style="margin-bottom:16px">${icon('circle-alert')}<span>${esc(s.review_note)}</span></div>` : ''}<div class="review-actions"><button class="btn btn-secondary" data-action="view-entry" data-id="${esc(s.id)}">${icon('file-text')}${t('Details', 'विवरण')}</button>${s.status === 'pending' && !s.settlement_id ? `<button class="btn" data-action="review-entry" data-id="${esc(s.id)}">${icon('clipboard-check')}${t('Review entry', 'एंट्री जाँचें')}</button>` : ''}</div></article>`;
}
function renderReview(d) {
  const f = state.filters.review || {};
  const items = d.items || [];
  return `${pageHead(t('A quick check. A fair record.', 'एक जाँच। सही हिसाब।'), t('Review the work before it becomes part of payroll.', 'वेतन में जोड़ने से पहले काम की जाँच करें।'), actionButton('approve-all', t('Approve a day', 'दिन का काम मंज़ूर करें'), 'check-check', '', 'btn-secondary'), t('WORK REVIEW', 'काम की समीक्षा'))}<form id="review-filters" class="filters">${field(t('Work date', 'काम की तारीख'), 'date', f.date || '', { type: 'date' })}${selectField(t('Status', 'स्थिति'), 'status', [['pending', t('Needs review', 'समीक्षा बाकी')], ['', t('All statuses', 'सभी स्थितियाँ')], ['approved', t('Approved', 'मंज़ूर')], ['rejected', t('Needs correction', 'सुधार चाहिए')]], f.status ?? 'pending')}${selectField(t('Team member', 'टीम सदस्य'), 'worker_id', [['', t('Everyone', 'सभी')], ...(d.workers || []).map(w => [w.id, w.name])], f.worker_id || '')}<button type="submit" class="btn btn-secondary">${icon('search')}${t('Show entries', 'एंट्री दिखाएँ')}</button></form>${items.length ? items.map(reviewCard).join('') : `<section class="panel">${empty(t('Nothing waiting here.', 'यहाँ कोई एंट्री बाकी नहीं है।'), t('Entries matching these filters will appear here. Try another date or status.', 'इन फ़िल्टर की एंट्री यहाँ दिखेंगी। दूसरी तारीख या स्थिति चुनें।'), 'circle-check')}</section>`}<p class="ledger-note">${t('Approved entries cannot be edited. Check quantities, attendance and overtime carefully.', 'मंज़ूर एंट्री बदली नहीं जा सकतीं। मात्रा, उपस्थिति और ओवरटाइम ध्यान से जाँचें।')}</p>`;
}
function renderPayroll(d) {
  const rows = d.rows || [];
  return `${pageHead(t('Payday, without the guesswork.', 'भुगतान, बिना अंदाज़े के।'), t('Clear earnings. Clear deductions. A fair finish.', 'साफ़ कमाई। साफ़ कटौती। सही भुगतान।'), dateChip() + actionButton('settlement-history', t('Payment history', 'भुगतान इतिहास'), 'history', '', 'btn-secondary'), t('PAYROLL', 'वेतन'))}<form id="payroll-filters" class="filters">${field(t('Cycle starts', 'अवधि शुरू'), 'start', d.start, { type: 'date', required: true })}${field(t('Include work through', 'इस तारीख तक का काम'), 'end', d.end, { type: 'date', required: true, attrs: `max="${today()}"` })}<button type="submit" class="btn btn-secondary">${icon('refresh-cw')}${t('Update payroll', 'हिसाब अपडेट करें')}</button></form><div class="payroll-total"><div><span class="eyebrow">${t('NET UNSETTLED BALANCE', 'बाकी कुल शुद्ध हिसाब')}</span><h2>${money(d.totals?.net)}</h2><p>${dateLabel(d.start, true)} — ${dateLabel(d.end, true)} · ${t('Includes earlier unpaid balances', 'पहले का बाकी हिसाब शामिल है')}</p></div><div class="row" style="gap:30px"><div><p>${t('Base earnings', 'मूल कमाई')}</p><strong>${money(d.totals?.base)}</strong></div><div><p>${t('Overtime', 'ओवरटाइम')}</p><strong>${money(d.totals?.overtime)}</strong></div><div><p>${t('Advances', 'अग्रिम')}</p><strong>− ${money(d.totals?.advances)}</strong></div></div></div><section class="panel">${rows.length ? `<div class="table-wrap"><table class="responsive"><thead><tr><th>${t('Team member', 'सदस्य')}</th><th>${t('Base pay', 'मूल वेतन')}</th><th>${t('Overtime', 'ओवरटाइम')}</th><th>${t('Advances', 'अग्रिम')}</th><th>${t('Net balance', 'शुद्ध हिसाब')}</th><th>${t('Action', 'कार्य')}</th></tr></thead><tbody>${rows.map(r => `<tr><td data-label="${t('Member', 'सदस्य')}"><div class="person-cell"><span class="avatar">${esc(initials(r.worker.name))}</span><div><strong>${esc(r.worker.name)}</strong><small>${n(r.pending_count) ? `${count(r.pending_count)} ${t('entries need review', 'एंट्री की समीक्षा बाकी')}` : modelLabel(r.worker.payment_model)}</small></div></div></td><td data-label="${t('Base pay', 'मूल वेतन')}">${money(r.base)}</td><td data-label="${t('Overtime', 'ओवरटाइम')}">${money(r.overtime)}</td><td data-label="${t('Advances', 'अग्रिम')}">− ${money(r.advances)}</td><td data-label="${t('Net balance', 'शुद्ध हिसाब')}"><strong>${money(r.net)}</strong>${n(r.net) < 0 ? `<small class="muted" style="display:block">${t('Advance carry-forward', 'अग्रिम आगे जाएगा')}</small>` : ''}</td><td><button class="btn ${n(r.pending_count) ? 'btn-secondary' : 'btn-soft'}" data-action="pay-preview" data-id="${esc(r.worker.id)}">${t('View breakdown', 'हिसाब देखें')}${icon('chevron-right', 'icon-sm')}</button></td></tr>`).join('')}</tbody></table></div>` : empty(t('Your next payday starts here.', 'अगले भुगतान की शुरुआत यहाँ।'), t('Add your team and approve their work to build a payroll ledger.', 'टीम जोड़ें और काम मंज़ूर करें, ताकि वेतन का हिसाब बने।'), 'wallet', actionButton('worker-add', t('Add a team member', 'सदस्य जोड़ें')))}</section><div class="notice" style="margin-top:23px">${icon('shield-check')}<div>${t('The date range labels the cycle, but all earlier unsettled approved work and advances up to the end date are included. Negative balances carry forward; they are not payments. KarigarPay never verifies a bank transaction.', 'तारीखें वेतन अवधि दिखाती हैं, लेकिन अंतिम तारीख तक का पहले से बाकी मंज़ूर काम और अग्रिम भी शामिल है। ऋणात्मक राशि आगे जाती है; वह भुगतान नहीं है। KarigarPay बैंक लेनदेन सत्यापित नहीं करता।')}</div></div>`;
}
function renderAdvances(d) {
  const items = d.items || [];
  const outstanding = items.filter(a => !a.voided && !a.settlement_id).reduce((sum, a) => sum + n(a.amount), 0);
  return `${pageHead(t('A helping hand, on record.', 'मदद का हाथ, हिसाब के साथ।'), t('Keep advances visible. Make payday deductions clear.', 'अग्रिम का हिसाब रखें और वेतन की कटौती साफ़ रखें।'), actionButton('advance-add', t('Record an advance', 'अग्रिम दर्ज करें'), 'plus'), t('ADVANCES', 'अग्रिम'))}<div class="welcome-banner"><div><p class="eyebrow">${t('OUTSTANDING ADVANCES', 'बाकी अग्रिम')}</p><h2 style="font-size:30px;margin-top:8px">${money(outstanding)}</h2><p>${t('Deducted when the related wage ledger is settled.', 'वेतन का हिसाब चुकाते समय कटौती की जाएगी।')}</p></div><div class="banner-art">${icon('banknote')}</div></div><form id="advance-filters" class="filters">${selectField(t('Team member', 'टीम सदस्य'), 'worker_id', [['', t('Everyone', 'सभी')], ...(d.workers || []).map(w => [w.id, w.name])], state.filters.advances?.worker_id || '')}<button class="btn btn-secondary" type="submit">${t('Show advances', 'अग्रिम दिखाएँ')}</button></form><section class="panel">${items.length ? `<div class="table-wrap"><table class="responsive"><thead><tr><th>${t('Member', 'सदस्य')}</th><th>${t('Date', 'तारीख')}</th><th>${t('Amount', 'राशि')}</th><th>${t('Note', 'नोट')}</th><th>${t('Status', 'स्थिति')}</th><th></th></tr></thead><tbody>${items.map(a => `<tr><td><strong>${esc(a.worker_name)}</strong></td><td data-label="${t('Date', 'तारीख')}">${dateLabel(a.date, true)}</td><td data-label="${t('Amount', 'राशि')}"><strong>${money(a.amount)}</strong></td><td data-label="${t('Note', 'नोट')}" style="white-space:normal;max-width:260px;overflow-wrap:anywhere">${esc(a.note || '—')}</td><td data-label="${t('Status', 'स्थिति')}"><span class="chip ${a.voided ? 'chip-gray' : a.settlement_id ? '' : 'chip-amber'}">${a.voided ? t('Voided', 'रद्द') : a.settlement_id ? t('Adjusted', 'समायोजित') : t('Outstanding', 'बाकी')}</span></td><td>${!a.voided && !a.settlement_id ? `<button class="btn btn-ghost" data-action="advance-void" data-id="${esc(a.id)}">${t('Void entry', 'एंट्री रद्द करें')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty(t('No advances recorded.', 'अभी कोई अग्रिम नहीं।'), t('When you give a team member an advance, record it here to keep the ledger fair.', 'सदस्य को अग्रिम देने पर यहाँ दर्ज करें ताकि हिसाब साफ़ रहे।'), 'banknote', actionButton('advance-add', t('Record an advance', 'अग्रिम दर्ज करें')))}</section>`;
}
function renderMore() { return `${pageHead(t('Everything in its place.', 'हर चीज़ अपनी जगह।'), t('The tools behind a well-run workshop.', 'कार्यशाला को आसानी से चलाने के साधन।'))}<div class="more-grid">${ownerNav().filter(x => ['catalog', 'advances', 'settings'].includes(x[0])).map(([route, symbol, title]) => `<a href="#${route}">${icon(symbol)}${title}</a>`).join('')}<button class="btn btn-secondary" data-action="logout">${icon('log-out')}${t('Sign out', 'साइन आउट')}</button></div>`; }
function overtimeFields(p = {}, prefix = 'ot') {
  return `<div class="policy-fields">${selectField(t('Overtime calculation', 'ओवरटाइम की गणना'), `${prefix}_mode`, [['hourly', t('Fixed hourly rate', 'प्रति घंटे तय दर')], ['multiplier', t('Wage multiplier', 'वेतन का गुणक')], ['shift', t('Half / full shift', 'आधी / पूरी शिफ्ट')], ['flat', t('Flat amount per day', 'प्रतिदिन तय राशि')], ['none', t('No overtime pay', 'ओवरटाइम भुगतान नहीं')]], p.mode || 'none')}${field(t('Hourly rate / reference (₹)', 'प्रति घंटे दर / आधार (₹)'), `${prefix}_hourly_rate`, n(p.hourly_rate), { type: 'number', attrs: 'min="0" max="1000000" step="0.01"' })}${field(t('Wage multiplier', 'वेतन का गुणक'), `${prefix}_multiplier`, p.multiplier ?? 1.5, { type: 'number', attrs: 'min="0" max="10" step="0.01"' })}${field(t('Half shift, 4 hours (₹)', 'आधी शिफ्ट, 4 घंटे (₹)'), `${prefix}_half_shift_rate`, n(p.half_shift_rate), { type: 'number', attrs: 'min="0" max="1000000" step="0.01"' })}${field(t('Full shift, 8 hours (₹)', 'पूरी शिफ्ट, 8 घंटे (₹)'), `${prefix}_full_shift_rate`, n(p.full_shift_rate), { type: 'number', attrs: 'min="0" max="1000000" step="0.01"' })}${field(t('Flat daily OT amount (₹)', 'प्रतिदिन तय ओवरटाइम (₹)'), `${prefix}_flat_rate`, n(p.flat_rate), { type: 'number', attrs: 'min="0" max="1000000" step="0.01"' })}</div>`;
}
function readPolicy(data, prefix = 'ot') { return { mode: data.get(`${prefix}_mode`), hourly_rate: n(data.get(`${prefix}_hourly_rate`)), multiplier: n(data.get(`${prefix}_multiplier`)), half_shift_rate: n(data.get(`${prefix}_half_shift_rate`)), full_shift_rate: n(data.get(`${prefix}_full_shift_rate`)), flat_rate: n(data.get(`${prefix}_flat_rate`)) }; }
function renderSettings(d) {
  const b = d.business, owner = state.session.user.role === 'owner';
  const help = `<section class="panel settings-section"><h2>${t('A little clarity goes a long way.', 'थोड़ी जानकारी, साफ़ हिसाब।')}</h2><div class="help-item"><h3>${t('Monthly salary & the divisor', 'मासिक वेतन और भाजक')}</h3><p>${t('Daily base = monthly salary ÷ divisor. The default is 26 working days, not the number of calendar days. Half attendance earns half the daily base. Agree on the divisor with your team before recording work.', 'दैनिक मूल वेतन = मासिक वेतन ÷ भाजक। डिफ़ॉल्ट 26 कामकाजी दिन हैं, कैलेंडर के दिन नहीं। आधी उपस्थिति पर आधा दैनिक वेतन मिलता है। काम दर्ज करने से पहले टीम के साथ भाजक तय करें।')}</p></div><div class="help-item"><h3>${t('How overtime works', 'ओवरटाइम कैसे जुड़ता है')}</h3><p>${t('Hourly: hours × rate. Multiplier: hours × hourly wage × multiplier (daily wage ÷ 8; monthly salary ÷ divisor ÷ 8). Piece workers use the policy’s hourly reference. Shift: only 4-hour blocks, with half/full shift rates. Flat: one fixed amount when any overtime is worked. A worker override takes priority.', 'प्रति घंटा: घंटे × दर। गुणक: घंटे × प्रति घंटे वेतन × गुणक (दैनिक वेतन ÷ 8; मासिक वेतन ÷ भाजक ÷ 8)। प्रति इकाई सदस्यों के लिए नीति का प्रति घंटे आधार। शिफ्ट: केवल 4 घंटे के भाग। तय राशि: ओवरटाइम होने पर एक बार। सदस्य की अपनी नीति को प्राथमिकता मिलती है।')}</p></div><div class="help-item"><h3>${t('Payment is manually verified', 'भुगतान आप सत्यापित करते हैं')}</h3><p>${t('A QR code or UPI button only opens a payment intent. It does not prove money was transferred. Check your payment app or cash handover before marking paid. UPI payments need a reference. WhatsApp opens only when you choose it and never sends automatically.', 'QR कोड या UPI बटन केवल भुगतान खोलता है, पैसे पहुँचने की पुष्टि नहीं करता। भुगतान पूरा अंकित करने से पहले बैंक ऐप या नकद देना जाँचें। UPI में संदर्भ नंबर ज़रूरी है। WhatsApp केवल आपके चुनने पर खुलता है, संदेश अपने-आप नहीं जाता।')}</p></div><div class="help-item"><h3>${t('Your records stay private', 'आपका हिसाब निजी है')}</h3><p>${t('PIN sessions use a protected cookie. Phone numbers, wages and photos are not stored in browser local storage. Offline work cannot be submitted. Camera photos are optional; speech recognition depends on your browser.', 'PIN सत्र सुरक्षित कुकी से चलता है। मोबाइल नंबर, वेतन और फ़ोटो ब्राउज़र लोकल स्टोरेज में नहीं रखे जाते। ऑफ़लाइन काम जमा नहीं किया जा सकता। फ़ोटो वैकल्पिक है; आवाज़ की सुविधा ब्राउज़र पर निर्भर है।')}</p></div></section>`;
  return `${pageHead(t('Your workshop, your way.', 'आपकी कार्यशाला, आपके तरीके से।'), t('Set the details that keep everyone on the same page.', 'ज़रूरी जानकारी तय करें ताकि सबका हिसाब एक हो।'), actionButton('logout', t('Sign out', 'साइन आउट'), 'log-out', '', 'btn-secondary'), t('SETTINGS & GUIDANCE', 'सेटिंग्स और जानकारी'))}<div class="settings-grid"><div class="stack"><section class="panel settings-section"><h2>${owner ? t('Business details', 'व्यवसाय की जानकारी') : t('Your account', 'आपका खाता')}</h2><p>${t('Business code', 'व्यवसाय कोड')}: <strong>${esc(b.id)}</strong></p>${owner ? `<form id="business-form" class="stack"><div class="form-error" role="alert"></div>${field(t('Business name', 'व्यवसाय का नाम'), 'name', b.name, { required: true, attrs: 'maxlength="100"' })}${field(t('Owner name', 'मालिक का नाम'), 'owner_name', b.owner_name, { required: true, attrs: 'maxlength="100"' })}${field(t('Registered phone (read-only)', 'पंजीकृत मोबाइल (बदला नहीं जा सकता)'), 'owner_phone', b.owner_phone, { attrs: 'readonly' })}<div class="form-grid">${selectField(t('Settlement cycle', 'भुगतान अवधि'), 'settlement_cycle', [['weekly', t('Weekly', 'साप्ताहिक')], ['monthly', t('Monthly', 'मासिक')]], b.settlement_cycle)}${field(t('Monthly salary divisor', 'मासिक वेतन भाजक'), 'salary_divisor', b.salary_divisor ?? 26, { type: 'number', required: true, attrs: 'min="1" max="31" step="1"', hint: t('Default: 26 working days.', 'डिफ़ॉल्ट: 26 कामकाजी दिन।') })}</div><div><h3 style="margin-bottom:12px">${t('Default overtime policy', 'डिफ़ॉल्ट ओवरटाइम नीति')}</h3>${overtimeFields(b.overtime_policy)}</div><p class="small muted">${t('Changes apply to new or edited entries. Already approved wages remain unchanged.', 'बदलाव नई या बदली हुई एंट्री पर लागू होंगे। पहले से मंज़ूर वेतन नहीं बदलेगा।')}</p><button type="submit" class="btn">${t('Save business settings', 'व्यवसाय सेटिंग्स सेव करें')}</button></form>` : `<div class="stack"><div><span class="small muted">${t('Name', 'नाम')}</span><h3>${esc(state.session.user.name)}</h3></div><div><span class="small muted">${t('Mobile', 'मोबाइल')}</span><h3>${esc(state.session.user.phone)}</h3></div><div><span class="small muted">${t('Business', 'व्यवसाय')}</span><h3>${esc(b.name)}</h3></div><div class="notice">${icon('users')}<p>${t('Ask your business owner to update your wage, UPI ID or other account details.', 'वेतन, UPI ID या खाते की जानकारी बदलने के लिए व्यवसाय मालिक से कहें।')}</p></div></div>`}</section><section class="panel settings-section"><h2>${t('Keep your PIN private.', 'अपना PIN निजी रखें।')}</h2><p>${t('Use four digits you can remember. Do not share your PIN.', 'याद रहने वाले चार अंक चुनें। PIN साझा न करें।')}</p><form id="pin-form" class="stack"><div class="form-error" role="alert"></div>${field(t('Current PIN', 'मौजूदा PIN'), 'old_pin', '', { type: 'password', required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password"' })}${field(t('New 4-digit PIN', 'नया 4 अंक का PIN'), 'new_pin', '', { type: 'password', required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password"' })}${field(t('Confirm new PIN', 'नया PIN दोबारा डालें'), 'confirm_pin', '', { type: 'password', required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password"' })}<button type="submit" class="btn btn-secondary">${icon('key-round')}${t('Change PIN', 'PIN बदलें')}</button></form></section>${owner ? `<section class="panel settings-section"><div class="row between"><div><h2>${t('Activity trail', 'गतिविधि रिकॉर्ड')}</h2><p class="small muted">${t('Who changed what, and when.', 'किसने क्या बदला और कब।')}</p></div>${actionButton('audit-load', t('View', 'देखें'), 'history', '', 'btn-secondary')}</div><div id="audit-list"></div></section>` : ''}</div>${help}</div>`;
}

function initDraft(worker, existing = null, catalog = [], workDate = today(), ownerEntry = false) {
  clearPhoto();
  draft = { worker, catalog, id: existing?.id || null, work_date: existing?.work_date || workDate, items: existing?.items?.length ? existing.items.map(i => ({ task_id: i.task_id, quantity: i.quantity })) : worker.payment_model === 'piece' && catalog.some(c => c.active) ? [{ task_id: catalog.find(c => c.active).id, quantity: '' }] : [], attendance: existing?.attendance || (worker.payment_model === 'piece' ? null : 'full'), ot_hours: existing?.ot_hours || 0, note: existing?.note || '', photo_id: existing?.photo_id || null, photo_url: existing?.photo_url || '', status: existing?.status || null, settlement_id: existing?.settlement_id || null, review_note: existing?.review_note || '', request_id: uid(), ownerEntry, submitted: false };
}
function draftLocked() { return draft && (draft.status === 'approved' || !!draft.settlement_id); }
function estimate() {
  if (!draft) return { base: 0, overtime: 0, total: 0 };
  const w = draft.worker;
  let base = 0;
  if (w.payment_model === 'piece') base = draft.items.reduce((sum, item) => sum + n(item.quantity) * n(draft.catalog.find(c => String(c.id) === String(item.task_id))?.rate), 0);
  else { const daily = n(w.salary) / (w.payment_model === 'monthly' ? n(state.session.business.salary_divisor) || 26 : 1); base = daily * (draft.attendance === 'full' ? 1 : draft.attendance === 'half' ? .5 : 0); }
  const p = policy(w), hours = n(draft.ot_hours);
  let overtime = 0;
  if (p.mode === 'hourly') overtime = hours * n(p.hourly_rate);
  if (p.mode === 'multiplier') {
    const hourly = w.payment_model === 'piece' ? n(p.hourly_rate) : n(w.salary) / (w.payment_model === 'monthly' ? n(state.session.business.salary_divisor) || 26 : 1) / 8;
    overtime = hours * hourly * n(p.multiplier);
  }
  if (p.mode === 'shift') overtime = Math.floor(hours / 8) * n(p.full_shift_rate) + (hours % 8 >= 4 ? n(p.half_shift_rate) : 0);
  if (p.mode === 'flat' && hours > 0) overtime = n(p.flat_rate);
  return { base, overtime, total: base + overtime };
}
function syncDraft(form = $('#entry-form')) {
  if (!draft || !form) return;
  const fd = new FormData(form);
  if (!draft.id) draft.work_date = fd.get('work_date') || draft.work_date;
  draft.transcript = String(fd.get('transcript') ?? draft.transcript ?? '');
  draft.attendance = fd.get('attendance') || null;
  draft.ot_hours = n(fd.get('ot_hours'));
  draft.note = String(fd.get('note') || '');
  draft.items = $$('.entry-item', form).map(row => ({ task_id: $('[name="task_id"]', row).value, quantity: $('[name="quantity"]', row).value }));
}
function updateEstimate() {
  const e = estimate();
  const target = $('#live-total'); if (target) target.textContent = money(e.total);
  const detail = $('#live-breakdown'); if (detail) detail.textContent = `${t('Work', 'काम')} ${money(e.base)} + ${t('OT', 'ओवरटाइम')} ${money(e.overtime)}`;
}
function entryItemsHTML() {
  return draft.items.map((item, idx) => `<div class="entry-item" data-index="${idx}"><div class="field"><label for="task-${idx}">${idx === 0 ? t('Task', 'काम') : t('Another task', 'अन्य काम')}</label><select id="task-${idx}" name="task_id" required>${draft.catalog.filter(task => task.active || String(task.id) === String(item.task_id)).map(task => `<option value="${esc(task.id)}" ${String(item.task_id) === String(task.id) ? 'selected' : ''}>${esc(task.name)} · ${money(task.rate)}/${esc(task.unit)}</option>`).join('')}</select></div><div class="field"><label for="quantity-${idx}">${t('Quantity', 'मात्रा')}</label><input id="quantity-${idx}" name="quantity" type="number" inputmode="decimal" step="0.001" min="0.01" max="1000000" required value="${esc(item.quantity)}"></div><button type="button" class="btn btn-ghost btn-icon" data-action="entry-remove" data-index="${idx}" aria-label="${t('Remove task', 'काम हटाएँ')}">${icon('x')}</button></div>`).join('');
}
function voiceHTML() {
  return `<section class="voice-area"><h2>${t('Tell us about your workday.', 'आज का काम बोलकर बताएँ।')}</h2><p>${t('Speak in Hindi. Check the details. You’re in control.', 'हिन्दी में बोलें। विवरण जाँचें। पुष्टि आप करेंगे।')}</p><button type="button" class="mic-btn" id="mic-button" aria-pressed="false" aria-describedby="voice-status" aria-label="${t('Start or stop voice recording', 'आवाज़ रिकॉर्ड करना शुरू या बंद करें')}">${icon('mic')}</button><span class="voice-hint" id="voice-status" role="status" aria-live="polite">${t('Tap to speak · tap again to finish · or press and hold', 'बोलने के लिए टैप करें · रोकने के लिए फिर टैप करें · या दबाकर रखें')}</span><div class="voice-example">${t('Try: “आज 10 दर्जन पैकिंग और 2 घंटे ओवरटाइम”', 'जैसे: “आज 10 दर्जन पैकिंग और 2 घंटे ओवरटाइम”')}</div><div class="transcript-panel"><div class="field"><label for="transcript">${t('Your words, editable', 'आपके शब्द, बदलाव कर सकते हैं')}</label><textarea id="transcript" name="transcript" rows="2" placeholder="${t('Speak, or type your work here…', 'बोलें, या अपना काम यहाँ लिखें…')}"></textarea><small>${t('Your browser may send speech audio to its recognition provider. You can always type or use the form below.', 'ब्राउज़र आवाज़ पहचानने के लिए ऑडियो अपने सेवा प्रदाता को भेज सकता है। नीचे लिखकर भी एंट्री कर सकते हैं।')}</small></div><button type="button" class="btn btn-secondary" data-action="apply-transcript">${icon('list-checks')}${t('Use these words', 'इन शब्दों से विवरण भरें')}</button><div id="voice-warnings" class="hidden" role="status" aria-live="polite"></div></div></section>`;
}
function entryFormHTML() {
  if (draftLocked()) return `<div class="panel-body"><div class="notice">${icon('circle-check')}<div><strong>${t('This day is already approved.', 'इस दिन का काम पहले ही मंज़ूर है।')}</strong><br>${t('Approved or paid records cannot be edited. Choose another date to record more work.', 'मंज़ूर या भुगतान किए रिकॉर्ड बदले नहीं जा सकते। काम दर्ज करने के लिए दूसरी तारीख चुनें।')}</div></div><div class="field" style="margin-top:20px"><label for="locked-date">${t('Choose a work date', 'काम की तारीख चुनें')}</label><input id="locked-date" type="date" value="${esc(draft.work_date)}" max="${today()}"></div></div>`;
  const piece = draft.worker.payment_model === 'piece';
  return `<form id="entry-form"><div class="form-error" role="alert"></div>${!draft.ownerEntry ? voiceHTML() : ''}<div class="entry-fields">${draft.id ? `<div class="notice ${draft.status === 'rejected' ? 'notice-amber' : ''}">${icon('pencil')}<span>${t('You are editing the existing entry for this date, not creating a duplicate.', 'इस तारीख की मौजूद एंट्री बदल रहे हैं, नई एंट्री नहीं बना रहे।')}${draft.review_note ? `<br><strong>${esc(draft.review_note)}</strong>` : ''}</span></div>` : ''}<div class="form-grid">${field(t('Work date', 'काम की तारीख'), 'work_date', draft.work_date, { type: 'date', required: true, attrs: `max="${today()}"` })}${piece ? `<div class="field"><label>${t('Payment model', 'वेतन का तरीका')}</label><div class="notice" style="min-height:52px;padding:12px">${icon('package')} ${t('Piece-rate work', 'प्रति इकाई काम')}</div></div>` : selectField(t('Attendance', 'उपस्थिति'), 'attendance', [['full', t('Full day', 'पूरा दिन')], ['half', t('Half day', 'आधा दिन')], ['absent', t('Absent', 'अनुपस्थित')]], draft.attendance)}</div>${piece ? `<div class="entry-items" id="entry-items">${entryItemsHTML()}</div>${draft.catalog.some(c => c.active) ? `<button type="button" class="entry-add" data-action="entry-add">${icon('plus', 'icon-sm')}${t('Add another task', 'एक और काम जोड़ें')}</button>` : `<div class="notice notice-amber">${icon('circle-alert')}${t('No active tasks yet. Ask your owner to add work to the catalog.', 'अभी सक्रिय काम नहीं हैं। मालिक से सूची में काम जोड़ने को कहें।')}</div>`}` : `<div class="notice">${icon('banknote')}<span>${draft.worker.payment_model === 'monthly' ? `${money(draft.worker.salary)} / ${t('month', 'माह')} ÷ ${count(state.session.business.salary_divisor)} ${t('working days', 'कामकाजी दिन')}` : `${money(draft.worker.salary)} / ${t('full day', 'पूरा दिन')}`}</span></div>`}<div class="form-grid">${field(t('Overtime hours', 'ओवरटाइम घंटे'), 'ot_hours', draft.ot_hours, { type: 'number', required: true, attrs: `inputmode="decimal" min="0" max="16" step="${policy(draft.worker).mode === 'shift' ? '4' : '0.01'}"`, hint: policy(draft.worker).mode === 'shift' ? t('Shift policy: use 0, 4, 8… hours.', 'शिफ्ट नीति: 0, 4, 8… घंटे डालें।') : t('Leave 0 if there was no overtime.', 'ओवरटाइम न होने पर 0 रखें।') })}<div class="field"><label for="photo">${icon('camera', 'icon-sm')} ${t('Work photo (optional)', 'काम का फ़ोटो (वैकल्पिक)')}</label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><small>${t('JPEG, PNG or WebP · up to 5 MB', 'JPEG, PNG या WebP · अधिकतम 5 MB')}</small></div></div><div id="photo-preview">${photoPreviewHTML()}</div><div class="field"><label for="note">${t('Anything else? (optional)', 'कुछ और? (वैकल्पिक)')}</label><textarea id="note" name="note" maxlength="1000" rows="2" placeholder="${t('A short note about today’s work', 'आज के काम के बारे में छोटा नोट')}">${esc(draft.note)}</textarea></div><div class="entry-estimate" aria-live="polite"><div><span>${t('Estimated earnings', 'अनुमानित कमाई')}</span><small id="live-breakdown"></small><small>${t('Final amount calculated when saved.', 'सेव करने पर अंतिम राशि की गणना होगी।')}</small></div><strong id="live-total">${money(estimate().total)}</strong></div><button type="submit" class="btn btn-wide">${t('Check & submit work', 'जाँचकर काम जमा करें')}${icon('arrow-right')}</button><p class="small muted" style="text-align:center">${t('One entry per date. Nothing is submitted without your confirmation.', 'एक तारीख की एक एंट्री। आपकी पुष्टि के बिना कुछ जमा नहीं होता।')}</p></div></form>`;
}
function photoPreviewHTML() {
  const url = photoObjectURL || safeURL(draft?.photo_url);
  return url ? `<div class="photo-preview"><img src="${esc(url)}" alt="${t('Selected work photo', 'चुना गया काम का फ़ोटो')}"><button type="button" class="btn btn-ghost" data-action="photo-remove">${icon('x')}${t('Remove photo', 'फ़ोटो हटाएँ')}</button></div>` : '';
}
function renderWorkerHome(d) {
  const total = n(d.unsettled_net);
  return `${pageHead(esc(t(`Hello, ${d.worker.name.split(' ')[0]}.`, `नमस्ते, ${d.worker.name.split(' ')[0]}।`)), t('Your work matters. Let’s keep a clear record of it.', 'आपका काम ज़रूरी है। उसका साफ़ हिसाब रखें।'), dateChip(), t('MY WORKDAY', 'मेरा काम'))}<section class="worker-hero"><div><p class="eyebrow">${total < 0 ? t('ADVANCE CARRY-FORWARD', 'आगे जाने वाला अग्रिम') : t('YOUR UNSETTLED BALANCE', 'आपका बाकी हिसाब')}</p><h2>${money(total)}</h2><p>${t('Approved earnings, less outstanding advances.', 'मंज़ूर कमाई में से बाकी अग्रिम घटाकर।')}</p></div><div class="hero-details"><div><small>${t('Approved earnings', 'मंज़ूर कमाई')}</small><strong>${money(d.approved_earnings)}</strong></div><div><small>${t('Awaiting approval', 'मंज़ूरी बाकी')}</small><strong>${money(d.pending_earnings)}</strong></div></div></section><div class="worker-layout"><section class="panel">${entryFormHTML()}</section><div class="stack"><section class="panel"><div class="panel-head"><div><h2>${t('Your recent work', 'आपका हाल का काम')}</h2><p>${t('Every day, a little progress.', 'हर दिन, थोड़ी तरक्की।')}</p></div>${icon('history')}</div><div class="panel-body">${(d.recent_submissions || []).length ? d.recent_submissions.slice(0, 5).map(s => `<div class="history-item"><div class="row between"><div><div class="history-date">${dateLabel(s.work_date, true)}</div><small>${s.items?.length ? `${count(s.items.length)} ${t('tasks recorded', 'काम दर्ज')}` : attendanceLabel(s.attendance)}</small></div><span class="history-amount">${money(s.total)}</span></div><div class="row between" style="margin-top:10px">${statusChip(s.settlement_id ? 'settled' : s.status)}<button class="link-btn" data-action="view-entry" data-id="${esc(s.id)}" style="min-height:52px">${t('View', 'देखें')}${icon('chevron-right', 'icon-sm')}</button></div></div>`).join('') : empty(t('Your story starts today.', 'आपकी शुरुआत आज से।'), t('Record your first day’s work. Your history will grow here.', 'पहले दिन का काम दर्ज करें। आपका इतिहास यहाँ दिखेगा।'), 'file-text', '', true)}</div><div class="panel-footer"><span>${t('A record you can count on.', 'हिसाब, जिस पर भरोसा हो।')}</span><a href="#history" class="link-btn">${t('Full ledger', 'पूरा खाता')}${icon('arrow-right', 'icon-sm')}</a></div></section><section class="balance-card"><h3>${t('Outstanding advances', 'बाकी अग्रिम')}</h3><strong>${money(d.advances_balance)}</strong><p>${t('These are deducted from approved work when your owner settles your ledger.', 'मालिक द्वारा हिसाब चुकाते समय यह राशि मंज़ूर काम की कमाई में से घटेगी।')}</p></section><div class="notice">${icon('circle-help')}<p>${t('Spoke something wrong? Edit the words or enter work manually. Always check quantities before submitting.', 'बोलने में गलती हुई? शब्द बदलें या काम हाथ से दर्ज करें। जमा करने से पहले मात्रा जाँचें।')}</p></div></div></div>`;
}
function renderHistory(d) {
  const items = d.items || [], advances = d.advances || [], f = state.filters.history || {};
  return `${pageHead(t('Your work, all in one place.', 'आपका काम, एक जगह।'), t('Follow each entry from your workday to payday.', 'हर एंट्री का काम से भुगतान तक हिसाब देखें।'), dateChip(), t('MY LEDGER', 'मेरा खाता'))}<form id="history-filters" class="filters">${field(t('Work date', 'काम की तारीख'), 'date', f.date || '', { type: 'date' })}${selectField(t('Status', 'स्थिति'), 'status', [['', t('All work', 'सारा काम')], ['pending', t('In review', 'समीक्षा में')], ['approved', t('Approved', 'मंज़ूर')], ['rejected', t('Needs correction', 'सुधार चाहिए')]], f.status || '')}<button type="submit" class="btn btn-secondary">${t('Show records', 'रिकॉर्ड देखें')}</button></form><div class="stack"><section class="panel">${items.length ? `<div class="table-wrap"><table class="responsive"><thead><tr><th>${t('Date', 'तारीख')}</th><th>${t('Work', 'काम')}</th><th>${t('Base', 'मूल')}</th><th>${t('Overtime', 'ओवरटाइम')}</th><th>${t('Total', 'कुल')}</th><th>${t('Status', 'स्थिति')}</th><th></th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${dateLabel(s.work_date, true)}</strong></td><td data-label="${t('Work', 'काम')}" style="white-space:normal;max-width:230px">${submissionText(s)}</td><td data-label="${t('Base', 'मूल')}">${money(s.base)}</td><td data-label="${t('Overtime', 'ओवरटाइम')}">${money(s.overtime)}</td><td data-label="${t('Total', 'कुल')}"><strong>${money(s.total)}</strong></td><td data-label="${t('Status', 'स्थिति')}">${statusChip(s.settlement_id ? 'settled' : s.status)}</td><td><button class="btn btn-soft" data-action="view-entry" data-id="${esc(s.id)}">${t('View entry', 'एंट्री देखें')}</button></td></tr>`).join('')}</tbody></table></div>` : empty(t('A clean page for good work.', 'अच्छे काम के लिए नई शुरुआत।'), t('No work matches these filters. Record work on your workday page or change the filters.', 'इन फ़िल्टर में कोई काम नहीं। काम वाले पेज पर दर्ज करें या फ़िल्टर बदलें।'), 'history')}</section><section class="panel"><div class="panel-head"><div><h2>${t('Your advance ledger', 'आपका अग्रिम खाता')}</h2><p>${t('All advances, independent of the work filters above.', 'सभी अग्रिम, ऊपर के काम फ़िल्टर से अलग।')}</p></div></div><div class="panel-body">${advances.length ? advances.map(a => `<div class="history-item"><div class="row between wrap"><div><strong>${money(a.amount)}</strong><p>${dateLabel(a.date, true)} ${a.note ? `· ${esc(a.note)}` : ''}</p></div><span class="chip ${a.voided ? 'chip-gray' : a.settlement_id ? '' : 'chip-amber'}">${a.voided ? t('Voided', 'रद्द') : a.settlement_id ? t('Adjusted', 'समायोजित') : t('Outstanding', 'बाकी')}</span></div></div>`).join('') : empty(t('No advances to show.', 'कोई अग्रिम नहीं।'), t('Any advance your owner records will appear here.', 'मालिक का दर्ज किया अग्रिम यहाँ दिखेगा।'), 'banknote', '', true)}</div></section></div>`;
}
function receiptHTML(s, detailed = false) {
  const share = safeURL(s.whatsapp_url, 'whatsapp');
  return `<article class="receipt"><div class="receipt-header"><div><p class="eyebrow">${t('PAYMENT RECEIPT', 'भुगतान पर्ची')}</p><h3 style="margin-top:6px">${esc(s.worker_name || state.session.user.name)}</h3></div><span class="chip">${icon('circle-check', 'icon-sm')}${t('Recorded', 'दर्ज')}</span></div><p>${dateLabel(s.start, true)} — ${dateLabel(s.end, true)}</p><div class="money-breakdown">${moneyRow(t('Base earnings', 'मूल कमाई'), s.base)}${moneyRow(t('Overtime', 'ओवरटाइम'), s.overtime)}${moneyRow(t('Advances adjusted', 'अग्रिम समायोजन'), -n(s.advances))}${moneyRow(t('Net settlement', 'शुद्ध भुगतान'), s.net, true)}</div><p>${t('Method', 'तरीका')}: <strong>${esc(s.method)}</strong>${s.reference ? `<br>${t('Reference', 'संदर्भ')}: ${esc(s.reference)}` : ''}<br>${t('Recorded on', 'दर्ज तारीख')}: ${dateLabel(s.created_at)}<br>${t('Receipt ID', 'पर्ची ID')}: ${esc(s.id)}</p>${detailed ? `<div class="notice" style="margin-top:18px">${icon('circle-help')}<span>${t('This records your owner’s confirmation. It is not independent bank verification.', 'यह मालिक की पुष्टि का रिकॉर्ड है। यह स्वतंत्र बैंक सत्यापन नहीं है।')}</span></div>` : ''}<div class="row wrap" style="margin-top:18px">${detailed ? `<button class="btn btn-secondary" data-action="print">${icon('printer')}${t('Print / save PDF', 'प्रिंट / PDF सेव')}</button>` : `<button class="btn btn-secondary" data-action="view-slip" data-id="${esc(s.id)}">${icon('receipt')}${t('View receipt', 'पर्ची देखें')}</button>`}${share ? `<a class="btn btn-soft" href="${esc(share)}" target="_blank" rel="noopener noreferrer">${icon('send')}${t('WhatsApp', 'WhatsApp')}</a>` : ''}</div></article>`;
}
function renderSlips(d) { return `${pageHead(t('A clear finish to good work.', 'अच्छे काम का साफ़ हिसाब।'), t('Your owner-confirmed payments, kept together.', 'मालिक द्वारा पुष्टि किए भुगतान, एक साथ।'), '', t('PAYMENT SLIPS', 'भुगतान पर्चियाँ'))}${d.items?.length ? `<div class="receipt-grid">${d.items.map(s => receiptHTML(s)).join('')}</div>` : `<section class="panel">${empty(t('Your first payment slip is on its way.', 'पहली भुगतान पर्ची यहीं मिलेगी।'), t('When your owner records a settlement, the full breakdown will appear here.', 'मालिक द्वारा भुगतान दर्ज करने पर पूरा हिसाब यहाँ दिखेगा।'), 'receipt')}</section>`}`; }
function moneyRow(label, value, total = false) { return `<div class="money-row ${total ? 'total' : ''}"><span>${label}</span><strong>${money(value)}</strong></div>`; }

/* Dialog workflows */
let dialogRender = null;
let entryDateGeneration = 0;
const submitButton = label => `<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">${t('Cancel', 'रद्द करें')}</button><button type="submit" class="btn">${label}</button></div>`;
const pinAttrs = 'inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password"';
function showDialog(render) { stopVoice(); dialogRender = render; render(); }
function finishDialog() {
  $$('[data-busy]', modal).forEach(el => delete el.dataset.busy);
  closeDialog();
}
function snapshotFields(root) {
  return $$('input,select,textarea', root).filter(el => el.type !== 'file').map(el => ({ id: el.id, name: el.name, value: el.value, checked: el.checked, type: el.type }));
}
function restoreFields(root, values) {
  for (const saved of values) {
    const el = saved.id ? $$('[id]', root).find(x => x.id === saved.id) : $$('[name]', root).find(x => x.name === saved.name);
    if (!el || el.type === 'file') continue;
    if (saved.type === 'checkbox' || saved.type === 'radio') el.checked = saved.checked;
    else el.value = saved.value;
  }
}
function redrawPage() {
  if (!state.session) return renderAuth();
  const screens = { overview: renderOverview, workers: renderWorkers, catalog: renderCatalog, review: renderReview, payroll: renderPayroll, advances: renderAdvances, home: renderWorkerHome, history: renderHistory, slips: renderSlips, settings: renderSettings, more: renderMore };
  renderShell();
  if (screens[state.route] && (state.route !== 'home' || state.data.worker)) $('#main').innerHTML = `<div class="page-enter">${screens[state.route](state.data)}</div>`;
  icons(); prepareEntry();
}
function switchLanguage() {
  if (busy || $('[data-busy="true"]')) return;
  syncDraft(); stopVoice();
  const pageValues = snapshotFields(app), dialogValues = snapshotFields(modal), wasOpen = modal.open;
  state.lang = state.lang === 'en' ? 'hi' : 'en';
  document.documentElement.lang = state.lang;
  try { localStorage.setItem('karigarpay-language', state.lang); } catch {}
  redrawPage(); restoreFields(app, pageValues);
  if (wasOpen && dialogRender) { dialogRender(); restoreFields(modal, dialogValues); }
  bindVoice(); updateEstimate(); updateWorkerFields(); updateSettlementMethod();
}
function workerDialog(worker = null) {
  const w = worker || { payment_model: 'piece', active: true };
  showDialog(() => openDialog(worker ? t('Manage team member', 'सदस्य प्रबंधन') : t('Welcome someone new.', 'नए सदस्य का स्वागत करें।'), `<form id="worker-form" data-id="${esc(w.id || '')}" class="stack"><div class="form-error" role="alert"></div>${field(t('Full name', 'पूरा नाम'), 'name', w.name, { required: true, attrs: 'minlength="2" maxlength="100" autocomplete="name"' })}${field(t('Mobile number', 'मोबाइल नंबर'), 'phone', w.phone, { type: 'tel', required: true, attrs: 'inputmode="tel" pattern="[6-9][0-9]{9}" maxlength="10" autocomplete="tel"', hint: t('10-digit Indian mobile number.', '10 अंक का भारतीय मोबाइल नंबर।') })}${field(worker ? t('Reset PIN (leave blank to keep it)', 'नया PIN (न बदलने के लिए खाली छोड़ें)') : t('Initial 4-digit PIN', 'शुरुआती 4 अंक का PIN'), 'worker_pin', '', { type: 'password', required: !worker, attrs: pinAttrs })}<div class="form-grid">${selectField(t('Payment model', 'वेतन का तरीका'), 'payment_model', [['piece', modelLabel('piece')], ['daily', modelLabel('daily')], ['monthly', modelLabel('monthly')]], w.payment_model)}${field(t('Daily wage / monthly salary (₹)', 'दैनिक वेतन / मासिक वेतन (₹)'), 'salary', w.salary || 0, { type: 'number', attrs: 'min="0" max="10000000" step="0.01"' })}</div>${field(t('UPI ID (optional)', 'UPI ID (वैकल्पिक)'), 'upi_id', w.upi_id, { attrs: 'maxlength="120" autocapitalize="none" spellcheck="false"' })}<label class="check-label"><input type="checkbox" name="inherit_ot" ${!w.overtime_policy ? 'checked' : ''}><span>${t('Use the business overtime policy', 'व्यवसाय की ओवरटाइम नीति इस्तेमाल करें')}</span></label><div id="worker-ot-fields">${overtimeFields(w.overtime_policy || state.session.business.overtime_policy)}</div>${worker ? `<label class="check-label"><input type="checkbox" name="active" ${w.active ? 'checked' : ''}><span>${t('Active account. Uncheck to archive and stop sign-in; past records stay intact.', 'सक्रिय खाता। हटाने पर साइन इन बंद होगा; पुराना हिसाब सुरक्षित रहेगा।')}</span></label>` : ''}<p class="small muted">${t('Wage changes affect new or edited entries only. Share the business code and initial PIN privately.', 'वेतन में बदलाव केवल नई या बदली एंट्री पर लागू होगा। व्यवसाय कोड और PIN निजी तौर पर साझा करें।')}</p>${submitButton(t('Save team member', 'सदस्य सेव करें'))}</form>`, { wide: true }));
  updateWorkerFields();
}
function updateWorkerFields() {
  const form = $('#worker-form'); if (!form) return;
  const piece = form.elements.payment_model.value === 'piece';
  form.elements.salary.required = !piece; form.elements.salary.min = piece ? '0' : '0.01';
  const inherit = form.elements.inherit_ot.checked;
  $('#worker-ot-fields').classList.toggle('hidden', inherit);
  $$('input,select', $('#worker-ot-fields')).forEach(el => { el.disabled = inherit; });
}
function taskDialog(task = null) {
  const taskData = task || {};
  showDialog(() => openDialog(task ? t('Edit task', 'काम बदलें') : t('Give good work a name.', 'अच्छे काम को नाम दें।'), `<form id="task-form" data-id="${esc(taskData.id || '')}" class="stack"><div class="form-error" role="alert"></div>${field(t('Task name', 'काम का नाम'), 'name', taskData.name, { required: true, attrs: 'minlength="2" maxlength="100"' })}<div class="form-grid">${field(t('Unit', 'इकाई'), 'unit', taskData.unit || '', { required: true, attrs: 'maxlength="24"', hint: t('For example: dozen, piece or unit.', 'जैसे: दर्जन, पीस या इकाई।') })}${field(t('Rate per unit (₹)', 'प्रति इकाई दर (₹)'), 'rate', taskData.rate ?? '', { type: 'number', required: true, attrs: 'min="0" max="10000000" step="0.01"' })}</div>${field(t('Other names / voice aliases', 'अन्य नाम / आवाज़ के नाम'), 'aliases', (taskData.aliases || []).join(', '), { hint: t('Separate up to 20 Hindi or English names with commas.', 'अधिकतम 20 हिन्दी या English नाम कॉमा से अलग करें।'), attrs: 'maxlength="1220"' })}${task ? `<label class="check-label"><input type="checkbox" name="active" ${task.active ? 'checked' : ''}><span>${t('Active task. Archived tasks stay in existing records.', 'सक्रिय काम। संग्रहित काम पुराने रिकॉर्ड में रहेंगे।')}</span></label>` : ''}${submitButton(t('Save task', 'काम सेव करें'))}</form>`));
}
async function ownerEntryDialog() {
  const [workers, tasks] = await Promise.all([api('/workers'), api('/tasks')]);
  const active = workers.items.filter(w => w.active);
  if (!active.length) return workerDialog();
  showDialog(() => openDialog(t('Record work for your team', 'टीम का काम दर्ज करें'), `<form id="owner-entry-start"><div class="form-error" role="alert"></div>${selectField(t('Team member', 'सदस्य'), 'worker_id', active.map(w => [w.id, w.name]), active[0].id, 'required')}${field(t('Work date', 'काम की तारीख'), 'entry_date', today(), { type: 'date', required: true, attrs: `max="${today()}"` })}${submitButton(t('Open work entry', 'काम की एंट्री खोलें'))}</form>`));
  state.entryWorkers = active; state.entryTasks = tasks.items;
}
function drawEntry() {
  if (draft.ownerEntry) {
    dialogRender = () => { openDialog(esc(draft.worker.name), entryFormHTML(), { subtitle: t('Owner-recorded work still needs approval.', 'मालिक द्वारा दर्ज काम को भी मंज़ूरी चाहिए।'), wide: true }); prepareEntry(); };
    dialogRender();
  } else {
    const form = $('#entry-form'), locked = $('#locked-date');
    if (form) form.outerHTML = entryFormHTML();
    else if (locked) locked.closest('.panel').innerHTML = entryFormHTML();
    else redrawPage();
    prepareEntry();
  }
}
function prepareEntry() {
  const form = $('#entry-form');
  if (form && draft?.id) {
    form.elements.work_date.readOnly = true;
    if (!$('#entry-change-day', form)) {
      const button = document.createElement('button'); button.type = 'button'; button.id = 'entry-change-day'; button.className = 'btn btn-secondary'; button.dataset.action = 'entry-change-day'; button.textContent = t('Choose another date', 'दूसरी तारीख चुनें'); form.elements.work_date.parentElement.append(button);
    }
  }
  bindVoice(); updateEstimate(); icons();
}
async function selectEntryDate(day, worker = draft?.worker, catalog = draft?.catalog, ownerEntry = draft?.ownerEntry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today()) throw new Error(t('Choose today or an earlier date.', 'आज या पहले की तारीख चुनें।'));
  const generation = ++entryDateGeneration;
  const result = await api(`/submissions${qs({ worker_id: worker.id, date: day, limit: 1 })}`);
  if (generation !== entryDateGeneration || !state.session) return;
  initDraft(worker, result.items[0] || null, catalog, day, ownerEntry);
  drawEntry();
}
function entryDateDialog() {
  syncDraft();
  const worker = draft.worker, catalog = draft.catalog, ownerEntry = draft.ownerEntry;
  showDialog(() => openDialog(t('Choose another work date', 'दूसरी तारीख चुनें'), `<form id="entry-date-form"><p class="small muted">${t('Opening another date replaces this unsaved draft. Existing entries will be loaded, not duplicated.', 'दूसरी तारीख खोलने पर बिना सेव किया मसौदा बदलेगा। मौजूद एंट्री खुलेगी, नई कॉपी नहीं बनेगी।')}</p>${field(t('Work date', 'काम की तारीख'), 'entry_date', draft.work_date, { type: 'date', required: true, attrs: `max="${today()}"` })}<div class="form-error" role="alert"></div>${submitButton(t('Open date', 'तारीख खोलें'))}</form>`));
  state.entryDateContext = { worker, catalog, ownerEntry };
}
function checkEntry() {
  const form = $('#entry-form');
  if (!form?.reportValidity() || draftLocked()) return;
  syncDraft(form); stopVoice();
  if (draft.worker.payment_model === 'piece' && !draft.items.length) return formError(form, new Error(t('Add at least one task.', 'कम से कम एक काम जोड़ें।')));
  if (new Set(draft.items.map(i => i.task_id)).size !== draft.items.length) return formError(form, new Error(t('Combine repeated tasks into one quantity.', 'एक ही काम की मात्रा एक पंक्ति में जोड़ें।')));
  const render = () => {
    const e = estimate();
    openDialog(t('Check your work before sending.', 'भेजने से पहले काम जाँचें।'), `<div class="confirmation-summary"><h3>${esc(draft.worker.name)} · ${dateLabel(draft.work_date)}</h3>${draft.items.map(item => { const task = draft.catalog.find(c => String(c.id) === String(item.task_id)); return `<p>${esc(task?.name)}: ${count(item.quantity)} ${esc(task?.unit)}</p>`; }).join('')}${draft.attendance ? `<p>${attendanceLabel(draft.attendance)}</p>` : ''}<p>${t('Overtime', 'ओवरटाइम')}: ${count(draft.ot_hours)} ${t('hours', 'घंटे')}</p>${draft.note ? `<p>${esc(draft.note)}</p>` : ''}${photoPreviewHTML()}${moneyRow(t('Estimated earnings', 'अनुमानित कमाई'), e.total, true)}</div><p>${t('This submits work for review; it does not approve wages or make a payment.', 'यह काम समीक्षा के लिए जमा करेगा; वेतन मंज़ूर या भुगतान नहीं होगा।')}</p><form id="entry-confirm-form"><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="entry-back">${t('Back to editing', 'संपादन पर वापस')}</button><button class="btn" type="submit">${t('Submit for review', 'समीक्षा के लिए जमा करें')}</button></div></form>`, { wide: true });
  };
  showDialog(render);
}
async function saveEntry() {
  if (!draft || draftLocked()) throw new Error(t('This entry is locked.', 'यह एंट्री लॉक है।'));
  const activeDraft = draft;
  if (photoFile) {
    const upload = new FormData(); upload.append('file', photoFile);
    const photo = await api('/photos', { method: 'POST', body: upload });
    activeDraft.photo_id = photo.id; activeDraft.photo_url = photo.url; clearPhoto();
    const image = $('.photo-preview img', modal); if (image) image.src = safeURL(photo.url);
  }
  const body = { ...(activeDraft.ownerEntry ? { worker_id: activeDraft.worker.id } : {}), work_date: activeDraft.work_date, items: activeDraft.items.map(i => ({ task_id: i.task_id, quantity: n(i.quantity) })), attendance: activeDraft.attendance, ot_hours: n(activeDraft.ot_hours), photo_id: activeDraft.photo_id || null, note: activeDraft.note, request_id: activeDraft.request_id };
  const serialized = JSON.stringify({ ...body, request_id: null });
  if (activeDraft.sentPayload && activeDraft.sentPayload !== serialized) body.request_id = activeDraft.request_id = uid();
  activeDraft.sentPayload = serialized;
  const saved = await api(activeDraft.id ? `/submissions/${encodeURIComponent(activeDraft.id)}` : '/submissions', { method: activeDraft.id ? 'PUT' : 'POST', body });
  const owner = activeDraft.ownerEntry;
  if (!owner) initDraft(activeDraft.worker, saved, activeDraft.catalog);
  finishDialog();
  toast(t('Work sent for review.', 'काम समीक्षा के लिए भेज दिया गया।'));
  await loadRoute();
}
function entryDetailsHTML(s) {
  const photo = safeURL(s.photo_url);
  return `<div class="confirmation-summary"><div class="row between wrap"><h3>${esc(s.worker_name)}</h3>${statusChip(s.settlement_id ? 'settled' : s.status)}</div><p>${dateLabel(s.work_date)} · ${modelLabel(s.payment_model)}</p><p>${submissionText(s)}</p><p>${t('Overtime', 'ओवरटाइम')}: ${count(s.ot_hours)} ${t('hours', 'घंटे')}</p>${s.note ? `<p>${esc(s.note)}</p>` : ''}${s.review_note ? `<p>${t('Review note', 'समीक्षा नोट')}: ${esc(s.review_note)}</p>` : ''}${photo ? `<a href="${esc(photo)}" target="_blank" rel="noopener noreferrer"><img src="${esc(photo)}" alt="${t('Attached work photo', 'काम का संलग्न फ़ोटो')}" style="max-height:240px;border-radius:12px;object-fit:contain"></a>` : ''}<div class="money-breakdown">${moneyRow(t('Base earnings', 'मूल कमाई'), s.base)}${moneyRow(t('Overtime earnings', 'ओवरटाइम कमाई'), s.overtime)}${moneyRow(t('Total earnings', 'कुल कमाई'), s.total, true)}</div></div>`;
}
async function entryDetails(id, review = false) {
  const entry = await api(`/submissions/${encodeURIComponent(id)}`);
  const canReview = review && state.session.user.role === 'owner' && entry.status === 'pending' && !entry.settlement_id;
  showDialog(() => openDialog(canReview ? t('Review the day’s work', 'दिन का काम जाँचें') : t('Work entry details', 'काम का विवरण'), `${entryDetailsHTML(entry)}${canReview ? `<form id="review-entry-form" data-id="${esc(entry.id)}"><div class="form-error" role="alert"></div><div class="field"><label for="review_note">${t('Review note (optional)', 'समीक्षा नोट (वैकल्पिक)')}</label><textarea id="review_note" name="review_note" maxlength="1000" rows="2"></textarea></div><div class="form-actions"><button class="btn btn-secondary" type="submit" name="review_action" value="reject">${t('Ask for correction', 'सुधार माँगें')}</button><button class="btn" type="submit" name="review_action" value="approve">${t('Approve work', 'काम मंज़ूर करें')}</button></div></form>` : !entry.settlement_id && entry.status !== 'approved' ? actionButton('edit-entry', t('Edit this entry', 'एंट्री बदलें'), 'pencil', `data-id="${esc(entry.id)}"`) : `<p class="small muted">${t('Approved and paid records are immutable.', 'मंज़ूर और भुगतान किए रिकॉर्ड बदले नहीं जा सकते।')}</p>`}`, { wide: true }));
}
async function editEntry(id) {
  const [entry, tasks, workers] = await Promise.all([api(`/submissions/${encodeURIComponent(id)}`), api('/tasks'), state.session.user.role === 'owner' ? api('/workers') : Promise.resolve({ items: [state.session.user] })]);
  if (entry.status === 'approved' || entry.settlement_id) throw new Error(t('Approved records cannot be edited.', 'मंज़ूर रिकॉर्ड बदले नहीं जा सकते।'));
  const worker = workers.items.find(w => w.id === entry.worker_id);
  if (!worker) throw new Error(t('This team member could not be found.', 'यह सदस्य नहीं मिला।'));
  const owner = state.session.user.role === 'owner';
  finishDialog(); initDraft(worker, entry, tasks.items, entry.work_date, owner);
  if (owner) drawEntry(); else { await navigate('home'); }
}
async function advanceDialog() {
  const workers = (await api('/workers')).items.filter(w => w.active);
  if (!workers.length) return workerDialog();
  const requestId = uid();
  showDialog(() => openDialog(t('Record an advance', 'अग्रिम दर्ज करें'), `<form id="advance-form" data-request-id="${requestId}"><div class="form-error" role="alert"></div><p class="small muted">${t('Record money already handed to this worker. This does not transfer money.', 'सदस्य को दी जा चुकी राशि दर्ज करें। इससे पैसे नहीं भेजे जाएँगे।')}</p>${selectField(t('Team member', 'सदस्य'), 'worker_id', workers.map(w => [w.id, w.name]), workers[0].id, 'required')}<div class="form-grid">${field(t('Date given', 'देने की तारीख'), 'date', today(), { type: 'date', required: true, attrs: `max="${today()}"` })}${field(t('Amount (₹)', 'राशि (₹)'), 'amount', '', { type: 'number', required: true, attrs: 'min="0.01" max="10000000" step="0.01"' })}</div>${field(t('Reason / note', 'कारण / नोट'), 'note', '', { required: true, attrs: 'maxlength="500"' })}<label class="check-label"><input type="checkbox" name="confirmed" required><span>${t('I have already given this advance to the worker.', 'मैं यह अग्रिम राशि सदस्य को दे चुका हूँ।')}</span></label>${submitButton(t('Record advance', 'अग्रिम सेव करें'))}</form>`));
}
function voidAdvanceDialog(id) {
  showDialog(() => openDialog(t('Void an advance record?', 'अग्रिम रिकॉर्ड रद्द करें?'), `<form id="void-advance-form" data-id="${esc(id)}"><p class="small muted">${t('Use this only to correct an incorrect entry. The original record and your reason remain visible in the audit trail.', 'केवल गलत एंट्री सुधारने के लिए। मूल रिकॉर्ड और कारण गतिविधि रिकॉर्ड में रहेंगे।')}</p><div class="form-error" role="alert"></div>${field(t('Reason for correction', 'सुधार का कारण'), 'reason', '', { required: true, attrs: 'minlength="3" maxlength="500"' })}<label class="check-label"><input type="checkbox" required><span>${t('I confirm this advance entry is incorrect.', 'मैं पुष्टि करता हूँ कि यह अग्रिम एंट्री गलत है।')}</span></label>${submitButton(t('Void this entry', 'यह एंट्री रद्द करें'))}</form>`));
}
async function approveDayDialog() {
  showDialog(() => openDialog(t('Review a day before approving', 'दिन मंज़ूर करने से पहले जाँचें'), `<form id="approve-day-form"><div class="form-error" role="alert"></div>${field(t('Work date', 'काम की तारीख'), 'date', state.filters.review?.date || today(), { type: 'date', required: true, attrs: `max="${today()}"` })}${submitButton(t('Review pending entries', 'बाकी एंट्री जाँचें'))}</form>`));
}
async function showDayConfirmation(day) {
  const entries = (await api(`/submissions${qs({ date: day, status: 'pending', limit: 500 })}`)).items;
  if (!entries.length) { finishDialog(); toast(t('No pending work for this date.', 'इस तारीख का कोई काम बाकी नहीं है।')); return; }
  const summary = entries.map(s => `<p><strong>${esc(s.worker_name)}</strong> · ${submissionText(s)} · ${money(s.total)}</p>`).join('');
  showDialog(() => openDialog(t('Approve all pending work for this day?', 'इस दिन का सारा बाकी काम मंज़ूर करें?'), `<div class="confirmation-summary"><h3>${dateLabel(day)}</h3>${summary}</div><form id="approve-day-confirm" data-date="${esc(day)}"><div class="notice notice-amber">${t('All entries still pending on this date will be approved, including entries added since this list loaded. Approved amounts are locked.', 'इस तारीख की सभी बाकी एंट्री मंज़ूर होंगी, सूची खुलने के बाद जुड़ी एंट्री भी। मंज़ूर राशि लॉक हो जाएगी।')}</div><label class="check-label"><input type="checkbox" required><span>${t('I checked this day’s work and authorize approval of every pending entry for this date.', 'मैंने काम जाँचा है और इस तारीख की सभी बाकी एंट्री मंज़ूर करता हूँ।')}</span></label><div class="form-error" role="alert"></div>${submitButton(t('Approve this day', 'यह दिन मंज़ूर करें'))}</form>`, { wide: true }));
}
async function payrollPreview(workerId, start = state.data.start, end = state.data.end) {
  preview = await api(`/payroll/preview${qs({ worker_id: workerId, start, end })}`);
  preview.request_id = uid(); preview.stale = false;
  showDialog(renderPayrollDialog);
}
function renderPayrollDialog() {
  const p = preview; if (!p) return;
  const pending = n(p.pending_count), negative = n(p.net) < 0, zero = n(p.net) === 0;
  const canSettle = !pending && !negative && !p.stale && (p.entries?.length || p.advance_entries?.length);
  const share = safeURL(p.whatsapp_url, 'whatsapp'), upi = safeURL(p.upi_uri, 'upi'), qr = safeURL(p.qr_url);
  openDialog(t('A clear payment breakdown', 'भुगतान का साफ़ हिसाब'), `<div class="confirmation-summary"><h3>${esc(p.worker.name)}</h3><p>${dateLabel(p.start)} — ${dateLabel(p.end)}</p><div class="money-breakdown">${moneyRow(t('Base earnings', 'मूल कमाई'), p.base)}${moneyRow(t('Overtime', 'ओवरटाइम'), p.overtime)}${moneyRow(t('Advances', 'अग्रिम'), -n(p.advances))}${moneyRow(t('Net balance', 'शुद्ध हिसाब'), p.net, true)}</div><p>${t('Earlier balances included', 'पहले का बाकी हिसाब शामिल')}: ${t('base', 'मूल')} ${money(p.carry_in?.base)}, ${t('OT', 'ओवरटाइम')} ${money(p.carry_in?.overtime)}, ${t('advances', 'अग्रिम')} ${money(p.carry_in?.advances)}</p></div><details><summary style="min-height:52px;cursor:pointer">${t('Included work and advances', 'शामिल काम और अग्रिम')}</summary>${(p.entries || []).map(s => `<div class="history-item"><strong>${dateLabel(s.work_date, true)}</strong><p>${submissionText(s)} · ${money(s.total)}</p></div>`).join('')}${(p.advance_entries || []).map(a => `<div class="history-item">${dateLabel(a.date, true)} · ${t('Advance', 'अग्रिम')} ${money(a.amount)}<p>${esc(a.note)}</p></div>`).join('') || `<p class="muted">${t('No unsettled entries.', 'कोई बाकी एंट्री नहीं।')}</p>`}</details>${share ? `<a class="btn btn-secondary" href="${esc(share)}" target="_blank" rel="noopener noreferrer" style="margin:16px 0">${icon('send')}${t('Open WhatsApp draft', 'WhatsApp मसौदा खोलें')}</a>` : ''}${pending ? `<div class="notice notice-amber">${count(pending)} ${t('entries still need review. Resolve them before recording a settlement.', 'एंट्री की समीक्षा बाकी है। भुगतान दर्ज करने से पहले जाँचें।')}</div>` : negative ? `<div class="notice notice-amber">${t('This is an advance carry-forward, not a payment. It stays in the ledger for the next cycle.', 'यह अगले चक्र का अग्रिम है, भुगतान नहीं। यह हिसाब में बना रहेगा।')}</div>` : ''}${!pending && !negative && !zero && (upi || qr) ? `<div class="qr-wrap">${qr ? `<img src="${esc(qr)}" alt="${t('UPI payment QR code', 'UPI भुगतान QR कोड')}">` : ''}<div><h3>${t('Pay in your own payment app', 'अपने भुगतान ऐप से भुगतान करें')}</h3><p>${t('Check the recipient and amount. Opening UPI or scanning this code does not confirm a transfer.', 'प्राप्तकर्ता और राशि जाँचें। UPI खोलना या QR स्कैन करना भुगतान की पुष्टि नहीं है।')}</p>${upi ? `<a class="btn btn-soft" href="${esc(upi)}" style="margin-top:12px">${t('Open UPI app', 'UPI ऐप खोलें')}</a>` : ''}</div></div>` : ''}${canSettle ? `<form id="settlement-form"><div class="form-error" role="alert"></div>${selectField(t('How was this settled?', 'भुगतान कैसे हुआ?'), 'method', zero ? [['adjustment', t('Zero-balance adjustment', 'शून्य हिसाब समायोजन')]] : [['cash', t('Cash handed over', 'नकद दिया')], ['upi', t('UPI payment completed', 'UPI भुगतान पूरा')]], zero ? 'adjustment' : 'cash')}${field(t('Payment reference / note', 'भुगतान संदर्भ / नोट'), 'reference', '', { attrs: 'maxlength="120"', hint: t('For UPI, enter the bank transaction reference (at least 4 characters).', 'UPI के लिए बैंक लेनदेन संदर्भ डालें (कम से कम 4 अक्षर)।') })}<label class="check-label"><input name="confirmed" type="checkbox" required><span>${zero ? t('I checked and confirm this zero-balance ledger adjustment.', 'मैंने जाँचकर इस शून्य हिसाब समायोजन की पुष्टि की है।') : t('I have actually paid this worker and verified the cash handover or successful UPI transaction. This app cannot verify payment.', 'मैंने सदस्य को सच में भुगतान दिया और नकद देना या सफल UPI लेनदेन जाँचा है। ऐप भुगतान सत्यापित नहीं करता।')}</span></label><button class="btn" type="submit">${zero ? t('Record adjustment', 'समायोजन दर्ज करें') : t('Record confirmed payment', 'पुष्टि किया भुगतान दर्ज करें')}</button></form>` : ''}<div id="stale-preview" class="${p.stale ? '' : 'hidden'} notice notice-amber" style="margin-top:16px">${t('The ledger changed. Refresh and check every amount again before paying or recording a settlement.', 'हिसाब बदल गया। भुगतान या दर्ज करने से पहले रीफ़्रेश करके राशि फिर जाँचें।')}</div><div class="form-actions">${actionButton('pay-refresh', t('Refresh breakdown', 'हिसाब रीफ़्रेश करें'), 'refresh-cw', '', 'btn-secondary')}</div><p class="small muted" style="margin-top:15px">${t('Recording a settlement locks these work and advance entries permanently.', 'भुगतान दर्ज होने पर ये काम और अग्रिम एंट्री स्थायी रूप से लॉक होंगी।')}</p>`, { wide: true });
  updateSettlementMethod();
}
function updateSettlementMethod() {
  const form = $('#settlement-form'); if (!form) return;
  const isUPI = form.elements.method.value === 'upi';
  form.elements.reference.required = isUPI; form.elements.reference.minLength = isUPI ? 4 : 0;
}
async function saveSettlement(form) {
  if (!preview || preview.stale || n(preview.pending_count) || n(preview.net) < 0) throw new Error(t('Refresh this breakdown and resolve pending work first.', 'हिसाब रीफ़्रेश करें और पहले बाकी काम जाँचें।'));
  const fd = new FormData(form), p = preview;
  const body = { worker_id: p.worker.id, start: p.start, end: p.end, fingerprint: p.fingerprint, method: fd.get('method'), reference: String(fd.get('reference') || '').trim(), confirmed: fd.get('confirmed') === 'on', request_id: p.request_id };
  const serialized = JSON.stringify({ ...body, request_id: null });
  if (p.sentPayload && p.sentPayload !== serialized) body.request_id = p.request_id = uid();
  p.sentPayload = serialized;
  try {
    const slip = await api('/settlements', { method: 'POST', body });
    finishDialog(); await loadRoute(); showDialog(() => openDialog(t('Payment recorded', 'भुगतान दर्ज हुआ'), receiptHTML(slip, true), { wide: true }));
    toast(t('Settlement recorded. The included entries are now locked.', 'भुगतान दर्ज हुआ। शामिल एंट्री अब लॉक हैं।'));
  } catch (error) {
    if (error.status === 409) {
      p.stale = true;
      $('#stale-preview')?.classList.remove('hidden');
      $$('input,select,button[type="submit"]', form).forEach(el => { el.disabled = true; });
      form.dataset.stale = 'true';
    }
    throw error;
  }
}
/* Speech fills an editable draft only; it never sends ledger requests. */
function voiceStatus(message, recording = recognizing) {
  const button = $('#mic-button'), status = $('#voice-status');
  if (button) { button.classList.toggle('listening', recording); button.setAttribute('aria-pressed', String(recording)); }
  if (status) status.textContent = message;
}
function stopVoice(abort = true) {
  voiceStopped = true; recognizing = false; voicePointer = false;
  const current = recognition;
  if (current) {
    if (abort) { recognition = null; current.onresult = null; current.onend = null; current.onerror = null; }
    try { abort ? current.abort() : current.stop(); } catch {}
  }
  voiceStatus(t('Recording stopped. Check your words before using them.', 'रिकॉर्डिंग बंद है। इस्तेमाल से पहले शब्द जाँचें।'), false);
}
function startVoice() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech || !draft || draftLocked()) return voiceStatus(t('Voice is unavailable here. Type your words or use the form below.', 'यहाँ आवाज़ उपलब्ध नहीं। शब्द लिखें या नीचे फ़ॉर्म भरें।'), false);
  stopVoice();
  const current = new Speech(), activeDraft = draft;
  recognition = current; voiceStopped = false; recognizing = true;
  current.lang = 'hi-IN'; current.continuous = true; current.interimResults = true;
  const prefix = ($('#transcript')?.value || '').trim();
  current.onstart = () => { if (recognition === current) voiceStatus(t('Listening in Hindi. Tap to stop.', 'हिन्दी में सुन रहे हैं। रोकने के लिए टैप करें।'), true); };
  current.onresult = event => {
    if (draft !== activeDraft || recognition !== current) return;
    const spoken = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ');
    activeDraft.transcript = [prefix, spoken].filter(Boolean).join(' '); activeDraft.dirty = true;
    const input = $('#transcript'); if (input) input.value = activeDraft.transcript;
  };
  current.onerror = event => {
    if (recognition !== current) return;
    recognizing = false;
    const message = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('Microphone permission was denied. You can type instead.', 'माइक्रोफ़ोन की अनुमति नहीं मिली। आप लिख सकते हैं।') : event.error === 'no-speech' ? t('No speech heard. Try again, or type your work.', 'आवाज़ नहीं सुनाई दी। फिर बोलें या काम लिखें।') : t('Voice recognition stopped. Your words are kept; type or try again.', 'आवाज़ पहचान बंद हो गई। शब्द सुरक्षित हैं; लिखें या फिर कोशिश करें।');
    voiceStatus(message, false);
  };
  current.onend = () => {
    if (recognition !== current) return;
    recognition = null; recognizing = false;
    if (!$('#voice-status')?.textContent.includes(t('denied', 'अनुमति'))) voiceStatus(t('Check your words, then choose “Use these words”. Nothing has been submitted.', 'शब्द जाँचकर “इन शब्दों से विवरण भरें” चुनें। कुछ जमा नहीं हुआ।'), false);
  };
  try { current.start(); voiceStatus(t('Starting microphone…', 'माइक्रोफ़ोन शुरू हो रहा है…'), true); }
  catch { recognition = null; recognizing = false; voiceStatus(t('Microphone could not start. Type your work below.', 'माइक्रोफ़ोन शुरू नहीं हुआ। नीचे काम लिखें।'), false); }
}
function bindVoice() {
  const input = $('#transcript'); if (input && draft) input.value = draft.transcript || '';
  if (draft?.voiceWarnings) renderVoiceWarnings();
  const button = $('#mic-button'); if (!button || button.dataset.bound) return;
  button.dataset.bound = 'true';
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) { button.disabled = true; voiceStatus(t('Voice is unavailable in this browser. Type your words below.', 'इस ब्राउज़र में आवाज़ उपलब्ध नहीं। नीचे शब्द लिखें।'), false); return; }
  let ignoreClick = false, started = false;
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); voicePointer = true; voiceStartTime = Date.now(); started = !recognizing; ignoreClick = true;
    if (started) startVoice();
    try { button.setPointerCapture(event.pointerId); } catch {}
  });
  button.addEventListener('pointerup', () => {
    if (!started || Date.now() - voiceStartTime >= 350) stopVoice(false);
    voicePointer = false; setTimeout(() => { ignoreClick = false; }, 0);
  });
  button.addEventListener('pointercancel', () => stopVoice());
  button.addEventListener('click', event => { if (!ignoreClick && event.detail === 0) recognizing ? stopVoice(false) : startVoice(); });
}
function applyTranscript() {
  syncDraft(); stopVoice();
  if (!draft || draftLocked()) return;
  const result = parseVoice(draft.transcript || '', draft.catalog.filter(task => task.active));
  const warnings = [...(result.warnings || [])];
  if (result.matched) {
    if (draft.worker.payment_model === 'piece' && result.items.length) draft.items = result.items.map(item => ({ task_id: item.task_id, quantity: item.quantity }));
    if (draft.worker.payment_model !== 'piece' && result.items.length) warnings.push(t('This member is paid by attendance. Task quantities were not added.', 'इस सदस्य का वेतन उपस्थिति से है। काम की मात्रा नहीं जोड़ी गई।'));
    if (draft.worker.payment_model !== 'piece' && result.attendance) draft.attendance = result.attendance;
    draft.ot_hours = result.ot_hours; draft.dirty = true;
    drawEntry();
  } else warnings.push(t('No supported work was found. Keep your words and enter the details manually.', 'समर्थित काम नहीं मिला। शब्द रखें और विवरण खुद भरें।'));
  draft.voiceWarnings = warnings;
  renderVoiceWarnings();
  toast(t('Check every quantity, attendance and overtime before submitting.', 'जमा करने से पहले मात्रा, उपस्थिति और ओवरटाइम जाँचें।'));
}
function renderVoiceWarnings() {
  const box = $('#voice-warnings'); if (!box) return;
  const warnings = draft?.voiceWarnings || [];
  box.className = warnings.length ? 'notice notice-amber' : 'notice';
  box.textContent = warnings.length ? warnings.join(' ') : t('Draft filled. Review and correct it below; nothing was submitted.', 'मसौदा भरा गया। नीचे जाँचकर सुधारें; कुछ जमा नहीं हुआ।');
}
function choosePhoto(input) {
  if (!draft) return;
  const file = input.files?.[0]; if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    input.value = ''; toast(t('Choose a JPEG, PNG or WebP image no larger than 5 MB.', 'अधिकतम 5 MB का JPEG, PNG या WebP फ़ोटो चुनें।'), true); return;
  }
  clearPhoto(); photoFile = file; photoObjectURL = URL.createObjectURL(file); draft.dirty = true;
  $('#photo-preview').innerHTML = photoPreviewHTML(); icons();
}
/* Delegated actions, forms and application lifecycle. */
function normalizedPhone(value) { return String(value || '').replace(/[\s()-]/g, '').replace(/^\+91/, ''); }
async function handleAction(button) {
  const action = button.dataset.action, id = button.dataset.id;
  switch (action) {
    case 'language': switchLanguage(); break;
    case 'auth-mode': { const values = snapshotFields(app); state.authMode = button.dataset.mode; renderAuth(); restoreFields(app, values); break; }
    case 'auth-role': { const values = snapshotFields(app); state.authRole = button.dataset.role; renderAuth(); restoreFields(app, values); break; }
    case 'toggle-pin': { const input = document.getElementById(button.dataset.target); if (input) input.type = input.type === 'password' ? 'text' : 'password'; break; }
    case 'close-modal': closeDialog(); break;
    case 'refresh': await loadRoute(); break;
    case 'logout': confirmDialog(t('Sign out of this workspace?', 'इस कार्यस्थल से साइन आउट करें?'), t('Unsaved drafts will be cleared from this device.', 'बिना सेव किए मसौदे इस डिवाइस से हटेंगे।'), async () => { await api('/auth/logout', { method: 'POST' }); clearPrivateState(); state.authMode = 'login'; renderAuth(); }, t('Sign out', 'साइन आउट')); break;
    case 'copy-code':
      try { await navigator.clipboard.writeText(state.session.business.id); toast(t('Business code copied.', 'व्यवसाय कोड कॉपी हुआ।')); }
      catch { showDialog(() => openDialog(t('Your business code', 'आपका व्यवसाय कोड'), `<p style="font-size:24px;user-select:all">${esc(state.session.business.id)}</p><p>${t('Select and copy this code to share with your team.', 'टीम को देने के लिए यह कोड चुनकर कॉपी करें।')}</p>`)); } break;
    case 'install': if (state.installPrompt) { await state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; button.remove(); } break;
    case 'worker-add': workerDialog(); break;
    case 'worker-edit': { const worker = state.data.items?.find(w => w.id === id) || (await api('/workers')).items.find(w => w.id === id); if (worker) workerDialog(worker); break; }
    case 'task-add': taskDialog(); break;
    case 'task-edit': { const task = state.data.items?.find(x => x.id === id); if (task) taskDialog(task); break; }
    case 'owner-entry': await ownerEntryDialog(); break;
    case 'entry-add': {
      syncDraft(); const task = draft.catalog.find(c => c.active && !draft.items.some(i => i.task_id === c.id));
      if (!task) { toast(t('Every active task is already listed. Update its quantity instead.', 'हर सक्रिय काम पहले से है। उसी की मात्रा बदलें।')); break; }
      if (draft.items.length >= 50) break;
      draft.items.push({ task_id: task.id, quantity: '' }); draft.dirty = true; $('#entry-items').innerHTML = entryItemsHTML(); icons(); updateEstimate(); break;
    }
    case 'entry-remove': syncDraft(); draft.items.splice(n(button.dataset.index), 1); draft.dirty = true; $('#entry-items').innerHTML = entryItemsHTML(); icons(); updateEstimate(); break;
    case 'entry-back': if (draft?.ownerEntry) drawEntry(); else { finishDialog(); drawEntry(); } break;
    case 'entry-change-day': entryDateDialog(); break;
    case 'apply-transcript': applyTranscript(); break;
    case 'photo-remove': clearPhoto(); if (draft) { draft.photo_id = null; draft.photo_url = ''; draft.dirty = true; } if ($('#photo')) $('#photo').value = ''; if ($('#photo-preview')) $('#photo-preview').innerHTML = ''; button.closest('.photo-preview')?.remove(); break;
    case 'review-entry': await entryDetails(id, true); break;
    case 'view-entry': await entryDetails(id); break;
    case 'edit-entry': await editEntry(id); break;
    case 'approve-all': await approveDayDialog(); break;
    case 'advance-add': await advanceDialog(); break;
    case 'advance-void': voidAdvanceDialog(id); break;
    case 'pay-preview': await payrollPreview(id); break;
    case 'pay-refresh': if (preview) await payrollPreview(preview.worker.id, preview.start, preview.end); break;
    case 'settlement-history': { const history = await api('/settlements'); showDialog(() => openDialog(t('Recorded payment history', 'दर्ज भुगतान इतिहास'), history.items.length ? `<div class="stack">${history.items.map(s => receiptHTML(s)).join('')}</div>` : empty(t('No settlements yet.', 'अभी भुगतान दर्ज नहीं हैं।'), t('Confirmed settlements will be kept here.', 'पुष्टि किए भुगतान यहाँ रहेंगे।'), 'receipt'), { wide: true })); break; }
    case 'view-slip': { const slip = await api(`/settlements/${encodeURIComponent(id)}`); showDialog(() => openDialog(t('Payment receipt', 'भुगतान पर्ची'), receiptHTML(slip, true), { wide: true })); break; }
    case 'print': window.print(); break;
    case 'audit-load': {
      const data = await api('/audit'); const target = $('#audit-list');
      if (target) target.innerHTML = data.items.length ? data.items.map(a => `<div class="history-item"><strong>${esc(a.action)}</strong><p class="small muted">${dateLabel(a.created_at)} · ${esc(a.actor_id)} · ${esc(a.entity_id)}</p>${a.detail && Object.keys(a.detail).length ? `<p class="small" style="overflow-wrap:anywhere">${esc(JSON.stringify(a.detail))}</p>` : ''}</div>`).join('') : empty(t('No activity yet.', 'अभी कोई गतिविधि नहीं।'), t('Changes will appear here.', 'बदलाव यहाँ दिखेंगे।'), 'history', '', true); break;
    }
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || button.dataset.pending || busy || $('[data-busy="true"]')) return;
  event.preventDefault();
  button.dataset.pending = 'true';
  Promise.resolve(handleAction(button)).catch(error => toast(error.message, true)).finally(() => { delete button.dataset.pending; });
});
document.addEventListener('submit', event => {
  const form = event.target; if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.dataset.stale === 'true') return;
  if (form.id === 'entry-form') { checkEntry(); return; }
  const submitter = event.submitter;
  submitBusy(form, async () => {
    const fd = new FormData(form);
    switch (form.id) {
      case 'auth-form': {
        const register = state.authMode === 'register';
        const body = register ? { name: fd.get('name'), owner_name: fd.get('owner_name'), owner_phone: normalizedPhone(fd.get('owner_phone')), pin: fd.get('pin') } : { business_id: String(fd.get('business_id')).trim().toUpperCase(), phone: normalizedPhone(fd.get('phone')), pin: fd.get('pin'), role: state.authRole };
        const session = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body, quiet: true });
        setSession(session); await loadRoute();
        if (register) toast(`${t('Workspace created. Your business code is', 'कार्यस्थल बना। व्यवसाय कोड है')} ${session.business.id}`);
        break;
      }
      case 'confirm-form': { const action = confirmationAction; if (action) await action(); finishDialog(); break; }
      case 'worker-form': {
        const id = form.dataset.id;
        const body = { name: fd.get('name'), phone: fd.get('phone'), payment_model: fd.get('payment_model'), salary: fd.get('payment_model') === 'piece' ? 0 : n(fd.get('salary')), upi_id: fd.get('upi_id'), overtime_policy: fd.get('inherit_ot') === 'on' ? null : readPolicy(fd), ...(id ? { active: fd.get('active') === 'on' } : {}) };
        if (fd.get('worker_pin')) body.pin = fd.get('worker_pin');
        await api(id ? `/workers/${encodeURIComponent(id)}` : '/workers', { method: id ? 'PATCH' : 'POST', body });
        finishDialog(); toast(t('Team member saved.', 'सदस्य सेव हुआ।')); await loadRoute(); break;
      }
      case 'task-form': {
        const id = form.dataset.id;
        const body = { name: fd.get('name'), unit: fd.get('unit'), rate: n(fd.get('rate')), aliases: String(fd.get('aliases')).split(',').map(x => x.trim()).filter(Boolean), ...(id ? { active: fd.get('active') === 'on' } : {}) };
        await api(id ? `/tasks/${encodeURIComponent(id)}` : '/tasks', { method: id ? 'PATCH' : 'POST', body });
        finishDialog(); toast(t('Task saved.', 'काम सेव हुआ।')); await loadRoute(); break;
      }
      case 'business-form': {
        state.session.business = await api('/business', { method: 'PATCH', body: { name: fd.get('name'), owner_name: fd.get('owner_name'), settlement_cycle: fd.get('settlement_cycle'), salary_divisor: n(fd.get('salary_divisor')), overtime_policy: readPolicy(fd) } });
        state.session.user.name = state.session.business.owner_name; toast(t('Business settings saved.', 'व्यवसाय सेटिंग्स सेव हुईं।')); await loadRoute(); break;
      }
      case 'pin-form':
        if (fd.get('new_pin') !== fd.get('confirm_pin')) throw new Error(t('The new PINs do not match.', 'नए PIN एक जैसे नहीं हैं।'));
        await api('/auth/change-pin', { method: 'POST', body: { old_pin: fd.get('old_pin'), new_pin: fd.get('new_pin') }, quiet: true });
        clearPrivateState(); state.authMode = 'login'; renderAuth(); toast(t('PIN changed. Sign in again with your new PIN.', 'PIN बदला। नए PIN से फिर साइन इन करें।')); break;
      case 'owner-entry-start': {
        const worker = state.entryWorkers.find(w => w.id === fd.get('worker_id'));
        await selectEntryDate(fd.get('entry_date'), worker, state.entryTasks, true); break;
      }
      case 'entry-date-form': {
        const { worker, catalog, ownerEntry } = state.entryDateContext;
        if (!ownerEntry) finishDialog();
        await selectEntryDate(fd.get('entry_date'), worker, catalog, ownerEntry); break;
      }
      case 'entry-confirm-form': await saveEntry(); break;
      case 'review-entry-form': {
        const action = submitter?.value; if (!['approve', 'reject'].includes(action)) return;
        const id = form.dataset.id, note = String(fd.get('review_note') || '');
        confirmDialog(action === 'approve' ? t('Approve and lock this work?', 'काम मंज़ूर करके लॉक करें?') : t('Return this work for correction?', 'काम सुधार के लिए वापस करें?'), action === 'approve' ? t('The recorded earnings will become payable and this entry cannot be edited.', 'दर्ज कमाई वेतन में जुड़ेगी और एंट्री बदली नहीं जा सकेगी।') : t('The worker can correct the entry and send it for review again.', 'सदस्य एंट्री सुधारकर फिर समीक्षा के लिए भेज सकता है।'), async () => { await api(`/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body: { action, note } }); toast(t('Review recorded.', 'समीक्षा दर्ज हुई।')); await loadRoute(); }, action === 'approve' ? t('Approve work', 'काम मंज़ूर करें') : t('Request correction', 'सुधार माँगें'));
        break;
      }
      case 'approve-day-form': await showDayConfirmation(fd.get('date')); break;
      case 'approve-day-confirm': {
        const result = await api('/submissions/approve-all', { method: 'POST', body: { date: form.dataset.date } });
        finishDialog(); toast(`${count(result.approved_count)} ${t('entries approved.', 'एंट्री मंज़ूर हुईं।')}`); await loadRoute(); break;
      }
      case 'advance-form': {
        const body = { worker_id: fd.get('worker_id'), date: fd.get('date'), amount: n(fd.get('amount')), note: fd.get('note'), request_id: form.dataset.requestId };
        const serialized = JSON.stringify({ ...body, request_id: null });
        if (form.dataset.sentPayload && form.dataset.sentPayload !== serialized) body.request_id = form.dataset.requestId = uid();
        form.dataset.sentPayload = serialized;
        await api('/advances', { method: 'POST', body }); finishDialog(); toast(t('Advance recorded.', 'अग्रिम दर्ज हुआ।')); await loadRoute(); break;
      }
      case 'void-advance-form': await api(`/advances/${encodeURIComponent(form.dataset.id)}/void`, { method: 'POST', body: { reason: fd.get('reason') } }); finishDialog(); toast(t('Advance voided with an audit record.', 'अग्रिम कारण सहित रद्द हुआ।')); await loadRoute(); break;
      case 'settlement-form': await saveSettlement(form); break;
      case 'review-filters': state.filters.review = Object.fromEntries(fd); await loadRoute(); break;
      case 'payroll-filters':
        if (fd.get('start') > fd.get('end')) throw new Error(t('The cycle start must be on or before its end.', 'शुरुआत की तारीख अंतिम तारीख से पहले या बराबर हो।'));
        state.filters.payroll = Object.fromEntries(fd); await loadRoute(); break;
      case 'advance-filters': state.filters.advances = Object.fromEntries(fd); await loadRoute(); break;
      case 'history-filters': state.filters.history = Object.fromEntries(fd); await loadRoute(); break;
    }
  });
});
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'worker-search') {
    const term = input.value.toLowerCase().trim(); let visible = 0;
    $$('[data-worker-search]').forEach(card => { const match = card.dataset.workerSearch.includes(term); card.classList.toggle('hidden', !match); if (match) visible++; });
    $('#worker-no-results')?.classList.toggle('hidden', visible > 0);
  }
  if (input.closest('#entry-form') && input.name !== 'work_date') { syncDraft(); if (draft) draft.dirty = true; updateEstimate(); }
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'photo') choosePhoto(input);
  if (input.closest('#worker-form')) updateWorkerFields();
  if (input.name === 'method') updateSettlementMethod();
  if ((input.name === 'work_date' && input.closest('#entry-form') && !draft?.id) || input.id === 'locked-date') {
    const previous = draft.work_date, day = input.value;
    selectEntryDate(day).catch(error => { input.value = previous; toast(error.message, true); });
  }
});
modal.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
window.addEventListener('hashchange', () => { if (!$('[data-busy="true"]', modal)) closeDialog(); loadRoute(); });
window.addEventListener('online', () => { const target = $('#connection-status'); if (target) target.innerHTML = ''; toast(t('Back online. Refresh or save when you are ready.', 'इंटरनेट जुड़ गया। तैयार होने पर रीफ़्रेश या सेव करें।')); });
window.addEventListener('offline', () => { stopVoice(); const target = $('#connection-status'); if (target) target.innerHTML = offlineHTML(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; const target = $('.topbar-actions'); if (target && !$('[data-action="install"]', target)) { target.insertAdjacentHTML('afterbegin', actionButton('install', t('Install', 'इंस्टॉल करें'), 'download', '', 'btn-ghost')); icons(); } });
window.addEventListener('appinstalled', () => { state.installPrompt = null; $$('[data-action="install"]').forEach(el => el.remove()); });
window.addEventListener('pagehide', () => { stopVoice(); clearPhoto(); });
window.addEventListener('beforeunload', event => { if (draft?.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function boot() {
  document.documentElement.lang = state.lang;
  try { setSession(await api('/auth/me', { quiet: true })); await loadRoute(); }
  catch (error) { clearPrivateState(); renderAuth(); if (error.status !== 401) toast(error.message, true); }
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
