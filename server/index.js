'use strict';

// Local / traditional-server entry point. On Vercel, api/index.js is used instead.
const app = require('./app');
const store = require('./store');
const { generatedPassword } = require('./auth');
const env = require('./env');

const PORT = Number(env.get('PORT') || 3000);

store.init().then(() => {
  app.listen(PORT, () => {
    console.log(`The Vintage Store is open at http://localhost:${PORT}  (database: ${store.kind})`);
    console.log(`Admin:   http://localhost:${PORT}/admin`);
    if (generatedPassword) {
      console.log(`Admin password for this run: ${generatedPassword}`);
      console.log('Set ADMIN_PASSWORD in your environment to keep it fixed.');
    }
  });
}).catch((err) => {
  console.error('Could not start: the database is not reachable.', err.message);
  process.exit(1);
});
