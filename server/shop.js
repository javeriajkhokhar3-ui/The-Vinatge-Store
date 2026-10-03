'use strict';

const store = require('./store');
const { DEFAULT_SHOP } = require('./constants');

let cache = { at: 0, value: null };
const TTL = 10 * 1000; // owner edits appear on every instance within 10 seconds

async function getShop() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value;
  const json = await store.getShopJSON();
  let saved = {};
  try { saved = json ? JSON.parse(json) : {}; } catch (_) { saved = {}; }
  const value = { ...DEFAULT_SHOP, ...saved, hours: { ...DEFAULT_SHOP.hours, ...(saved.hours || {}) } };
  cache = { at: Date.now(), value };
  return value;
}

async function saveShop(shop) {
  await store.saveShopJSON(JSON.stringify(shop));
  cache = { at: 0, value: null };
}

module.exports = { getShop, saveShop };
