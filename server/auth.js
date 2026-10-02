'use strict';

const crypto = require('crypto');

const SESSION_HOURS = 12;
const COOKIE = 'vs_admin';

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

let generatedPassword = null;
let PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  generatedPassword = crypto.randomBytes(9).toString('base64url');
  PASSWORD = generatedPassword;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function checkPassword(input) {
  return crypto.timingSafeEqual(sha(input), sha(PASSWORD));
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function issueToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [exp, mac] = token.split('.');
  if (!exp || !mac) return false;
  const expected = sign(exp);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSession(req, res) {
  const secure = req.secure || process.env.NODE_ENV === 'production';
  res.cookie(COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/'
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!verifyToken(token)) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

// Reject cross-site writes. SameSite=Strict already blocks the cookie;
// this is a second lock for browsers that behave differently.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ error: 'Cross-site request blocked.' });
      }
    } catch (_) {
      return res.status(403).json({ error: 'Bad origin.' });
    }
  }
  next();
}

module.exports = { checkPassword, setSession, clearSession, requireAdmin, sameOrigin, generatedPassword };
