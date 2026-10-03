'use strict';

const SEED = require('../seed');
const { DEFAULT_SHOP } = require('../constants');

// Rows for first-run sample data, shared by every storage driver.
const seedRows = () => SEED.map((s, i) => ({
  title: s.title, category: s.category, era: s.era,
  price_cents: Math.round(s.price * 100),
  description: s.description, art: s.art, sort: i
}));

module.exports = { seedRows, DEFAULT_SHOP };
