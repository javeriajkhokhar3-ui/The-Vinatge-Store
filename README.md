# The Vintage Store

Website for The Vintage Store, 930 E Duval St, Lake City, FL 32055.
Node.js and Express, with an owner admin page. No build step.

## Deploy on Vercel

1. **Import the repository** in Vercel. Leave the framework as "Other". `vercel.json` does the rest.
2. **Add a database.** Project, Storage tab, Create Database, choose **Neon (Postgres)**, connect it to this project for all environments.
   Vercel adds `DATABASE_URL` and `POSTGRES_URL` for you. Tables and sample items are created on first visit.
3. **Add photo storage.** Storage tab, Create, **Blob**, set to **Private**, connect to this project. This adds `BLOB_READ_WRITE_TOKEN`.
4. **Set the owner password.** Settings, Environment Variables, add `ADMIN_PASSWORD` (8+ characters, no quotes) for Production and Preview.
5. **Redeploy** (Deployments, the three dots, Redeploy). Variables only reach a deployment built after they were saved.
6. Open `https://YOUR-SITE.vercel.app/api/health`. Every line should say it is connected or configured.

`/api/health` never shows secrets. It tells you which of the above is missing, so it is the first place to look when something seems off.

Until step 2 is done the site still shows the sample collection, but it cannot save anything.
The admin page says so in a yellow banner, and the contact form politely asks visitors to call.

## Run it on your own computer

```bash
npm install
ADMIN_PASSWORD="pick-a-long-password" npm start
```

Open http://localhost:3000 and http://localhost:3000/admin. Needs Node 22.13 or newer.
With no `DATABASE_URL` it keeps data in `data/store.db` and photos in `uploads/`.
Set `DATABASE_URL` to use Postgres locally too.

## What the owner can do at /admin

- **Messages**: every request from the website, with the item it was about. Mark handled or delete.
- **Items**: add, edit, hide, or mark pieces as sold. Upload a photo (JPG, PNG, WebP, up to 4 MB). Without a photo an illustration is shown.
- **Shop details**: address, phone, hours, payment, parking. The home page, hours table, "Open now" sign and search-engine data all update.

## Replace the sample content

The 14 starting pieces and their prices in `server/seed.js` are **samples**, not real stock.
Open /admin, edit or delete them, and add your own photos before going live.
Also confirm the opening hours in Shop details. They came from an online directory listing and reviews disagree.

## Layout

```
api/index.js   Vercel serverless entry (every dynamic request is rewritten here)
server/        Express app, storage drivers (Postgres / SQLite), auth, validation, mail
views/         Home page template (kept out of public/ so it is always filled in by the server)
public/        Admin page, styles, scripts, fonts, illustrations
vercel.json    Routing, security headers, bundle settings
```

## Security notes

Admin cookie is HttpOnly, SameSite=Strict and signed. Login and the contact form are rate-limited, with counts kept in the database so the limit holds across serverless instances.
Uploads are checked by content, not file name, and stored in a private Blob store served only through this site.
A hidden honeypot field catches bots. A strict Content-Security-Policy is set on every response.
Fonts are self-hosted, so visitors' browsers contact no third party except the Google Maps embed.
