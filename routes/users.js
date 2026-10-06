// users.js — own password change, admin user management, and the default
// checklist template that seeds every new offer.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/init');
const { requireAdmin, hashPassword } = require('../server/auth');

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
      .run(String(name).trim(), String(email).trim(), hashPassword(password), role === 'admin' ? 'admin' : 'staff');
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
  if (id === req.user.id && (role === 'staff' || active === false)) {
    return res.status(400).json({ error: "You can't demote or deactivate yourself" });
  }
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'staff', id);
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
  res.json(db.prepare(`SELECT f.id, f.name, f.active,
      (SELECT COUNT(*) FROM offers o WHERE o.festival_name = f.name) AS offers
    FROM festivals f ${all ? '' : 'WHERE f.active = 1'} ORDER BY f.name`).all());
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
