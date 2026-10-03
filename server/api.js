'use strict';

const express = require('express');
const multer = require('multer');

const store = require('./store');
const files = require('./files');
const auth = require('./auth');
const env = require('./env');
const { limiter } = require('./limit');
const { getShop, saveShop } = require('./shop');
const { CATEGORIES, ART, STATUSES } = require('./constants');
const { validateInquiry, validateItem, validateShop } = require('./validate');
const { notifyInquiry } = require('./mail');

const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Make sure the database tables exist before any route runs.
api.use(async (req, res, next) => {
  try { await store.init(); next(); } catch (err) { next(err); }
});

const MAX_PHOTO_MB = 4; // Vercel rejects request bodies over 4.5 MB
const NOT_SAVED = 'Saving is switched off because no database is connected to this site yet.';

const publicItem = (r) => ({
  id: r.id, title: r.title, category: r.category, era: r.era,
  price: r.price_cents == null ? null : r.price_cents / 100,
  description: r.description, art: r.art, image: files.urlFor(r.image), status: r.status
});
const adminItem = (r) => ({ ...publicItem(r), sort: r.sort, updatedAt: r.updated_at });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: 1, fields: 20 } });

const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Bad id.' }); return null; }
  return id;
};

const requirePersistent = (req, res, next) => (store.persistent ? next() : res.status(503).json({ error: NOT_SAVED }));

// ---- public ----------------------------------------------------------------
api.get('/health', async (req, res) => {
  let db = { kind: store.kind, persistent: store.persistent, connected: false };
  try { await store.ping(); db.connected = true; } catch (err) { db.error = String(err.message || err).slice(0, 120); }
  res.json({
    ok: db.connected,
    database: db,
    photos: { enabled: files.enabled, provider: files.useBlob ? 'vercel-blob' : 'disk' },
    admin: { configured: auth.configured, problem: auth.reason || undefined },
    email: { configured: !!(env.get('SMTP_HOST') && env.get('MAIL_TO')) },
    runtime: { node: process.version, vercel: env.onVercel }
  });
});

api.get('/shop', async (req, res) => res.json({ shop: await getShop(), categories: CATEGORIES }));

api.get('/items', async (req, res) => res.json({ items: (await store.listPublicItems()).map(publicItem) }));

const inquiryLimiter = limiter({
  name: 'inquiry', windowMs: 60 * 60 * 1000, limit: 6,
  message: 'Too many messages from this connection. Please call the shop instead.'
});

const visitorNotSaved = async (req, res, next) => {
  if (store.persistent) return next();
  const shop = await getShop();
  res.status(503).json({ error: `Online requests are not available right now. Please call us on ${shop.phone}.` });
};

api.post('/inquiries', visitorNotSaved, inquiryLimiter, express.json({ limit: '16kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.company === 'string' && body.company.trim() !== '') return res.status(201).json({ ok: true });

  const { errors, value } = validateInquiry(body);
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });

  let itemId = null, itemTitle = null;
  if (value.itemId) {
    const it = await store.getVisibleItemBrief(value.itemId);
    if (it) { itemId = it.id; itemTitle = it.title; }
  }
  const id = await store.addInquiry({ itemId, itemTitle, name: value.name, contact: value.contact, message: value.message });

  // Wait for the email attempt: a serverless function may be frozen the moment the response is sent.
  const shop = await getShop();
  await notifyInquiry({ name: value.name, contact: value.contact, message: value.message, item_title: itemTitle }, shop.name);

  res.status(201).json({ ok: true, id });
});

// ---- admin -----------------------------------------------------------------
const loginLimiter = limiter({
  name: 'login', windowMs: 15 * 60 * 1000, limit: 8,
  message: 'Too many attempts. Try again in a few minutes.'
});

const admin = express.Router();
admin.use(auth.sameOrigin);

admin.post('/login', loginLimiter, express.json({ limit: '2kb' }), async (req, res) => {
  if (!auth.configured) {
    return res.status(503).json({ error: `${auth.reason} Add it in your hosting settings, then redeploy.` });
  }
  const pw = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!pw || !auth.checkPassword(pw)) {
    await new Promise((r) => setTimeout(r, 500)); // slows down password guessing
    return res.status(401).json({ error: 'That password is not right.' });
  }
  auth.setSession(req, res);
  res.json({ ok: true });
});

