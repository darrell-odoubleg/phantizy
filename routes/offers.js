// offers.js — offers, advance sheet, document uploads (contracts / riders),
// per-offer checklist, and the offer / advance sheet PDFs.

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db/init');
const { makeUpload, sendStoredFile } = require('../server/upload');
const { requireAdmin } = require('../server/auth');
const { OFFER_FIELDS, ADVANCE_FIELDS, PAYMENT_FIELDS, STATUSES, DOC_KINDS, RESTRICTED_STATUSES, ROLE_DOC_KINDS, WELCOME_FILE_KINDS } = require('../public/fields');
const { offerSheetPdf, advanceSheetPdf, welcomeLetterPdf, fillTemplate, welcomeVars } = require('../server/pdf');
const mailer = require('../server/mailer');
const { PassThrough } = require('stream');

const router = express.Router();
const UPLOAD_DIR = db.UPLOAD_DIR;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = makeUpload(req => String(Number(req.params.id)));

// ---- helpers ----

function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f.key in body)) continue;
    let v = body[f.key];
    if (v === '' || v === undefined) v = null;
    else if (f.type === 'number' || f.type === 'money') {
      const raw = String(v).replace(/[$,\s]/g, '');
      v = raw === '' ? null : Number(raw);
      if (v !== null && !isFinite(v)) {
        throw Object.assign(new Error(`${f.label}: "${body[f.key]}" isn't a number`), { status: 400 });
      }
    } else v = String(v);
    out[f.key] = v;
  }
  return out;
}

