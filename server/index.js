'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');

const api = require('./api');
const { renderIndex } = require('./render');
const { getShop } = require('./db');
const { UPLOAD_DIR } = require('./db');
const { generatedPassword } = require('./auth');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
// Set TRUST_PROXY=1 when running behind a host's load balancer (Render, Railway, Fly, nginx)
// so rate limits see the visitor's IP and not the proxy's.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      'frame-src https://www.google.com',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (isProd) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(compression());
app.use('/api', api);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true, index: false, dotfiles: 'deny' }));
app.use('/fonts', express.static(path.join(PUBLIC, 'fonts'), { maxAge: '365d', immutable: true }));
// The home page is a template so address, phone, hours and structured data always match the database.
app.get(['/', '/index.html'], (req, res, next) => {
  try {
    const base = process.env.PUBLIC_URL || '';
    res.type('html').set('Cache-Control', 'no-cache').send(renderIndex(getShop(), base));
  } catch (err) { next(err); }
});

app.use(express.static(PUBLIC, { maxAge: isProd ? '1h' : 0, index: false }));

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC, '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).type('text').send('Something went wrong. Please try again in a moment.');
});

app.listen(PORT, () => {
  console.log(`The Vintage Store is open at http://localhost:${PORT}`);
  console.log(`Admin:   http://localhost:${PORT}/admin`);
  if (generatedPassword) {
    console.log(`Admin password for this run: ${generatedPassword}`);
    console.log('Set ADMIN_PASSWORD (and SESSION_SECRET) in your environment to keep it fixed.');
  }
});
