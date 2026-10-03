'use strict';

// SQLite driver: a local file when running on your own computer or a server with a disk,
// or an in-memory database as a read-only preview on Vercel when no real database is connected.
const fs = require('fs');
const path = require('path');
const { seedRows, DEFAULT_SHOP } = require('./seedlib');
const env = require('../env');

function create({ memory }) {
  const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+
  let db;

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  async function init() {
    if (db) return;
    if (memory) {
      db = new DatabaseSync(':memory:');
    } else {
      const dir = env.get('DATA_DIR') || path.join(__dirname, '..', '..', 'data');
      fs.mkdirSync(dir, { recursive: true });
      db = new DatabaseSync(path.join(dir, 'store.db'));
      db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
        era TEXT NOT NULL DEFAULT '', price_cents INTEGER, description TEXT NOT NULL DEFAULT '',
        art TEXT NOT NULL DEFAULT 'vase', image TEXT,
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','hidden')),
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, category, sort);
      CREATE TABLE IF NOT EXISTS inquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        item_title TEXT, name TEXT NOT NULL, contact TEXT NOT NULL, message TEXT NOT NULL,
        handled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_hits ON hits (key, ts);
    `);
    if (!db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) {
      tx(() => {
        const ins = db.prepare(`INSERT INTO items (title, category, era, price_cents, description, art, sort)
          VALUES (?, ?, ?, ?, ?, ?, ?)`);
        seedRows().forEach((r) => ins.run(r.title, r.category, r.era, r.price_cents, r.description, r.art, r.sort));
        db.prepare("INSERT INTO settings (key, value) VALUES ('shop', ?)").run(JSON.stringify(DEFAULT_SHOP));
        db.prepare("INSERT INTO settings (key, value) VALUES ('seeded', '1')").run();
      });
    }
  }

  const rows = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const one = (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const ITEM_PARAMS = (v) => [v.title, v.category, v.era, v.price_cents, v.description, v.art, v.image, v.status];

  return {
    kind: memory ? 'memory' : 'sqlite',
    persistent: !memory,
    init,
    async ping() { db.prepare('SELECT 1').get(); },

    async getShopJSON() { const r = one("SELECT value FROM settings WHERE key = 'shop'"); return r ? r.value : null; },
    async saveShopJSON(json) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('shop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(json);
    },

    async listPublicItems() {
      return rows(`SELECT * FROM items WHERE status IN ('available','sold')
                   ORDER BY CASE status WHEN 'available' THEN 0 ELSE 1 END, sort, id`);
    },
    async listAllItems() { return rows('SELECT * FROM items ORDER BY category, sort, id'); },
    async getItem(id) { return one('SELECT * FROM items WHERE id = ?', id); },
    async getVisibleItemBrief(id) { return one("SELECT id, title FROM items WHERE id = ? AND status != 'hidden'", id); },
    async createItem(v) {
      const next = one('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM items WHERE category = ?', v.category).n;
      const info = db.prepare(`INSERT INTO items (title, category, era, price_cents, description, art, image, status, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...ITEM_PARAMS(v), next);
      return one('SELECT * FROM items WHERE id = ?', Number(info.lastInsertRowid));
    },
    async updateItem(id, v) {
      db.prepare(`UPDATE items SET title=?, category=?, era=?, price_cents=?, description=?, art=?, image=?, status=?,
        updated_at=datetime('now') WHERE id=?`).run(...ITEM_PARAMS(v), id);
      return one('SELECT * FROM items WHERE id = ?', id);
    },
    async deleteItem(id) { return db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0; },

    async addInquiry(q) {
      const info = db.prepare('INSERT INTO inquiries (item_id, item_title, name, contact, message) VALUES (?, ?, ?, ?, ?)')
        .run(q.itemId, q.itemTitle, q.name, q.contact, q.message);
      return Number(info.lastInsertRowid);
    },
    async listInquiries() {
      return rows(`SELECT id, item_id AS "itemId", item_title AS "itemTitle", name, contact, message, handled,
        created_at AS "createdAt" FROM inquiries ORDER BY handled ASC, id DESC LIMIT 500`);
    },
    async countUnhandled() { return one('SELECT COUNT(*) AS n FROM inquiries WHERE handled = 0').n; },
    async setHandled(id, handled) { return db.prepare('UPDATE inquiries SET handled = ? WHERE id = ?').run(handled ? 1 : 0, id).changes > 0; },
    async deleteInquiry(id) { return db.prepare('DELETE FROM inquiries WHERE id = ?').run(id).changes > 0; },

    async hit(key, windowMs, limit) {
      const now = Date.now();
      if (Math.random() < 0.02) db.prepare('DELETE FROM hits WHERE ts < ?').run(now - 24 * 3600 * 1000);
      const r = one('SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM hits WHERE key = ? AND ts > ?', key, now - windowMs);
      if (r.n >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((r.oldest + windowMs - now) / 1000)) };
      db.prepare('INSERT INTO hits (key, ts) VALUES (?, ?)').run(key, now);
      return { ok: true };
    }
  };
}

module.exports = { create };