function updateRow(table, whereCol, whereVal, values) {
  const keys = Object.keys(values);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE ${whereCol} = @__id`)
    .run({ ...values, __id: whereVal });
}

function autoCheck(offerId, key, who) {
  db.prepare(`UPDATE checklist_items SET done = 1, done_by_name = ?, done_at = datetime('now')
              WHERE offer_id = ? AND auto_key = ? AND done = 0`).run(who, offerId, key);
}

function getOffer(id) {
  return db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
}

// Restricted roles (see fields.js ROLE_DOC_KINDS) see accepted/completed
// shows only, and only these offer fields.
const ROLE_OFFER_KEYS = {
  // Production: no deal terms, agent or money — just what's needed to advance the show.
  production: ['id', 'status', 'artist_name', 'festival_name', 'festival_dates', 'festival_gates',
    'festival_presenter', 'festival_contact', 'venue_name', 'venue_address', 'venue_city', 'venue_state', 'ages',
    'event_date', 'stage', 'billing', 'show_time', 'set_length', 'changeover', 'production_provided',
    'credentials', 'guest_list_offer', 'artist_parking', 'ground_transport'],
  // Accounting: the whole offer (minus internal notes) plus payments.
  accounting: ['id', 'status', 'created_by_name',
    ...OFFER_FIELDS.filter(f => !f.internal).map(f => f.key), ...PAYMENT_FIELDS.map(f => f.key)],
};
const restrictedRole = (req) => (req.user && ROLE_DOC_KINDS[req.user.role] ? req.user.role : null);
const sqlList = (arr) => arr.map(s => `'${s}'`).join(',');
const only = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));

function loadOffer(req, res, next) {
  const offer = getOffer(Number(req.params.id));
  if (!offer || (restrictedRole(req) && !RESTRICTED_STATUSES.includes(offer.status))) {
    return res.status(404).json({ error: 'Offer not found' });
  }
  req.offer = offer;
  next();
}

// ---- offers ----

router.get('/offers', (req, res) => {
  const { status, q, festival } = req.query;
  const where = [];
  const params = {};
  if (status && STATUSES.includes(status)) { where.push('o.status = @status'); params.status = status; }
  if (restrictedRole(req)) where.push(`o.status IN (${sqlList(RESTRICTED_STATUSES)})`);
  if (festival) { where.push('o.festival_name = @festival'); params.festival = festival; }
  if (q) {
    where.push("(o.artist_name LIKE @q OR o.festival_name LIKE @q OR o.venue_name LIKE @q OR o.stage LIKE @q OR o.venue_city LIKE @q OR o.agency LIKE @q)");
    params.q = `%${q}%`;
  }
  const rows = db.prepare(`
    SELECT o.id, o.status, o.artist_name, o.festival_name, o.festival_dates, o.stage, o.billing, o.show_time, o.event_date, o.venue_name, o.venue_city, o.venue_state,
           o.guarantee, o.deal_type, o.agency, o.created_by_name, o.updated_at,
           (SELECT COUNT(*) FROM checklist_items c WHERE c.offer_id = o.id) AS checklist_total,
           (SELECT COUNT(*) FROM checklist_items c WHERE c.offer_id = o.id AND c.done = 1) AS checklist_done,
           (SELECT COUNT(*) FROM documents d WHERE d.offer_id = o.id AND d.kind = 'contract') AS contract_count,
           (SELECT COUNT(*) FROM documents d WHERE d.offer_id = o.id AND d.kind IN ('rider_technical','rider_hospitality','stage_plot')) AS rider_count,
           (SELECT COUNT(*) FROM documents d WHERE d.offer_id = o.id AND d.kind = 'w9') AS w9_count,
           (SELECT COUNT(*) FROM documents d WHERE d.offer_id = o.id AND d.kind = 'coi') AS coi_count,
           (SELECT COUNT(*) FROM documents d WHERE d.offer_id = o.id AND d.kind = 'fec') AS fec_count,
           o.deposit_amount, o.deposit_due, o.deposit_paid_date, o.settlement_date, o.balance_paid_date
    FROM offers o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (o.event_date IS NULL), o.event_date, o.show_time, o.id DESC`).all(params);
  const base = ['id', 'status', 'artist_name', 'festival_name', 'festival_dates', 'stage', 'billing', 'show_time',
    'event_date', 'venue_name', 'venue_city', 'venue_state'];
  if (restrictedRole(req) === 'production') return res.json(rows.map(r => only(r, [...base, 'rider_count'])));
  if (restrictedRole(req) === 'accounting') {
    return res.json(rows.map(r => only(r, [...base, 'guarantee', 'deposit_amount', 'deposit_due', 'deposit_paid_date',
      'settlement_date', 'balance_paid_date', 'contract_count', 'fec_count', 'w9_count', 'coi_count'])));
  }
  res.json(rows);
});

router.get('/festivals', (req, res) => {
  const limit = restrictedRole(req) ? `AND status IN (${sqlList(RESTRICTED_STATUSES)})` : '';
  res.json(db.prepare(`SELECT festival_name AS name, COUNT(*) AS offers, MIN(event_date) AS first_date
    FROM offers WHERE festival_name IS NOT NULL ${limit} GROUP BY festival_name ORDER BY (first_date IS NULL), first_date, name`).all());
});

// Festival must come from the Settings list (an offer may keep a festival
// that has since been hidden).
function checkFestival(name, current) {
  if (name === current) return null;
  const ok = db.prepare('SELECT 1 FROM festivals WHERE name = ? AND active = 1').get(name);
  return ok ? null : 'Pick a festival from the list (admins can add festivals in Settings)';
}

function createOffer(values, user) {
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO offers (created_by, created_by_name) VALUES (?, ?)').run(user.id, user.name);
    const offerId = info.lastInsertRowid;
    updateRow('offers', 'id', offerId, values);
    // Advance sheet starts with what the offer already knows.
    db.prepare('INSERT INTO advances (offer_id, doors_time, headliner_set_time, ground_transport) VALUES (?, ?, ?, ?)')
      .run(offerId, values.festival_gates || null, values.show_time || null, values.ground_transport || null);
    const ins = db.prepare('INSERT INTO checklist_items (offer_id, label, auto_key, position) VALUES (?, ?, ?, ?)');
    db.prepare('SELECT label, auto_key, position FROM checklist_template ORDER BY position, id').all()
      .forEach(t => ins.run(offerId, t.label, t.auto_key, t.position));
    return offerId;
  })();
}

router.post('/offers', (req, res) => {
  const values = pick(req.body || {}, OFFER_FIELDS);
  if (!values.festival_name) return res.status(400).json({ error: 'Festival is required' });
  const festErr = checkFestival(values.festival_name);
  if (festErr) return res.status(400).json({ error: festErr });
  if (!values.artist_name) return res.status(400).json({ error: 'Artist is required' });
  res.json({ id: createOffer(values, req.user) });
});

router.get('/offers/:id', loadOffer, (req, res) => {
  const id = req.offer.id;
  const docs = db.prepare('SELECT id, kind, label, original_name, mime_type, size, uploaded_by_name, uploaded_at FROM documents WHERE offer_id = ? ORDER BY uploaded_at DESC').all(id);
  const role = restrictedRole(req);
  if (role) {
    const out = {
      offer: only(req.offer, ROLE_OFFER_KEYS[role]),
      documents: docs.filter(d => ROLE_DOC_KINDS[role].includes(d.kind)),
    };
    if (role === 'production') out.advance = db.prepare('SELECT * FROM advances WHERE offer_id = ?').get(id) || {};
    return res.json(out);
  }
  res.json({
    offer: req.offer,
    advance: db.prepare('SELECT * FROM advances WHERE offer_id = ?').get(id) || {},
    documents: docs,
    checklist: db.prepare('SELECT * FROM checklist_items WHERE offer_id = ? ORDER BY position, id').all(id),
  });
});

router.put('/offers/:id', loadOffer, (req, res) => {
  const values = pick(req.body || {}, OFFER_FIELDS);
  if ('artist_name' in values && !values.artist_name) return res.status(400).json({ error: 'Artist is required' });
  if ('festival_name' in values && !values.festival_name) return res.status(400).json({ error: 'Festival is required' });
  if ('festival_name' in values) {
    const festErr = checkFestival(values.festival_name, req.offer.festival_name);
    if (festErr) return res.status(400).json({ error: festErr });
  }
  updateRow('offers', 'id', req.offer.id, values);
  res.json({ ok: true });
});

router.patch('/offers/:id/status', loadOffer, (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  db.prepare("UPDATE offers SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.offer.id);
  const id = req.offer.id;
  if (status === 'sent') autoCheck(id, 'status_sent', req.user.name);
  if (status === 'accepted') { autoCheck(id, 'status_sent', req.user.name); autoCheck(id, 'status_accepted', req.user.name); }
  if (status === 'completed') autoCheck(id, 'status_completed', req.user.name);
  res.json({ ok: true });
});

router.delete('/offers/:id', requireAdmin, loadOffer, (req, res) => {
  db.prepare('DELETE FROM offers WHERE id = ?').run(req.offer.id);
  fs.rmSync(path.join(UPLOAD_DIR, String(req.offer.id)), { recursive: true, force: true });
  res.json({ ok: true });
});

// ---- advance sheet ----

router.put('/offers/:id/advance', loadOffer, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO advances (offer_id) VALUES (?)').run(req.offer.id);
  updateRow('advances', 'offer_id', req.offer.id, pick(req.body || {}, ADVANCE_FIELDS));
  res.json({ ok: true });
});

// ---- payments (accounting) ----

router.put('/offers/:id/payments', loadOffer, (req, res) => {
  const values = pick(req.body || {}, PAYMENT_FIELDS);
  updateRow('offers', 'id', req.offer.id, values);
  // A newly entered date ticks its checklist item (clearing it doesn't untick).
  for (const f of PAYMENT_FIELDS) if (f.auto && values[f.key]) autoCheck(req.offer.id, f.auto, req.user.name);
  res.json({ ok: true });
});

// ---- PDFs ----

function sendPdf(res, filename, build) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^\w.\- ]+/g, '')}"`);
  build(res);
}
function pdfName(offer, kind) {
  return `${kind} - ${offer.artist_name || 'Offer'}${offer.festival_name ? ' - ' + offer.festival_name : ''}.pdf`;
}

