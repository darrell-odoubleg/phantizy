// users.js — own password change, admin user management, and the default
// checklist template that seeds every new offer.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/init');
const { requireAdmin, requireStaff, hashPassword } = require('../server/auth');
const fs = require('fs');
const path = require('path');
const { OFFER_SECTIONS, ROLES, WELCOME_FILE_KINDS } = require('../public/fields');
const { makeUpload, sendStoredFile, UPLOAD_DIR } = require('../server/upload');
const { runOfShowPdf } = require('../server/pdf');
const { runOfShowRows } = require('../server/ros');
const festivalUpload = makeUpload(req => path.join('festivals', String(Number(req.params.id))));
const cleanRole = (r) => (ROLES[r] ? r : 'staff');

// Offer fields a festival can supply defaults for (its festivalWide sections).
const FESTIVAL_DETAIL_FIELDS = OFFER_SECTIONS.filter(s => s.festivalWide).flatMap(s => s.fields)
  .filter(f => f.key !== 'festival_name' && !f.internal);
const parseDetails = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

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
  const rows = db.prepare(`SELECT f.id, f.name, f.active, f.details, f.stages, f.days,
      (SELECT COUNT(*) FROM offers o WHERE o.festival_name = f.name) AS offers
    FROM festivals f ${all ? '' : 'WHERE f.active = 1'} ORDER BY f.name`).all();
  res.json(rows.map(r => ({ ...r, details: parseDetails(r.details), stages: parseList(r.stages), days: parseList(r.days) })));
});

router.get('/festival-options/:id', (req, res) => {
  const f = db.prepare('SELECT id, name, active, details, welcome, stages, days FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Festival not found' });
  res.json({ ...f, details: parseDetails(f.details), welcome: parseDetails(f.welcome), stages: parseList(f.stages), days: parseList(f.days) });
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

const festivalFilePath = (f) => path.join(UPLOAD_DIR, 'festivals', String(f.festival_id), path.basename(f.stored_name));

// ---- stages & festival days (drive the Stage dropdown and the run-of-show grid) ----

router.put('/festival-options/:id/schedule', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Festival not found' });
  const b = req.body || {};
  const stages = (Array.isArray(b.stages) ? b.stages : []).map(s => String(s).trim()).filter(Boolean).slice(0, 12);
  const days = (Array.isArray(b.days) ? b.days : []).map(s => String(s).trim()).filter(Boolean).slice(0, 14);
  if (new Set(stages.map(s => s.toLowerCase())).size !== stages.length) return res.status(400).json({ error: 'Two stages have the same name' });
  if (days.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return res.status(400).json({ error: 'Each festival day needs a date' });
  if (new Set(days).size !== days.length) return res.status(400).json({ error: 'The same day is listed twice' });
  const oldStages = parseList(f.stages), oldDays = parseList(f.days);
  db.transaction(() => {
    // A stage renamed in place carries its run-of-show files and offers along.
    oldStages.forEach((old, i) => {
      const now = stages[i];
      if (now && now !== old && !oldStages.includes(now)) {
        db.prepare("UPDATE festival_files SET stage = ? WHERE festival_id = ? AND kind = 'run_of_show' AND stage = ?").run(now, f.id, old);
        db.prepare('UPDATE festival_ros SET stage = ? WHERE festival_id = ? AND stage = ?').run(now, f.id, old);
        db.prepare('UPDATE offers SET stage = ? WHERE festival_name = ? AND stage = ?').run(now, f.name, old);
      }
    });
    // A day changed in place carries its run-of-show files along.
    oldDays.forEach((old, i) => {
      const now = days[i];
      if (now && now !== old && !oldDays.includes(now)) {
        db.prepare("UPDATE festival_files SET day = ? WHERE festival_id = ? AND kind = 'run_of_show' AND day = ?").run(now, f.id, old);
        db.prepare('UPDATE festival_ros SET day = ? WHERE festival_id = ? AND day = ?').run(now, f.id, old);
      }
    });
    // Removing a stage or day that still has a run of show would orphan it.
    const orphan = db.prepare(`SELECT stage, day FROM festival_files WHERE festival_id = ? AND kind = 'run_of_show'
      UNION SELECT stage, day FROM festival_ros WHERE festival_id = ? AND rows != '[]'`).all(f.id, f.id)
      .find(r => !stages.includes(r.stage) || !days.includes(r.day));
    if (orphan) throw Object.assign(new Error(`Delete the run of show for ${orphan.stage} on ${orphan.day} before removing that stage or day`), { status: 409 });
    db.prepare('UPDATE festivals SET stages = ?, days = ? WHERE id = ?').run(JSON.stringify(stages), JSON.stringify(days), f.id);
  })();
  res.json({ ok: true });
});

router.get('/festival-options/:id/run-of-show', requireStaff, (req, res) => {
  const fid = Number(req.params.id);
  res.json({
    files: db.prepare(`SELECT id, stage, day, original_name, mime_type, size, uploaded_by_name, uploaded_at
      FROM festival_files WHERE festival_id = ? AND kind = 'run_of_show'`).all(fid),
    // Every stage × day slot, with artist rows filled from accepted offers.
    tables: (() => {
      const fest = db.prepare('SELECT * FROM festivals WHERE id = ?').get(fid);
      if (!fest) return [];
      const meta = db.prepare('SELECT stage, day, updated_by_name, updated_at FROM festival_ros WHERE festival_id = ?').all(fid);
      return parseList(fest.stages).flatMap(stage => parseList(fest.days).map(day => {
        const { rows, pending, overlaps } = runOfShowRows(fest.name, stage, day);
        const m = meta.find(x => x.stage === stage && x.day === day) || {};
        return { stage, day, rows, pending, overlaps, updated_by_name: m.updated_by_name, updated_at: m.updated_at };
      }));
    })(),
  });
});

// Run of show table for one stage + day (built in the site).
function rosSlot(req, res) {
  const fest = db.prepare('SELECT * FROM festivals WHERE id = ?').get(Number(req.params.id));
  if (!fest) { res.status(404).json({ error: 'Festival not found' }); return null; }
  const stage = String((req.body && req.body.stage) || req.query.stage || '');
  const day = String((req.body && req.body.day) || req.query.day || '');
  if (!parseList(fest.stages).includes(stage) || !parseList(fest.days).includes(day)) { res.status(400).json({ error: 'Unknown stage or day' }); return null; }
  return { fest, stage, day };
}

router.put('/festival-options/:id/run-of-show-table', requireStaff, (req, res) => {
  const slot = rosSlot(req, res); if (!slot) return;
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const time = (v) => (/^\d{1,2}:\d{2}$/.test(v || '') ? v : '');
  // Artist rows (offer_id) only keep their Stage Setup; their name and times
  // always come from the offer / advance sheet (server/ros.js).
  // Changeover rows (co = following act's offer_id) likewise keep only Stage Setup.
  const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).slice(0, 200)
    .map(r => (r.offer_id ? { offer_id: Number(r.offer_id), setup: str(r.setup, 300) }
      : r.co ? { co: Number(r.co), setup: str(r.setup, 300) }
      : { item: str(r.item, 300), setup: str(r.setup, 300), time: time(r.time), end: time(r.end), duration: str(r.duration, 60) }))
    .filter(r => r.offer_id || (r.co && r.setup) || r.item || r.setup || r.time || r.duration);
  db.prepare(`INSERT INTO festival_ros (festival_id, stage, day, rows, updated_by_name, updated_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT (festival_id, stage, day) DO UPDATE SET rows = excluded.rows, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`)
    .run(slot.fest.id, slot.stage, slot.day, JSON.stringify(rows), req.user.name);
  res.json({ ok: true, count: runOfShowRows(slot.fest.name, slot.stage, slot.day).rows.length });
});

