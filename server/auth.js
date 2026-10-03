'use strict';

const crypto = require('crypto');
const env = require('./env');

const SESSION_HOURS = 12;
const COOKIE = 'vs_admin';
const MIN_LENGTH = 8;

let PASSWORD = env.get('ADMIN_PASSWORD');
let generatedPassword = null;
// On your own computer a random password is printed at startup. Hosted sites must set one.
if (!PASSWORD && !env.isProd) {
  generatedPassword = crypto.randomBytes(9).toString('base64url');
  PASSWORD = generatedPassword;
}

const configured = PASSWORD.length >= MIN_LENGTH;
const reason = !PASSWORD ? 'ADMIN_PASSWORD is not set.'
  : PASSWORD.length < MIN_LENGTH ? `ADMIN_PASSWORD must be at least ${MIN_LENGTH} characters.` : '';

// SESSION_SECRET is optional: if it is missing or empty, the key is derived from the password,
// so every serverless instance agrees on it and sign-in survives restarts.
const SECRET = env.get('SESSION_SECRET')
  || (PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('vintage-store-session-v1').digest('hex') : crypto.randomBytes(32).toString('hex'));
const secretForHashing = crypto.createHmac('sha256', SECRET).update('rate-limit-ip').digest('hex');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const checkPassword = (input) => configured && crypto.timingSafeEqual(sha(String(input).trim()), sha(PASSWORD));
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function issueToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [exp, mac] = token.split('.');
  if (!exp || !mac) return false;
  const a = Buffer.from(mac), b = Buffer.from(sign(exp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* skip bad cookie */ }
  });
  return out;
}

function setSession(req, res) {
  res.cookie(COOKIE, issueToken(), {
    httpOnly: true, sameSite: 'strict', secure: req.secure || env.isProd,
    maxAge: SESSION_HOURS * 3600 * 1000, path: '/'
  });
}
const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

function requireAdmin(req, res, next) {
  if (!verifyToken(parseCookies(req.headers.cookie)[COOKIE])) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

// Reject cross-site writes. SameSite=Strict already blocks the cookie; this is a second lock.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
    } catch (_) { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
}

module.exports = { configured, reason, checkPassword, setSession, clearSession, requireAdmin, sameOrigin, generatedPassword, secretForHashing };
