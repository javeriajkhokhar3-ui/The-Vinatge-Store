'use strict';

// Item photos. On Vercel they go to a private Vercel Blob store (served back through /uploads/:name).
// On your own computer or a server with a disk they are plain files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const env = require('./env');

const useBlob = !!env.get('BLOB_READ_WRITE_TOKEN');
const enabled = useBlob || !env.onVercel; // Vercel's disk is read-only, so no token means no uploads
const SAFE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const diskDir = () => env.get('UPLOAD_DIR') || path.join(__dirname, '..', 'uploads');

// Identify the real file type from its first bytes rather than trusting the browser.
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// Returns the stored file name, or null when the bytes are not a supported image.
async function save(buffer) {
  const ext = sniff(buffer);
  if (!ext) return null;
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (useBlob) {
    const { put } = require('@vercel/blob');
    await put(`items/${name}`, buffer, {
      access: 'private', contentType: TYPES[ext], addRandomSuffix: false, allowOverwrite: false
    });
  } else {
    fs.mkdirSync(diskDir(), { recursive: true });
    fs.writeFileSync(path.join(diskDir(), name), buffer);
  }
  return name;
}

async function remove(name) {
  if (!name || !SAFE.test(name)) return;
  try {
    if (useBlob) { const { del } = require('@vercel/blob'); await del(`items/${name}`); }
    else await fs.promises.rm(path.join(diskDir(), name), { force: true });
  } catch (err) { console.error('[files] could not delete', name, err.message); }
}

async function send(name, res) {
  if (!SAFE.test(name)) return res.status(404).type('text').send('Not found');
  const headers = { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
  if (useBlob) {
    const { get } = require('@vercel/blob');
    const r = await get(`items/${name}`, { access: 'private' });
    if (!r || r.statusCode !== 200 || !r.stream) return res.status(404).type('text').send('Not found');
    res.set({ ...headers, 'Content-Type': r.blob.contentType || TYPES[name.split('.')[1]] });
    const stream = Readable.fromWeb(r.stream);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }
  const file = path.join(diskDir(), name);
  if (!fs.existsSync(file)) return res.status(404).type('text').send('Not found');
  res.set({ ...headers, 'Content-Type': TYPES[name.split('.')[1]] });
  return fs.createReadStream(file).pipe(res);
}

// What the page and admin should show for a stored name.
const urlFor = (name) => (name ? `/uploads/${name}` : null);

module.exports = { enabled, useBlob, save, remove, send, urlFor, SAFE };