router.get('/festival-options/:id/run-of-show.pdf', requireStaff, (req, res) => {
  const slot = rosSlot(req, res); if (!slot) return;
  const { rows } = runOfShowRows(slot.fest.name, slot.stage, slot.day);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Run of show - ${slot.stage} - ${slot.day}.pdf"`.replace(/[^\w.\- =";]+/g, ''));
  runOfShowPdf({ festival: slot.fest.name, stage: slot.stage, day: slot.day, rows }, res);
});

// One file per stage + day; uploading again replaces it.
router.post('/festival-options/:id/run-of-show', requireStaff, (req, res, next) => {
  if (!db.prepare('SELECT 1 FROM festivals WHERE id = ?').get(Number(req.params.id))) return res.status(404).json({ error: 'Festival not found' });
  next();
}, festivalUpload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Choose a file to upload' });
  const drop = (msg, status = 400) => { fs.rmSync(file.path, { force: true }); res.status(status).json({ error: msg }); };
  if (!/\.(pdf|png|jpe?g)$/i.test(file.originalname)) return drop('Run of show must be a PDF, PNG or JPEG so it can be combined into the welcome package');
  const fest = db.prepare('SELECT * FROM festivals WHERE id = ?').get(Number(req.params.id));
  const stage = String(req.body.stage || ''), day = String(req.body.day || '');
  if (!parseList(fest.stages).includes(stage) || !parseList(fest.days).includes(day)) return drop('Unknown stage or day');
  const old = db.prepare("SELECT * FROM festival_files WHERE festival_id = ? AND kind = 'run_of_show' AND stage = ? AND day = ?").all(fest.id, stage, day);
  db.transaction(() => {
    old.forEach(o => db.prepare('DELETE FROM festival_files WHERE id = ?').run(o.id));
    db.prepare(`INSERT INTO festival_files (festival_id, kind, stage, day, original_name, stored_name, mime_type, size, uploaded_by_name)
                VALUES (?, 'run_of_show', ?, ?, ?, ?, ?, ?, ?)`).run(fest.id, stage, day, file.originalname, file.filename, file.mimetype, file.size, req.user.name);
  })();
  old.forEach(o => fs.rmSync(festivalFilePath(o), { force: true }));
  res.json({ ok: true, replaced: old.length > 0 });
});

// ---- festival welcome-package files (same for every act) ----


router.get('/festival-options/:id/files', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, kind, original_name, mime_type, size, uploaded_by_name, uploaded_at
    FROM festival_files WHERE festival_id = ? AND kind != 'run_of_show' ORDER BY uploaded_at`).all(Number(req.params.id)));
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

// Admins delete any festival file; staff only run-of-show uploads.
router.delete('/festival-files/:fid', requireStaff, (req, res) => {
  const f = db.prepare('SELECT * FROM festival_files WHERE id = ?').get(Number(req.params.fid));
  if (!f) return res.status(404).json({ error: 'File not found' });
  if (req.user.role !== 'admin' && f.kind !== 'run_of_show') return res.status(403).json({ error: 'Admins only' });
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