router.get('/offers/:id/offer-sheet.pdf', loadOffer, (req, res) => {
  sendPdf(res, pdfName(req.offer, 'Offer'), out => offerSheetPdf(req.offer, out));
});

router.get('/offers/:id/advance-sheet.pdf', loadOffer, (req, res) => {
  const advance = db.prepare('SELECT * FROM advances WHERE offer_id = ?').get(req.offer.id) || {};
  sendPdf(res, pdfName(req.offer, 'Advance'), out => advanceSheetPdf(req.offer, advance, out));
});

// ---- welcome package (letter to the tour manager) ----

function festivalWelcome(offer) {
  const row = db.prepare('SELECT welcome FROM festivals WHERE name = ?').get(offer.festival_name);
  try { return (row && JSON.parse(row.welcome)) || {}; } catch { return {}; }
}
// Files that go out with this show's welcome package: the festival's shared
// files (audio/lighting specs, plot, directions, map) plus this show's run of show.
function welcomeAttachments(offer) {
  const fest = db.prepare(`SELECT ff.* FROM festival_files ff JOIN festivals f ON f.id = ff.festival_id
    WHERE f.name = ? ORDER BY ff.uploaded_at`).all(offer.festival_name)
    .map(f => ({ source: 'festival', id: f.id, kind: f.kind, label: WELCOME_FILE_KINDS[f.kind] || 'Other',
      name: f.original_name, size: f.size, mime: f.mime_type,
      path: path.join(UPLOAD_DIR, 'festivals', String(f.festival_id), path.basename(f.stored_name)) }));
  const ros = db.prepare("SELECT * FROM documents WHERE offer_id = ? AND kind = 'run_of_show' ORDER BY uploaded_at").all(offer.id)
    .map(d => ({ source: 'offer', id: d.id, kind: d.kind, label: 'Run of show',
      name: d.original_name, size: d.size, mime: d.mime_type,
      path: path.join(UPLOAD_DIR, String(d.offer_id), path.basename(d.stored_name)) }));
  // Festival files in their defined order, then the run of show.
  const order = Object.keys(WELCOME_FILE_KINDS);
  fest.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return [...fest, ...ros];
}
const publicAttachment = ({ path: _p, ...a }) => a;
const enclosureNames = (atts) => atts.map(a => a.label === 'Other' ? a.name : a.label);

