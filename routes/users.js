// users.js — own password change, admin user management, and the default
// checklist template that seeds every new offer.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/init');
const { requireAdmin, hashPassword } = require('../server/auth');
const fs = require('fs');
const path = require('path');
const { OFFER_SECTIONS, ROLES, WELCOME_FILE_KINDS } = require('../public/fields');
const { makeUpload, sendStoredFile, UPLOAD_DIR } = require('../server/upload');
const festivalUpload = makeUpload(req => path.join('festivals', String(Number(req.params.id))));
const cleanRole = (r) => (ROLES[r] ? r : 'staff');

// Offer fields a festival can supply defaults for (its festivalWide sections).
const FESTIVAL_DETAIL_FIELDS = OFFER_SECTIONS.filter(s => s.festivalWide).flatMap(s => s.fields)
  .filter(f => f.key !== 'festival_name' && !f.internal);
const parseDetails = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

const router = express.Router();

router.post('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

router.get('/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY name').all());
});

router.post('/users', requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  try {
    const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(name).trim(), String(email).trim(), hashPassword(password), cleanRole(role));
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That email already has an account' });
    throw err;
  }
});

router.patch('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, role, active, password } = req.body || {};
  if (id === req.user.id && ((role !== undefined && role !== 'admin') || active === false)) {
    return res.status(400).json({ error: "You can't demote or deactivate yourself" });
  }
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(cleanRole(role), id);
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    // Sign out a deactivated user's open sessions.
    if (!active) db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(id);
  }
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  res.json({ ok: true });
});

// ---- festivals (Festival dropdown) ----

router.get('/festival-options', (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin';
  const rows = db.prepare(`SELECT f.id, f.name, f.active, f.details,
      (SELECT COUNT(*) FROM offers o WHERE o.festival_name = f.name) AS offers
    FROM festivals f ${all ? '' : 'WHERE f.active = 1'} ORDER BY f.name`).all();
  res.json(rows.map(r => ({ ...r, details: parseDetails(r.details) })));
});

router.get('/festival-options/:id', (req, res) => {
  const f = db.prepare('SELECT id, name, active, details, welcome FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Festival not found' });
  res.json({ ...f, details: parseDetails(f.details), welcome: parseDetails(f.welcome) });
});

// Welcome package letter text for this festival.
router.put('/festival-options/:id/welcome', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT id FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Festival not found' });
  const b = req.body || {};
  const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
  const welcome = {
    subject: str(b.subject, 250).replace(/[\r\n]+/g, ' '),
    dos_name: str(b.dos_name, 200), dos_phone: str(b.dos_phone, 100),
    intro: str(b.intro), closing: str(b.closing), signoff: str(b.signoff, 300),
    sections: (Array.isArray(b.sections) ? b.sections : []).slice(0, 60)
      .map(s => ({ heading: str(s.heading, 200), body: str(s.body, 10000) }))
      .filter(s => s.heading || s.body),
  };
  db.prepare('UPDATE festivals SET welcome = ? WHERE id = ?').run(JSON.stringify(welcome), f.id);
  res.json({ ok: true });
});

router.put('/festival-options/:id/details', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT id FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Festival not found' });
  const details = {};
  for (const fld of FESTIVAL_DETAIL_FIELDS) {
    const v = req.body && req.body[fld.key];
    if (v !== undefined && v !== null && String(v).trim() !== '') details[fld.key] = String(v).trim();
  }
  db.prepare('UPDATE festivals SET details = ? WHERE id = ?').run(JSON.stringify(details), f.id);
  res.json({ ok: true });
});

