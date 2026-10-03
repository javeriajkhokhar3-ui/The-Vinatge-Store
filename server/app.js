'use strict';

// The whole website as an Express app. It is started by server/index.js on your own computer
// or a normal server, and by api/index.js as a serverless function on Vercel.
const path = require('path');
const express = require('express');

const env = require('./env');
const api = require('./api');
const files = require('./files');
const store = require('./store');
const { renderIndex } = require('./render');
const { getShop } = require('./shop');

const PUBLIC = path.join(__dirname, '..', 'public');
const app = express();
app.disable('x-powered-by');
// Behind Vercel (or any proxy) the visitor's address comes from X-Forwarded-For.
if (env.onVercel || env.get('TRUST_PROXY')) app.set('trust proxy', Number(env.get('TRUST_PROXY')) || 1);

// Same policy as the headers in vercel.json, which cover static files on Vercel.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
  'frame-src https://www.google.com', "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (env.isProd) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

if (!env.onVercel) app.use(require('compression')());

app.use('/api', api);
app.get('/uploads/:name', (req, res, next) => files.send(req.params.name, res).catch(next));
app.use('/fonts', express.static(path.join(PUBLIC, 'fonts'), { maxAge: '365d', immutable: true }));

// The home page is a template so address, phone, hours and structured data always match the database.
app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    await store.init();
    const base = env.get('PUBLIC_URL');
    res.type('html').set('Cache-Control', 'no-cache').send(renderIndex(await getShop(), base));
  } catch (err) { next(err); }
});

app.use(express.static(PUBLIC, { maxAge: env.isProd ? '1h' : 0, index: false }));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC, '404.html'), (err) => {
    if (err && !res.headersSent) res.type('text').send('Page not found');
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).type('text').send('Something went wrong. Please try again in a moment.');
});

module.exports = app;
