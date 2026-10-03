'use strict';

const env = require('../env');

const url = env.get('DATABASE_URL') || env.get('POSTGRES_URL');

let driver;
if (url) driver = require('./postgres').create(url);
else if (env.onVercel) driver = require('./sqlite').create({ memory: true }); // preview only, nothing is saved
else driver = require('./sqlite').create({ memory: false });

module.exports = driver;
