'use strict';

// Environment helpers. A variable that exists but is empty or only spaces counts as "not set",
// which is the most common mistake when typing values into a hosting dashboard.
const get = (name) => {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
};

const onVercel = !!process.env.VERCEL;
const isProd = get('NODE_ENV') === 'production' || onVercel;

module.exports = { get, onVercel, isProd };
