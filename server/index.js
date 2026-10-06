const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const SqliteStoreFactory = require('better-sqlite3-session-store');

const db = require('../db/init');
const auth = require('./auth');

const SQLiteStore = SqliteStoreFactory(session);
const app = express();
const PORT = process.env.PORT || 3800;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set in .env');
  process.exit(1);
}

// nginx terminates TLS in front of this app.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'phantizysid',
  store: new SQLiteStore({ client: db, expired: { clear: true, intervalMs: 1000 * 60 * 60 * 24 } }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: {
    secure: 'auto', // HTTPS via nginx in production, plain http on localhost for testing
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  },
}));

// Reachable without a session.
app.get('/health', (req, res) => res.json({ status: 'ok' }));
for (const f of ['login.html', 'style.css', 'logo.png', 'icon-64.png', 'icon-180.png']) {
  app.get('/' + f, (req, res) => res.sendFile(path.join(PUBLIC_DIR, f)));
}
app.use('/api', auth.router);

// Everything below requires a signed-in user.
app.use(auth.requireAuth);
app.use(auth.productionGate);
app.get('/api/me', (req, res) => res.json({ user: req.user }));
app.use('/api', require('../routes/users'));
app.use('/api', require('../routes/offers'));
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Phantizy Productions running on port ${PORT}`);
});
