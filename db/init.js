// init.js
// Opens (and creates on first run) the SQLite database: users, offers, the
// 1:1 advance sheet, uploaded documents (contracts / riders) and the
// per-offer checklist. Offer and advance columns come from public/fields.js;
// any column missing from an existing table is added on startup.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');
const { OFFER_FIELDS, ADVANCE_FIELDS } = require('../public/fields');

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
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff')),
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
-- status_sent, status_accepted, doc_contract, doc_rider, status_completed.
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

function addMissingColumns(table, fields) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const f of fields) {
    if (!existing.has(f.key)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.key} ${colType(f)}`);
  }
}
addMissingColumns('offers', OFFER_FIELDS);
addMissingColumns('advances', ADVANCE_FIELDS);

const DEFAULT_CHECKLIST = [
  ['Offer sent to agent', 'status_sent'],
  ['Offer accepted', 'status_accepted'],
  ['Contract received from agency', null],
  ['Signed contract uploaded', 'doc_contract'],
  ['Deposit paid', null],
  ['W-9 received', null],
  ['Certificate of insurance received', null],
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
  ['Settlement completed', null],
  ['Balance paid', 'status_completed'],
];
if (db.prepare('SELECT COUNT(*) AS n FROM checklist_template').get().n === 0) {
  const ins = db.prepare('INSERT INTO checklist_template (label, auto_key, position) VALUES (?, ?, ?)');
  db.transaction(() => DEFAULT_CHECKLIST.forEach(([label, key], i) => ins.run(label, key, i)))();
}

module.exports = db;
module.exports.UPLOAD_DIR = path.join(APP_ROOT, 'uploads');