router.post('/festival-options', requireAdmin, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Festival name is required' });
  try {
    res.json({ id: db.prepare('INSERT INTO festivals (name) VALUES (?)').run(name).lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That festival is already on the list' });
    throw err;
  }
});

// Rename (carried over to existing offers) or hide/show in the dropdown.
router.patch('/festival-options/:id', requireAdmin, (req, res) => {
  const fest = db.prepare('SELECT * FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!fest) return res.status(404).json({ error: 'Festival not found' });
  const { name, active } = req.body || {};
  try {
    db.transaction(() => {
      if (name !== undefined) {
        const n = String(name).trim();
        if (!n) throw Object.assign(new Error('Festival name is required'), { status: 400 });
        db.prepare('UPDATE festivals SET name = ? WHERE id = ?').run(n, fest.id);
        db.prepare('UPDATE offers SET festival_name = ? WHERE festival_name = ?').run(n, fest.name);
      }
      if (active !== undefined) db.prepare('UPDATE festivals SET active = ? WHERE id = ?').run(active ? 1 : 0, fest.id);
    })();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Another festival already has that name' });
    throw err;
  }
  res.json({ ok: true });
});

// ---- festival welcome-package files (same for every act) ----

const festivalFilePath = (f) => path.join(UPLOAD_DIR, 'festivals', String(f.festival_id), path.basename(f.stored_name));

router.get('/festival-options/:id/files', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, kind, original_name, mime_type, size, uploaded_by_name, uploaded_at
    FROM festival_files WHERE festival_id = ? ORDER BY uploaded_at`).all(Number(req.params.id)));
});

router.post('/festival-options/:id/files', requireAdmin, (req, res, next) => {
  if (!db.prepare('SELECT 1 FROM festivals WHERE id = ?').get(Number(req.params.id))) return res.status(404).json({ error: 'Festival not found' });
  next();
}, festivalUpload.array('files', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose a file to upload' });
  // Welcome attachments are merged into one PDF, so only PDF / PNG / JPEG.
  const bad = files.filter(f => !/\.(pdf|png|jpe?g)$/i.test(f.originalname));
  if (bad.length) {
    files.forEach(f => fs.rmSync(f.path, { force: true }));
    return res.status(400).json({ error: `Welcome attachments must be PDF, PNG or JPEG so they can be combined into one PDF (${bad.map(f => f.originalname).join(', ')}). Save it as a PDF and upload again.` });
  }
  const kind = WELCOME_FILE_KINDS[req.body.kind] ? req.body.kind : 'other';
  const ins = db.prepare(`INSERT INTO festival_files (festival_id, kind, original_name, stored_name, mime_type, size, uploaded_by_name)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => files.forEach(f => ins.run(Number(req.params.id), kind, f.originalname, f.filename, f.mimetype, f.size, req.user.name)))();
  res.json({ ok: true, count: files.length });
});

// Admin, staff and production (who send welcome packages) can open these.
router.get('/festival-files/:fid/download', (req, res) => {
  if (req.user.role === 'accounting') return res.status(404).json({ error: 'File not found' });
  const f = db.prepare('SELECT * FROM festival_files WHERE id = ?').get(Number(req.params.fid));
  if (!f) return res.status(404).json({ error: 'File not found' });
  sendStoredFile(req, res, festivalFilePath(f), f.mime_type, f.original_name);
});

router.delete('/festival-files/:fid', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM festival_files WHERE id = ?').get(Number(req.params.fid));
  if (!f) return res.status(404).json({ error: 'File not found' });
  db.prepare('DELETE FROM festival_files WHERE id = ?').run(f.id);
  fs.rmSync(festivalFilePath(f), { force: true });
  res.json({ ok: true });
});

router.get('/checklist-template', (req, res) => {
  res.json(db.prepare('SELECT id, label, auto_key FROM checklist_template ORDER BY position, id').all());
});

// Replaces the whole template with the posted list (order = position).
router.put('/checklist-template', requireAdmin, (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'items[] required' });
  const clean = items.map(i => ({ label: String(i.label || '').trim(), auto_key: i.auto_key || null })).filter(i => i.label);
  db.transaction(() => {
    db.prepare('DELETE FROM checklist_template').run();
    const ins = db.prepare('INSERT INTO checklist_template (label, auto_key, position) VALUES (?, ?, ?)');
    clean.forEach((i, n) => ins.run(i.label, i.auto_key, n));
  })();
  res.json({ ok: true });
});

module.exports = router;
