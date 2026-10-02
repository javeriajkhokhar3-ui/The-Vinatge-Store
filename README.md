# The Vintage Store

Website for The Vintage Store, 930 E Duval St, Lake City, FL 32055.
A Node.js and SQLite site with an owner admin page. No build step.

## Run it

```bash
npm install
ADMIN_PASSWORD="pick-a-long-password" npm start
```

Open http://localhost:3000. The owner page is at http://localhost:3000/admin.
Needs Node 22.13 or newer (SQLite is built in, so there is nothing to compile). If you skip `ADMIN_PASSWORD`, a random one is printed in the terminal.

## What the owner can do at /admin

- **Messages**: every request from the website, with the item it was about. Mark handled or delete.
- **Items**: add, edit, hide, or mark pieces as sold. Upload a real photo (JPG, PNG, WebP, up to 6 MB). Without a photo, an illustration is shown.
- **Shop details**: address, phone, hours, payment, parking. The home page, hours table, "Open now" sign and search-engine data all update.

## Replace the sample content

The 14 starting pieces and their prices in `server/seed.js` are **samples**, not real stock.
Open /admin, edit or delete them, and add your own photos before going live.
Also confirm the opening hours in Shop details. They came from an online directory listing and reviews disagree on whether the shop keeps weekday hours.

## Deploy

Any host that runs Node works (Render, Railway, Fly.io, a VPS). Two things matter:

1. Set the variables from `.env.example` (at least `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production`, `TRUST_PROXY=1`).
2. Put `DATA_DIR` and `UPLOAD_DIR` on a **persistent disk**. Otherwise the database and photos reset on every deploy.

Optional: set the `SMTP_*` and `MAIL_TO` variables to get each request emailed as well as saved.

## Layout

```
server/        Express API, SQLite, auth, validation, mail
public/        Site, admin, styles, scripts, fonts, illustrations (art.svg)
data/          store.db (created on first run)
uploads/       Item photos (created on first run)
```

## Security notes

Admin cookie is HttpOnly, SameSite=Strict and signed. Login and contact form are rate-limited. Uploaded files are checked by content, not file name.
The contact form has a hidden honeypot field for bots. A strict Content-Security-Policy is set on every response.
Fonts are self-hosted, so visitors' browsers contact no third party except the Google Maps embed.
"# The-Vinatge-Store" 
