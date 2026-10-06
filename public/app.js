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
const money = (v) => (v === null || v === undefined || v === '') ? '' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
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
    <a class="brand" href="/">PHANTIZY <small>Productions</small></a>
    <div class="links">
      <a href="/" class="${active === 'offers' ? 'active' : ''}">Offers</a>
      <a href="/offer.html" class="${active === 'new' ? 'active' : ''}">+ New offer</a>
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
  const cls = (f.wide || f.type === 'textarea') ? 'wide' : '';
  const lbl = `<label for="${id}" class="${f.required ? 'req' : ''}">${esc(f.label)}</label>`;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}">${esc(v)}</textarea>`;
  else if (f.type === 'select') {
    const opts = f.options.includes(v) || !v ? f.options : [v, ...f.options];
    input = `<select id="${id}" name="${f.key}"><option value=""></option>${opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else {
    const type = f.type === 'money' ? 'number' : (f.type || 'text');
    const extra = f.type === 'money' ? ' step="0.01" min="0" inputmode="decimal"' : f.type === 'number' ? ' step="any"' : '';
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    input = `<input type="${type}" id="${id}" name="${f.key}" value="${esc(v)}"${extra}${ph}${f.required ? ' required' : ''}>`;
  }
  return `<div class="${cls}">${lbl}${input}</div>`;
}

function readSections(container, sections) {
  const out = {};
  for (const s of sections) for (const f of s.fields) {
    const el = container.querySelector(`[name="${f.key}"]`);
    if (el) out[f.key] = el.value.trim();
  }
  return out;
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
