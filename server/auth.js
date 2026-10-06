// auth.js
// Local email/password accounts (bcrypt). Session holds {id, name, email,
// role}; requireAuth re-reads the user each request so deactivating someone
// or changing their role takes effect immediately.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/init');

const router = express.Router();

// Simple in-memory lockout: 8 failures per email+IP in 15 min.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
function failKey(req, email) { return `${String(email).toLowerCase()}|${req.ip}`; }
function isLocked(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILS;
}
function recordFail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const key = failKey(req, email);
  if (isLocked(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    recordFail(key);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  failures.delete(key);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.userId = user.id;
    res.json({ ok: true });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAuth(req, res, next) {
  const id = req.session && req.session.userId;
  const user = id && db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(id);
  if (!user || !user.active) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
    return res.redirect('/login.html');
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admins only' });
}

// Restricted roles may only make these requests; everything else under /api
// is refused. Row-level limits (which offers, documents and fields) are
// applied in routes/offers.js.
const COMMON_ALLOWED = [
  ['GET', /^\/api\/me$/],
  ['POST', /^\/api\/me\/password$/],
  ['GET', /^\/api\/offers$/],
  ['GET', /^\/api\/festivals$/],
  ['GET', /^\/api\/offers\/\d+$/],
  ['POST', /^\/api\/offers\/\d+\/documents$/],
  ['GET', /^\/api\/documents\/\d+\/download$/],
];
const ROLE_ALLOWED = {
  production: [
    ...COMMON_ALLOWED,
    ['PUT', /^\/api\/offers\/\d+\/advance$/],
    ['GET', /^\/api\/offers\/\d+\/advance-sheet\.pdf$/],
  ],
  accounting: [
    ...COMMON_ALLOWED,
    ['PUT', /^\/api\/offers\/\d+\/payments$/],
    ['GET', /^\/api\/offers\/\d+\/offer-sheet\.pdf$/],
  ],
};
const ROLE_DENIED_MSG = {
  production: 'Production accounts can only use riders, stage plots and advance sheets',
  accounting: 'Accounting accounts can only view offers, FEC contracts, W-9s, insurance certificates and payments',
};
function roleGate(req, res, next) {
  const allowed = ROLE_ALLOWED[req.user.role];
  if (!allowed || !req.path.startsWith('/api/')) return next();
  if (allowed.some(([m, re]) => m === req.method && re.test(req.path))) return next();
  res.status(403).json({ error: ROLE_DENIED_MSG[req.user.role] });
}

function hashPassword(pw) {
  if (!pw || String(pw).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  return bcrypt.hashSync(String(pw), 12);
}

module.exports = { router, requireAuth, requireAdmin, roleGate, hashPassword };
