// init.js
// Opens (and creates on first run) the SQLite database: users, offers, the
// 1:1 advance sheet, uploaded documents (contracts / riders) and the
// per-offer checklist. Offer and advance columns come from public/fields.js;
// any column missing from an existing table is added on startup.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');
const { OFFER_FIELDS, ADVANCE_FIELDS, PAYMENT_FIELDS } = require('../public/fields');

const APP_ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(APP_ROOT, process.env.DB_PATH)
  : path.join(__dirname, 'phantizy.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const colType = (f) => (f.type === 'number' || f.type === 'money') ? 'REAL' : 'TEXT';

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff','production','accounting')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','sent','accepted','declined','cancelled','completed')),
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL UNIQUE REFERENCES offers(id) ON DELETE CASCADE,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by_name TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_offer ON documents(offer_id);

-- auto_key ties an item to an event that checks it off automatically:
-- status_sent, status_accepted, doc_contract, doc_fec, doc_rider, doc_w9, doc_coi, welcome_sent,
-- pay_deposit, pay_settlement, pay_balance (status_completed: older rows).
-- Festivals offered in the Festival dropdown (managed in Settings).
CREATE TABLE IF NOT EXISTS festivals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Files attached to every welcome package for a festival.
CREATE TABLE IF NOT EXISTS festival_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  festival_id INTEGER NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by_name TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Emails sent from the site (welcome packages).
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  cc_addr TEXT,
  subject TEXT,
  sent_by_name TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  auto_key TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auto_key TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_by_name TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checklist_offer ON checklist_items(offer_id);
`);

// Databases created before the production/accounting roles have an old CHECK on
// users.role; SQLite can't alter a CHECK, so rebuild the table once.
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
if (!usersSql.includes("'accounting'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff','production','accounting')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, name, email, password_hash, role, active, created_at)
      SELECT id, name, email, password_hash, role, active, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;`);
  })();
  db.pragma('foreign_keys = ON');
}

function addMissingColumns(table, fields) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const f of fields) {
    if (!existing.has(f.key)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.key} ${colType(f)}`);
  }
}
addMissingColumns('offers', OFFER_FIELDS);
addMissingColumns('offers', PAYMENT_FIELDS);
// Festival-wide defaults (JSON of festivalWide offer fields) used to fill new offers.
addMissingColumns('festivals', [{ key: 'details' }]);
// Welcome package letter for the festival (JSON: dos_name, dos_phone, intro,
// sections [{heading, body}], closing, signoff).
addMissingColumns('festivals', [{ key: 'welcome' }]);
addMissingColumns('advances', ADVANCE_FIELDS);

const DEFAULT_CHECKLIST = [
  ['Offer sent to agent', 'status_sent'],
  ['Offer accepted', 'status_accepted'],
  ['Contract received from agency', null],
  ['Signed contract uploaded', 'doc_contract'],
  ['FEC contract received', 'doc_fec'],
  ['Deposit paid', 'pay_deposit'],
  ['W-9 received', 'doc_w9'],
  ['Certificate of insurance received', 'doc_coi'],
  ['Riders received', 'doc_rider'],
  ['Riders reviewed / production approved', null],
  ['Hotel booked', null],
  ['Ground transport booked', null],
  ['Radius clause confirmed with agent', null],
  ['Artist announced on lineup', null],
  ['Tickets on sale', null],
  ['Credentials / guest list submitted', null],
  ['Set times sent to artist', null],
  ['Advance call completed', null],
  ['Advance sheet sent to tour manager', null],
  ['Welcome package sent to tour manager', 'welcome_sent'],
  ['Settlement completed', 'pay_settlement'],
  ['Balance paid', 'pay_balance'],
];
if (db.prepare('SELECT COUNT(*) AS n FROM checklist_template').get().n === 0) {
  const ins = db.prepare('INSERT INTO checklist_template (label, auto_key, position) VALUES (?, ?, ?)');
  db.transaction(() => DEFAULT_CHECKLIST.forEach(([label, key], i) => ins.run(label, key, i)))();
}

if (db.prepare('SELECT COUNT(*) AS n FROM festivals').get().n === 0) {
  db.prepare('INSERT INTO festivals (name) VALUES (?)').run('Rock the Locks Music Festival');
}

// Link checklist items created before W-9 / COI / payment tracking existed to
// their new auto ticks (matched by the default label; renamed items are left alone).
const AUTO_LINKS = [
  ['W-9 received', 'doc_w9'], ['Certificate of insurance received', 'doc_coi'], ['Deposit paid', 'pay_deposit'],
  ['Settlement completed', 'pay_settlement'], ['Balance paid', 'pay_balance'],
];
for (const table of ['checklist_template', 'checklist_items']) {
  const upd = db.prepare(`UPDATE ${table} SET auto_key = ? WHERE label = ? AND (auto_key IS NULL OR auto_key = 'status_completed')`);
  for (const [label, key] of AUTO_LINKS) upd.run(key, label);
}

module.exports = db;
// UPLOAD_DIR is overridable so test runs never write into the live uploads folder.
module.exports.UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(APP_ROOT, process.env.UPLOAD_DIR)
  : path.join(APP_ROOT, 'uploads');
