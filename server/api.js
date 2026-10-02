'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const { db, getShop, saveShop, UPLOAD_DIR } = require('./db');
const { CATEGORIES, ART, STATUSES } = require('./constants');
const { validateInquiry, validateItem, validateShop } = require('./validate');
const { notifyInquiry } = require('./mail');
const auth = require('./auth');

const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- helpers ---------------------------------------------------------------
const publicItem = (r) => ({
  id: r.id,
  title: r.title,
  category: r.category,
  era: r.era,
  price: r.price_cents == null ? null : r.price_cents / 100,
  description: r.description,
  art: r.art,
  image: r.image ? `/uploads/${r.image}` : null,
  status: r.status
});

const adminItem = (r) => ({ ...publicItem(r), sort: r.sort, updatedAt: r.updated_at });

const SAFE_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
function removeFile(name) {
  if (name && SAFE_FILE.test(name)) fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

// Identify the real file type from its first bytes rather than trusting the browser.
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function saveUpload(file) {
  const ext = sniff(file.buffer);
  if (!ext) return null;
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return name;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 20 }
});

const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Bad id.' }); return null; }
  return id;
};

// ---- public ----------------------------------------------------------------
api.get('/shop', (req, res) => {
  const shop = getShop();
  res.json({ shop, categories: CATEGORIES });
});

api.get('/items', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM items
    WHERE status IN ('available', 'sold')
    ORDER BY CASE status WHEN 'available' THEN 0 ELSE 1 END, sort, id
  `).all();
  res.json({ items: rows.map(publicItem) });
});

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages from this connection. Please call the shop instead.' }
});

api.post('/inquiries', inquiryLimiter, express.json({ limit: '16kb' }), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return res.status(201).json({ ok: true });
  }

  const { errors, value } = validateInquiry(body);
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });

  let itemTitle = null;
  let itemId = null;
  if (value.itemId) {
    const it = db.prepare("SELECT id, title FROM items WHERE id = ? AND status != 'hidden'").get(value.itemId);
    if (it) { itemId = it.id; itemTitle = it.title; }
  }

  const info = db.prepare(`
    INSERT INTO inquiries (item_id, item_title, name, contact, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(itemId, itemTitle, value.name, value.contact, value.message);

  notifyInquiry(
    { name: value.name, contact: value.contact, message: value.message, item_title: itemTitle },
    getShop().name
  );

  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

// ---- admin -----------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' }
});

const admin = express.Router();
admin.use(auth.sameOrigin);

admin.post('/login', loginLimiter, express.json({ limit: '2kb' }), (req, res) => {
  const pw = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!pw || !auth.checkPassword(pw)) return res.status(401).json({ error: 'That password is not right.' });
  auth.setSession(req, res);
  res.json({ ok: true });
});

admin.post('/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

admin.use(auth.requireAdmin);

admin.get('/session', (req, res) => {
  const unhandled = db.prepare('SELECT COUNT(*) AS n FROM inquiries WHERE handled = 0').get().n;
  res.json({ ok: true, unhandled, categories: CATEGORIES, art: ART, statuses: STATUSES });
});

admin.get('/items', (req, res) => {
  const rows = db.prepare('SELECT * FROM items ORDER BY category, sort, id').all();
  res.json({ items: rows.map(adminItem) });
});

function itemFromRequest(req, res) {
  const { errors, value } = validateItem(req.body || {});
  if (Object.keys(errors).length) {
    res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
    return null;
  }
  return value;
}

admin.post('/items', upload.single('image'), (req, res) => {
  const v = itemFromRequest(req, res);
  if (!v) return;
  let image = null;
  if (req.file) {
    image = saveUpload(req.file);
    if (!image) return res.status(422).json({ error: 'Photo must be a JPG, PNG or WebP image.', fields: { image: 'Use a JPG, PNG or WebP photo.' } });
  }
  const nextSort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM items WHERE category = ?').get(v.category).n;
  const info = db.prepare(`
    INSERT INTO items (title, category, era, price_cents, description, art, image, status, sort)
    VALUES (@title, @category, @era, @price_cents, @description, @art, @image, @status, @sort)
  `).run({ ...v, image, sort: nextSort });
  res.status(201).json({ item: adminItem(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid)) });
});

admin.put('/items/:id', upload.single('image'), (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  const v = itemFromRequest(req, res);
  if (!v) return;

  let image = existing.image;
  if (req.file) {
    const saved = saveUpload(req.file);
    if (!saved) return res.status(422).json({ error: 'Photo must be a JPG, PNG or WebP image.', fields: { image: 'Use a JPG, PNG or WebP photo.' } });
    removeFile(existing.image);
    image = saved;
  } else if (req.body && req.body.removeImage === '1') {
    removeFile(existing.image);
    image = null;
  }

  db.prepare(`
    UPDATE items SET title=@title, category=@category, era=@era, price_cents=@price_cents,
      description=@description, art=@art, image=@image, status=@status, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...v, image, id });
  res.json({ item: adminItem(db.prepare('SELECT * FROM items WHERE id = ?').get(id)) });
});

admin.delete('/items/:id', (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const existing = db.prepare('SELECT image FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  removeFile(existing.image);
  res.json({ ok: true });
});

admin.get('/inquiries', (req, res) => {
  const rows = db.prepare(`
    SELECT id, item_id AS itemId, item_title AS itemTitle, name, contact, message,
           handled, created_at AS createdAt
    FROM inquiries ORDER BY handled ASC, id DESC LIMIT 500
  `).all();
  res.json({ inquiries: rows.map((r) => ({ ...r, handled: !!r.handled })) });
});

admin.patch('/inquiries/:id', express.json({ limit: '2kb' }), (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const handled = req.body && req.body.handled ? 1 : 0;
  const info = db.prepare('UPDATE inquiries SET handled = ? WHERE id = ?').run(handled, id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

admin.delete('/inquiries/:id', (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const info = db.prepare('DELETE FROM inquiries WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

admin.get('/shop', (req, res) => res.json({ shop: getShop() }));

admin.put('/shop', express.json({ limit: '8kb' }), (req, res) => {
  const current = getShop();
  const { errors, value } = validateShop(req.body || {}, current);
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
  saveShop(value);
  res.json({ shop: getShop() });
});

api.use('/admin', admin);

// ---- errors ----------------------------------------------------------------
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is over 6 MB. Try a smaller one.' : 'Upload failed.';
    return res.status(422).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Could not read that request.' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

module.exports = api;