function getAdvance(offerId) {
  return db.prepare('SELECT * FROM advances WHERE offer_id = ?').get(offerId) || {};
}
function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', c => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    build(out);
  });
}
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
function emailList(v, label, required) {
  const list = String(v || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (required && !list.length) throw Object.assign(new Error(`${label}: enter an email address`), { status: 400 });
  const bad = list.find(a => !EMAIL_RE.test(a));
  if (bad) throw Object.assign(new Error(`${label}: "${bad}" isn't a valid email address`), { status: 400 });
  if (list.length > 10) throw Object.assign(new Error(`${label}: 10 addresses at most`), { status: 400 });
  return list;
}

router.get('/offers/:id/welcome.pdf', loadOffer, (req, res) => {
  const enclosures = enclosureNames(welcomeAttachments(req.offer));
  sendPdf(res, pdfName(req.offer, 'Welcome Package'), out => welcomeLetterPdf(req.offer, getAdvance(req.offer.id), festivalWelcome(req.offer), out, enclosures));
});

// Draft of the email (editable in the browser) plus send history.
router.get('/offers/:id/welcome', loadOffer, (req, res) => {
  const adv = getAdvance(req.offer.id);
  const welcome = festivalWelcome(req.offer);
  const vars = welcomeVars(req.offer, adv, welcome);
  const first = (adv.tour_manager_name || '').trim().split(/\s+/)[0] || 'there';
  const message = [
    `Hi ${first},`,
    '',
    `Welcome to ${vars.festival || 'the festival'}! We're looking forward to having ${vars.artist} with us${vars.date ? ' on ' + vars.date : ''}. Your welcome package is attached with everything you'll need for show day.`,
    '',
    welcome.dos_name ? `Your day of show contact is ${[welcome.dos_name, welcome.dos_phone].filter(Boolean).join(', ')}.` : null,
    welcome.dos_name ? '' : null,
    'Please reply with any questions.',
    '',
    'Thanks,',
    req.user.name,
    process.env.COMPANY_NAME || 'Phantizy Productions',
  ].filter(l => l !== null).join('\n');
  res.json({
    configured: mailer.isConfigured(),
    from: mailer.fromAddress(),
    hasFestivalText: !!(welcome.intro || (welcome.sections || []).length),
    attachments: welcomeAttachments(req.offer).map(publicAttachment),
    to: adv.tour_manager_email || '',
    cc: req.user.email,
    // Festival's own subject line (Settings → Festivals → Details & welcome), else a default.
    subject: welcome.subject ? fillTemplate(welcome.subject, vars)
      : `${vars.festival || 'Festival'} - Welcome Package`,
    message,
    log: db.prepare(`SELECT to_addr, cc_addr, subject, sent_by_name, sent_at FROM email_log
                     WHERE offer_id = ? AND kind = 'welcome' ORDER BY sent_at DESC LIMIT 10`).all(req.offer.id),
  });
});

router.post('/offers/:id/welcome/send', loadOffer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const to = emailList(b.to, 'To', true);
    const cc = emailList(b.cc, 'CC', false);
    const subject = String(b.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 250);
    const text = String(b.message || '').slice(0, 20000);
    if (!subject) throw Object.assign(new Error('Subject is required'), { status: 400 });
    const adv = getAdvance(req.offer.id);
    // Only files that belong to this festival / this show can be attached.
    const wanted = new Set((Array.isArray(b.attach) ? b.attach : []).map(String));
    const files = welcomeAttachments(req.offer).filter(a => wanted.has(`${a.source}:${a.id}`));
    const total = files.reduce((n, f) => n + (f.size || 0), 0);
    if (total > 20 * 1024 * 1024) throw Object.assign(new Error('Attachments are over 20 MB, which most mail servers reject. Untick some files.'), { status: 400 });
    const attachments = [{
      filename: pdfName(req.offer, 'Welcome Package').replace(/[^\w.\- ]+/g, ''),
      content: await pdfBuffer(out => welcomeLetterPdf(req.offer, adv, festivalWelcome(req.offer), out, enclosureNames(files))),
      contentType: 'application/pdf',
    }];
    for (const f of files) {
      if (!fs.existsSync(f.path)) throw Object.assign(new Error(`"${f.name}" is missing on the server; re-upload it`), { status: 409 });
      attachments.push({ filename: f.name, content: fs.readFileSync(f.path), contentType: f.mime || undefined });
    }
    if (b.attach_advance) {
      attachments.push({
        filename: pdfName(req.offer, 'Advance').replace(/[^\w.\- ]+/g, ''),
        content: await pdfBuffer(out => advanceSheetPdf(req.offer, adv, out)),
        contentType: 'application/pdf',
      });
    }
    await mailer.sendMail({ to, cc, replyTo: req.user.email, subject, text, attachments });
    db.prepare(`INSERT INTO email_log (offer_id, kind, to_addr, cc_addr, subject, sent_by_name)
                VALUES (?, 'welcome', ?, ?, ?, ?)`).run(req.offer.id, to.join(', '), cc.join(', ') || null, subject, req.user.name);
    autoCheck(req.offer.id, 'welcome_sent', req.user.name);
    res.json({ ok: true });
  } catch (err) {
    if (!err.status) { console.error('welcome send failed:', err.message); err = Object.assign(new Error('Email could not be sent: ' + err.message), { status: 502 }); }
    next(err);
  }
});

