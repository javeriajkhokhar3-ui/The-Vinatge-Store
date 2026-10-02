'use strict';

const { CATEGORIES, ART, STATUSES, DAYS } = require('./constants');

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
// Keeps line breaks for long text, collapses everything else.
const cleanMultiline = (v) =>
  typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';

function validateInquiry(body) {
  const errors = {};
  const name = clean(body.name);
  const contact = clean(body.contact);
  const message = cleanMultiline(body.message);

  if (name.length < 1 || name.length > 80) errors.name = 'Add your name.';

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
  const digits = contact.replace(/\D/g, '');
  const isPhone = /^[\d\s()+.-]+$/.test(contact) && digits.length >= 7 && digits.length <= 15;
  if (contact.length > 120 || !(isEmail || isPhone)) {
    errors.contact = 'Add an email address or phone number so we can reply.';
  }

  if (message.length < 5) errors.message = 'Tell us what you are looking for.';
  else if (message.length > 1500) errors.message = 'Please keep it under 1,500 characters.';

  let itemId = null;
  if (body.itemId !== undefined && body.itemId !== null && body.itemId !== '') {
    const n = Number(body.itemId);
    if (Number.isInteger(n) && n > 0) itemId = n;
  }

  return { errors, value: { name, contact, message, itemId } };
}

function validateItem(body) {
  const errors = {};
  const title = clean(body.title);
  if (!title || title.length > 80) errors.title = 'Title is required (80 characters max).';

  const category = clean(body.category);
  if (!CATEGORIES.some((c) => c.id === category)) errors.category = 'Choose a category.';

  const era = clean(body.era);
  if (era.length > 40) errors.era = 'Keep the era under 40 characters.';

  let price_cents = null;
  const rawPrice = typeof body.price === 'string' ? body.price.trim() : body.price;
  if (rawPrice !== '' && rawPrice !== undefined && rawPrice !== null) {
    const n = Number(rawPrice);
    if (!Number.isFinite(n) || n < 0 || n > 99999) errors.price = 'Price must be between 0 and 99,999.';
    else price_cents = Math.round(n * 100);
  }

  const description = cleanMultiline(body.description);
  if (description.length > 600) errors.description = 'Keep the description under 600 characters.';

  const art = clean(body.art) || 'vase';
  if (!ART.includes(art)) errors.art = 'Choose an illustration.';

  const status = clean(body.status) || 'available';
  if (!STATUSES.includes(status)) errors.status = 'Choose a status.';

  return { errors, value: { title, category, era, price_cents, description, art, status } };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateShop(body, current) {
  const errors = {};
  const out = { ...current };

  const text = (key, max, label, required = true) => {
    const v = clean(body[key]);
    if (required && !v) errors[key] = `${label} is required.`;
    else if (v.length > max) errors[key] = `${label} must be under ${max} characters.`;
    else out[key] = v;
  };
  text('name', 80, 'Name');
  text('tagline', 120, 'Tagline');
  text('street', 80, 'Street');
  text('city', 60, 'City');
  text('state', 30, 'State');
  text('zip', 12, 'ZIP');
  text('phone', 30, 'Phone');
  text('hoursNote', 200, 'Hours note', false);
  text('payment', 60, 'Payment', false);
  text('parking', 60, 'Parking', false);

  out.accessible = body.accessible === true || body.accessible === 'true' || body.accessible === 'on';

  const hours = {};
  const sent = body.hours && typeof body.hours === 'object' ? body.hours : {};
  for (const d of DAYS) {
    const v = sent[d];
    if (v === null || v === undefined || v === '') { hours[d] = null; continue; }
    if (!Array.isArray(v) || v.length !== 2 || !TIME.test(v[0]) || !TIME.test(v[1]) || v[0] >= v[1]) {
      errors.hours = 'Each open day needs an opening time that is before its closing time.';
      break;
    }
    hours[d] = [v[0], v[1]];
  }
  if (!errors.hours) out.hours = hours;

  return { errors, value: out };
}

module.exports = { validateInquiry, validateItem, validateShop };
