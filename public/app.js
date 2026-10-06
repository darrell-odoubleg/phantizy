// app.js — shared helpers for every signed-in page: API calls, the nav
// bar, toasts, and rendering a section list from fields.js into a form.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const res = await fetch('/api' + path, init);
  if (res.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, isErr) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), isErr ? 4000 : 2200);
}

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled', completed: 'Completed' };
const badge = (s) => `<span class="badge badge-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
// "$45,000" for whole dollars, "$45,000.50" when there are cents.
function money(v) {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '';
  const n = Number(v);
  const cents = Math.round(n * 100) % 100 !== 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
// Accepts "45000", "$45,000", "45,000.50"; returns a number, null if blank, NaN if not money.
function parseMoney(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Number(t) : NaN;
}
// Money inputs reformat when you leave them ($ and thousands commas).
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input[data-money]')) return;
  const n = parseMoney(el.value);
  el.classList.toggle('invalid', Number.isNaN(n));
  if (n !== null && !Number.isNaN(n)) el.value = money(n);
});
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtStamp(sql) {
  if (!sql) return '';
  const d = new Date(sql.replace(' ', 'T') + 'Z');
  return isNaN(d) ? sql : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

let ME = null;
async function initNav(active) {
  ME = (await api('/me')).user;
  const nav = document.createElement('nav');
  nav.className = 'top';
  nav.innerHTML = `
    <a class="brand" href="/"><img src="/logo-white.png" alt="Phantizy Productions"></a>
    <div class="links">
      <a href="/" class="${active === 'offers' ? 'active' : ''}">${{ production: 'Shows', accounting: 'Accounts' }[ME.role] || 'Offers'}</a>
      ${PF.ROLE_DOC_KINDS[ME.role] ? '' : `<a href="/offer.html" class="${active === 'new' ? 'active' : ''}">+ New offer</a>`}
      <a href="/admin.html" class="${active === 'admin' ? 'active' : ''}">${ME.role === 'admin' ? 'Settings' : 'Account'}</a>
      <span class="user">${esc(ME.name)}</span>
      <a href="#" id="logoutLink">Sign out</a>
    </div>`;
  document.body.prepend(nav);
  nav.querySelector('#logoutLink').onclick = async (e) => {
    e.preventDefault();
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login.html';
  };
  return ME;
}

// Fills select fields whose options live in the database (optionsFrom).
async function loadFieldOptions(sections) {
  const fields = sections.flatMap(s => s.fields).filter(f => f.optionsFrom === 'festivals');
  if (!fields.length) return;
  window.FESTIVALS = await api('/festival-options');
  const names = FESTIVALS.map(f => f.name);
  fields.forEach(f => { f.options = names; });
}

// Fills the empty festival-wide inputs in a form from the chosen festival's
// saved details (Settings → Festivals → Details). Never overwrites.
function applyFestivalDetails(form, name) {
  const fest = (window.FESTIVALS || []).find(f => f.name === name);
  if (!fest || !fest.details) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(fest.details)) {
    const el = form.querySelector(`[name="${k}"]`);
    if (el && !el.value.trim()) { el.value = v; n++; }
  }
  return n;
}

// Renders sections from fields.js as cards of inputs named by field key.
function renderSections(container, sections, data = {}) {
  container.innerHTML = sections.map(s => `
    <div class="card"><h2>${esc(s.title)}</h2><div class="grid">
      ${s.fields.map(f => fieldHtml(f, data[f.key])).join('')}
    </div></div>`).join('');
}

function fieldHtml(f, value) {
  const v = value ?? '';
  const id = 'f_' + f.key;
  const cls = (f.wide || f.type === 'textarea') ? 'wide' : f.span2 ? 'span2' : '';
  const lbl = `<label for="${id}" class="${f.required ? 'req' : ''}">${esc(f.label)}</label>`;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}">${esc(v)}</textarea>`;
  else if (f.type === 'select') {
    const opts = f.options.includes(v) || !v ? f.options : [v, ...f.options];
    input = `<select id="${id}" name="${f.key}"><option value=""></option>${opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else {
    const type = f.type === 'money' ? 'text' : (f.type || 'text');
    const extra = f.type === 'money' ? ' data-money inputmode="decimal" placeholder="$0"' : f.type === 'number' ? ' step="any"' : '';
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    const shown = f.type === 'money' ? money(v) : v;
    input = `<input type="${type}" id="${id}" name="${f.key}" value="${esc(shown)}"${extra}${ph}${f.required ? ' required' : ''}>`;
  }
  return `<div class="${cls}">${lbl}${input}</div>`;
}

function readSections(container, sections) {
  const out = {};
  for (const s of sections) for (const f of s.fields) {
    const el = container.querySelector(`[name="${f.key}"]`);
    if (!el) continue;
    if (f.type === 'money') {
      const n = parseMoney(el.value);
      if (Number.isNaN(n)) { el.classList.add('invalid'); el.focus(); throw new Error(`${f.label}: enter a dollar amount like $45,000`); }
      out[f.key] = n === null ? '' : String(n);
    } else out[f.key] = el.value.trim();
  }
  return out;
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