// ---- documents (contracts, riders, stage plots) ----

router.post('/offers/:id/documents', loadOffer, upload.array('files', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose a file to upload' });
  const kind = DOC_KINDS[req.body.kind] ? req.body.kind : 'other';
  const role = restrictedRole(req);
  if (role && !ROLE_DOC_KINDS[role].includes(kind)) {
    files.forEach(f => fs.rmSync(f.path, { force: true }));
    return res.status(403).json({ error: `Your account can upload ${ROLE_DOC_KINDS[role].map(k => DOC_KINDS[k]).join(', ')} only` });
  }
  const label = req.body.label ? String(req.body.label).slice(0, 200) : null;
  const ins = db.prepare(`INSERT INTO documents (offer_id, kind, label, original_name, stored_name, mime_type, size, uploaded_by_name)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => files.forEach(f => ins.run(req.offer.id, kind, label, f.originalname, f.filename, f.mimetype, f.size, req.user.name)))();
  if (kind === 'contract') autoCheck(req.offer.id, 'doc_contract', req.user.name);
  if (kind.startsWith('rider') || kind === 'stage_plot') autoCheck(req.offer.id, 'doc_rider', req.user.name);
  if (kind === 'w9') autoCheck(req.offer.id, 'doc_w9', req.user.name);
  if (kind === 'coi') autoCheck(req.offer.id, 'doc_coi', req.user.name);
  if (kind === 'fec') autoCheck(req.offer.id, 'doc_fec', req.user.name);
  res.json({ ok: true, count: files.length });
});

function loadDoc(req, res, next) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.docId));
  if (!doc) return res.status(404).json({ error: 'File not found' });
  const role = restrictedRole(req);
  if (role) {
    const offer = getOffer(doc.offer_id);
    if (!ROLE_DOC_KINDS[role].includes(doc.kind) || !offer || !RESTRICTED_STATUSES.includes(offer.status)) {
      return res.status(404).json({ error: 'File not found' });
    }
  }
  req.doc = doc;
  req.docPath = path.join(UPLOAD_DIR, String(doc.offer_id), path.basename(doc.stored_name));
  next();
}

router.get('/documents/:docId/download', loadDoc, (req, res) => {
  sendStoredFile(req, res, req.docPath, req.doc.mime_type, req.doc.original_name);
});

router.delete('/documents/:docId', loadDoc, (req, res) => {
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.doc.id);
  fs.rmSync(req.docPath, { force: true });
  res.json({ ok: true });
});

// ---- checklist ----

router.post('/offers/:id/checklist', loadOffer, (req, res) => {
  const label = String((req.body && req.body.label) || '').trim();
  if (!label) return res.status(400).json({ error: 'Item text is required' });
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM checklist_items WHERE offer_id = ?').get(req.offer.id).m;
  const info = db.prepare('INSERT INTO checklist_items (offer_id, label, position, due_date) VALUES (?, ?, ?, ?)')
    .run(req.offer.id, label, max + 1, req.body.due_date || null);
  res.json({ id: info.lastInsertRowid });
});

router.patch('/checklist/:itemId', (req, res) => {
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(Number(req.params.itemId));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { done, label, due_date } = req.body || {};
  if (done !== undefined) {
    db.prepare('UPDATE checklist_items SET done = ?, done_by_name = ?, done_at = ? WHERE id = ?')
      .run(done ? 1 : 0, done ? req.user.name : null, done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, item.id);
  }
  if (label !== undefined && String(label).trim()) db.prepare('UPDATE checklist_items SET label = ? WHERE id = ?').run(String(label).trim(), item.id);
  if (due_date !== undefined) db.prepare('UPDATE checklist_items SET due_date = ? WHERE id = ?').run(due_date || null, item.id);
  res.json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(item.id));
});

router.delete('/checklist/:itemId', (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(Number(req.params.itemId));
  res.json({ ok: true });
});

module.exports = router;
