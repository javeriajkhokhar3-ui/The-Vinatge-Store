'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, nothing to compile
const { DEFAULT_SHOP } = require('./constants');
const SEED = require('./seed');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function transaction(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
}

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  era         TEXT    NOT NULL DEFAULT '',
  price_cents INTEGER,
  description TEXT    NOT NULL DEFAULT '',
  art         TEXT    NOT NULL DEFAULT 'vase',
  image       TEXT,
  status      TEXT    NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','hidden')),
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, category, sort);

CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_title TEXT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  message    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---- First run: sample pieces + default shop details -----------------------
const seeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
if (!seeded) {
  const insert = db.prepare(`
    INSERT INTO items (title, category, era, price_cents, description, art, sort)
    VALUES (@title, @category, @era, @price_cents, @description, @art, @sort)
  `);
  transaction(() => {
    SEED.forEach((s, i) => insert.run({
      title: s.title, category: s.category, era: s.era,
      price_cents: Math.round(s.price * 100),
      description: s.description, art: s.art, sort: i
    }));
    db.prepare("INSERT INTO settings (key, value) VALUES ('shop', ?)").run(JSON.stringify(DEFAULT_SHOP));
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded', '1')").run();
  });
}

function getShop() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'shop'").get();
  const saved = row ? JSON.parse(row.value) : {};
  return { ...DEFAULT_SHOP, ...saved, hours: { ...DEFAULT_SHOP.hours, ...(saved.hours || {}) } };
}

function saveShop(shop) {
  db.prepare(`INSERT INTO settings (key, value) VALUES ('shop', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(shop));
}

module.exports = { db, getShop, saveShop, UPLOAD_DIR, DATA_DIR };
