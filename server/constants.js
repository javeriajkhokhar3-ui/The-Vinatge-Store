'use strict';

// One list, shared by the API validation and the admin form.
const CATEGORIES = [
  { id: 'decor',    label: 'Home décor' },
  { id: 'jewelry',  label: 'Jewelry' },
  { id: 'books',    label: 'Books' },
  { id: 'crystals', label: 'Crystals and stones' },
  { id: 'furniture',label: 'Furniture' },
  { id: 'holiday',  label: 'Holiday' }
];

// Illustrations available when an item has no photo yet.
const ART = [
  'lamp', 'clock', 'teapot', 'vase', 'candlesticks', 'brooch', 'pocketwatch',
  'beads', 'books', 'amethyst', 'quartz', 'chair', 'table', 'baubles'
];

const STATUSES = ['available', 'sold', 'hidden'];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DEFAULT_SHOP = {
  name: 'The Vintage Store',
  tagline: 'Antiques, jewelry, books and curiosities',
  street: '930 E Duval St',
  city: 'Lake City',
  state: 'FL',
  zip: '32055',
  phone: '386-406-7499',
  lat: 30.1891389,
  lng: -82.6232503,
  timezone: 'America/New_York',
  // [open, close] in 24h time, or null when closed that day.
  hours: {
    mon: ['10:00', '17:00'],
    tue: ['10:00', '17:00'],
    wed: ['10:00', '17:00'],
    thu: ['10:00', '17:00'],
    fri: ['10:00', '17:00'],
    sat: ['10:00', '17:00'],
    sun: ['10:00', '17:00']
  },
  hoursNote: 'Hours can change. If you are making a special trip, call ahead.',
  payment: 'Cash',
  parking: 'Parking lot',
  accessible: true
};

module.exports = { CATEGORIES, ART, STATUSES, DAYS, DEFAULT_SHOP };
