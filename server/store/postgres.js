'use strict';

// Postgres driver: used on Vercel (Neon via the Vercel Marketplace) or any host with DATABASE_URL.
const { Pool } = require('pg');
const { seedRows, DEFAULT_SHOP } = require('./seedlib');

function create(connectionString) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(connectionString);
  let cs = connectionString;
  if (!local && !/[?&]sslmode=/.test(cs)) cs += (cs.includes('?') ? '&' : '?') + 'sslmode=require';

  const pool = new Pool({ connectionString: cs, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

  const q = (text, params) => pool.query(text, params);
  const TS = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
  const ITEM_COLS = `id, title, category, era, price_cents, description, art, image, status, sort,
    ${TS('created_at')} AS created_at, ${TS('updated_at')} AS updated_at`;
  const ITEM_PARAMS = (v) => [v.title, v.category, v.era, v.price_cents, v.description, v.art, v.image, v.status];

  let ready = null;
  function init() {
    if (!ready) {
      ready = (async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SELECT pg_advisory_xact_lock(727274)'); // one cold start at a time
          await c.query(`
            CREATE TABLE IF NOT EXISTS items (
              id SERIAL PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
              era TEXT NOT NULL DEFAULT '', price_cents INTEGER, description TEXT NOT NULL DEFAULT '',
              art TEXT NOT NULL DEFAULT 'vase', image TEXT,
              status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','hidden')),
              sort INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
            CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, category, sort);
            CREATE TABLE IF NOT EXISTS inquiries (
              id SERIAL PRIMARY KEY, item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
              item_title TEXT, name TEXT NOT NULL, contact TEXT NOT NULL, message TEXT NOT NULL,
              handled BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, ts BIGINT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_hits ON hits (key, ts);
          `);
          const claim = await c.query("INSERT INTO settings (key, value) VALUES ('seeded', '1') ON CONFLICT DO NOTHING RETURNING key");
          if (claim.rowCount) {
            for (const r of seedRows()) {
              await c.query(`INSERT INTO items (title, category, era, price_cents, description, art, sort)
                VALUES ($1,$2,$3,$4,$5,$6,$7)`, [r.title, r.category, r.era, r.price_cents, r.description, r.art, r.sort]);
            }
            await c.query("INSERT INTO settings (key, value) VALUES ('shop', $1) ON CONFLICT DO NOTHING", [JSON.stringify(DEFAULT_SHOP)]);
          }
          await c.query('COMMIT');
        } catch (e) {
          try { await c.query('ROLLBACK'); } catch (_) { /* already failed */ }
          throw e;
        } finally { c.release(); }
      })().catch((e) => { ready = null; throw e; }); // allow a retry on the next request
    }
    return ready;
  }

  return {
    kind: 'postgres',
    persistent: true,
    init,
    async ping() { await q('SELECT 1'); },

    async getShopJSON() { const r = await q("SELECT value FROM settings WHERE key = 'shop'"); return r.rows[0] ? r.rows[0].value : null; },
    async saveShopJSON(json) {
      await q(`INSERT INTO settings (key, value) VALUES ('shop', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [json]);
    },

    async listPublicItems() {
      return (await q(`SELECT ${ITEM_COLS} FROM items WHERE status IN ('available','sold')
        ORDER BY CASE status WHEN 'available' THEN 0 ELSE 1 END, sort, id`)).rows;
    },
    async listAllItems() { return (await q(`SELECT ${ITEM_COLS} FROM items ORDER BY category, sort, id`)).rows; },
    async getItem(id) { return (await q(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [id])).rows[0] || null; },
    async getVisibleItemBrief(id) { return (await q("SELECT id, title FROM items WHERE id = $1 AND status != 'hidden'", [id])).rows[0] || null; },
    async createItem(v) {
      const r = await q(`INSERT INTO items (title, category, era, price_cents, description, art, image, status, sort)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT COALESCE(MAX(sort), -1) + 1 FROM items WHERE category = $2))
        RETURNING ${ITEM_COLS}`, ITEM_PARAMS(v));
      return r.rows[0];
    },
    async updateItem(id, v) {
      const r = await q(`UPDATE items SET title=$1, category=$2, era=$3, price_cents=$4, description=$5, art=$6, image=$7, status=$8,
        updated_at=now() WHERE id=$9 RETURNING ${ITEM_COLS}`, [...ITEM_PARAMS(v), id]);
      return r.rows[0] || null;
    },
    async deleteItem(id) { return (await q('DELETE FROM items WHERE id = $1', [id])).rowCount > 0; },

    async addInquiry(x) {
      const r = await q('INSERT INTO inquiries (item_id, item_title, name, contact, message) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [x.itemId, x.itemTitle, x.name, x.contact, x.message]);
      return r.rows[0].id;
    },
    async listInquiries() {
      return (await q(`SELECT id, item_id AS "itemId", item_title AS "itemTitle", name, contact, message, handled,
        ${TS('created_at')} AS "createdAt" FROM inquiries ORDER BY handled ASC, id DESC LIMIT 500`)).rows;
    },
    async countUnhandled() { return Number((await q('SELECT COUNT(*) AS n FROM inquiries WHERE handled = false')).rows[0].n); },
    async setHandled(id, handled) { return (await q('UPDATE inquiries SET handled = $1 WHERE id = $2', [!!handled, id])).rowCount > 0; },
    async deleteInquiry(id) { return (await q('DELETE FROM inquiries WHERE id = $1', [id])).rowCount > 0; },

    async hit(key, windowMs, limit) {
      const now = Date.now();
      if (Math.random() < 0.02) await q('DELETE FROM hits WHERE ts < $1', [now - 24 * 3600 * 1000]);
      const r = (await q('SELECT COUNT(*)::int AS n, MIN(ts)::bigint AS oldest FROM hits WHERE key = $1 AND ts > $2', [key, now - windowMs])).rows[0];
      if (r.n >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((Number(r.oldest) + windowMs - now) / 1000)) };
      await q('INSERT INTO hits (key, ts) VALUES ($1, $2)', [key, now]);
      return { ok: true };
    }
  };
}

module.exports = { create };