admin.post('/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

admin.use(auth.requireAdmin);

admin.get('/session', async (req, res) => {
  res.json({
    ok: true, unhandled: await store.countUnhandled(),
    categories: CATEGORIES, art: ART, statuses: STATUSES,
    storage: { persistent: store.persistent, kind: store.kind, photos: files.enabled, maxPhotoMb: MAX_PHOTO_MB }
  });
});

admin.get('/items', async (req, res) => res.json({ items: (await store.listAllItems()).map(adminItem) }));

function itemFromRequest(req, res) {
  const { errors, value } = validateItem(req.body || {});
  if (Object.keys(errors).length) {
    res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
    return null;
  }
  return value;
}

const badPhoto = (res) => res.status(422).json({ error: 'Photo must be a JPG, PNG or WebP image.', fields: { image: 'Use a JPG, PNG or WebP photo.' } });
const noPhotoStore = (res) => res.status(503).json({ error: 'Photo storage is not connected yet. Save the item without a photo, or connect Vercel Blob.', fields: { image: 'Photo storage is not connected.' } });

admin.post('/items', requirePersistent, upload.single('image'), async (req, res) => {
  const v = itemFromRequest(req, res); if (!v) return;
  let image = null;
  if (req.file) {
    if (!files.enabled) return noPhotoStore(res);
    image = await files.save(req.file.buffer);
    if (!image) return badPhoto(res);
  }
  try {
    const row = await store.createItem({ ...v, image });
    res.status(201).json({ item: adminItem(row) });
  } catch (err) { await files.remove(image); throw err; }
});

admin.put('/items/:id', requirePersistent, upload.single('image'), async (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const existing = await store.getItem(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  const v = itemFromRequest(req, res); if (!v) return;

  let image = existing.image, saved = null;
  if (req.file) {
    if (!files.enabled) return noPhotoStore(res);
    saved = await files.save(req.file.buffer);
    if (!saved) return badPhoto(res);
    image = saved;
  } else if (req.body && req.body.removeImage === '1') {
    image = null;
  }
  let row;
  try { row = await store.updateItem(id, { ...v, image }); } catch (err) { await files.remove(saved); throw err; }
  if (!row) { await files.remove(saved); return res.status(404).json({ error: 'Item not found.' }); }
  if (image !== existing.image) await files.remove(existing.image);
  res.json({ item: adminItem(row) });
});

admin.delete('/items/:id', requirePersistent, async (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  const existing = await store.getItem(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  await store.deleteItem(id);
  await files.remove(existing.image);
  res.json({ ok: true });
});

admin.get('/inquiries', async (req, res) => {
  const rows = await store.listInquiries();
  res.json({ inquiries: rows.map((r) => ({ ...r, handled: !!r.handled })) });
});

admin.patch('/inquiries/:id', requirePersistent, express.json({ limit: '2kb' }), async (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  if (!(await store.setHandled(id, !!(req.body && req.body.handled)))) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

admin.delete('/inquiries/:id', requirePersistent, async (req, res) => {
  const id = parseId(req, res); if (id === null) return;
  if (!(await store.deleteInquiry(id))) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

admin.get('/shop', async (req, res) => res.json({ shop: await getShop() }));

admin.put('/shop', requirePersistent, express.json({ limit: '8kb' }), async (req, res) => {
  const { errors, value } = validateShop(req.body || {}, await getShop());
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
  await saveShop(value);
  res.json({ shop: await getShop() });
});

api.use('/admin', admin);

// ---- errors ----------------------------------------------------------------
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `That photo is over ${MAX_PHOTO_MB} MB. Try a smaller one.` : 'Upload failed.';
    return res.status(422).json({ error: msg, fields: err.code === 'LIMIT_FILE_SIZE' ? { image: msg } : undefined });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Could not read that request.' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

module.exports = api;
