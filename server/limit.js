'use strict';

// Rate limiter that keeps its counts in the database, so it still works when
// serverless functions spin up many separate instances.
const crypto = require('crypto');
const store = require('./store');
const auth = require('./auth');

function limiter({ name, windowMs, limit, message }) {
  return async (req, res, next) => {
    try {
      const who = crypto.createHmac('sha256', auth.secretForHashing).update(String(req.ip || 'unknown')).digest('hex').slice(0, 24);
      const r = await store.hit(`${name}:${who}`, windowMs, limit);
      if (!r.ok) {
        res.set('Retry-After', String(r.retryAfter));
        return res.status(429).json({ error: message });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { limiter };
