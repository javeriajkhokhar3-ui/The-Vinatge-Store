'use strict';

const fs = require('fs');
const path = require('path');
const { DAYS } = require('./constants');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const DAY_NAMES = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
};

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

function hoursRows(shop) {
  return DAYS.map((d) => {
    const h = shop.hours[d];
    const text = h ? `${fmtTime(h[0])} to ${fmtTime(h[1])}` : 'Closed';
    return `<tr data-day="${d}"><th scope="row">${DAY_NAMES[d]}</th><td>${text}</td></tr>`;
  }).join('\n');
}

function phoneHref(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return digits;
}

function jsonLd(shop, baseUrl) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: shop.name,
    description: shop.tagline,
    telephone: phoneHref(shop.phone),
    address: {
      '@type': 'PostalAddress',
      streetAddress: shop.street,
      addressLocality: shop.city,
      addressRegion: shop.state,
      postalCode: shop.zip,
      addressCountry: 'US'
    },
    geo: { '@type': 'GeoCoordinates', latitude: shop.lat, longitude: shop.lng },
    openingHoursSpecification: DAYS.filter((d) => shop.hours[d]).map((d) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY_NAMES[d],
      opens: shop.hours[d][0],
      closes: shop.hours[d][1]
    }))
  };
  if (shop.payment) data.paymentAccepted = shop.payment;
  if (baseUrl) data.url = baseUrl;
  // "<" is escaped so the JSON can never close the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'index.html');
let cached = { mtime: 0, html: '' };

function template() {
  const stat = fs.statSync(TEMPLATE_PATH);
  if (stat.mtimeMs !== cached.mtime) {
    cached = { mtime: stat.mtimeMs, html: fs.readFileSync(TEMPLATE_PATH, 'utf8') };
  }
  return cached.html;
}

function renderIndex(shop, baseUrl) {
  const tokens = {
    name: esc(shop.name),
    tagline: esc(shop.tagline),
    street: esc(shop.street),
    city: esc(shop.city),
    state: esc(shop.state),
    zip: esc(shop.zip),
    phone: esc(shop.phone),
    phoneHref: esc(phoneHref(shop.phone)),
    lat: esc(shop.lat),
    lng: esc(shop.lng),
    payment: esc(shop.payment || ''),
    parking: esc(shop.parking || ''),
    accessible: shop.accessible ? 'Wheelchair accessible' : '',
    hoursNote: esc(shop.hoursNote || ''),
    hoursRows: hoursRows(shop),
    year: String(new Date().getFullYear())
  };
  let html = template().replace(/\{\{(\w+)\}\}/g, (m, key) => (key in tokens ? tokens[key] : m));
  html = html.replace('<!--JSONLD-->', jsonLd(shop, baseUrl));
  return html;
}

module.exports = { renderIndex, esc };
