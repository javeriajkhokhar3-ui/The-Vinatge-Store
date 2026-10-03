(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

  const meta = { categories: [], art: [], statuses: [] };
  let items = [];
  let shop = null;
  let toastTimer;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

  async function api(url, opts = {}) {
    const res = await fetch('/api/admin' + url, { credentials: 'same-origin', ...opts });
    let data = null; try { data = await res.json(); } catch (_) { /* empty */ }
    if (res.status === 401 && url !== '/login') { showLogin(); throw Object.assign(new Error('Please sign in.'), { status: 401 }); }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Something went wrong.'), { status: res.status, fields: data && data.fields });
    return data;
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function toast(msg) {
    const t = $('[data-toast]'); t.textContent = msg;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.textContent = ''; }, 4000);
  }

  function errorsOn(form, fields) {
    $$('.err', form).forEach((p) => { p.hidden = true; p.textContent = ''; });
    let first = null;
    Object.entries(fields || {}).forEach(([k, msg]) => {
      const input = form.elements[k]; const p = input && input.id && $('#' + input.id + '-err', form);
      if (p) { p.textContent = msg; p.hidden = false; input.setAttribute('aria-invalid', 'true'); if (!first) first = input; }
    });
    if (first) first.focus();
  }

  // ---- login ----
  const login = $('[data-login]'), app = $('[data-app]');
  function showLogin() { app.hidden = true; login.hidden = false; $('#pw').focus(); document.title = 'Owner sign in · The Vintage Store'; }
  async function showApp() {
    const s = await api('/session');
    Object.assign(meta, { categories: s.categories, art: s.art, statuses: s.statuses });
    login.hidden = true; app.hidden = false; document.title = 'Shop manager · The Vintage Store';
    setBadge(s.unhandled);
    showStorageWarnings(s.storage);
    fillSelects();
    await Promise.all([loadMessages(), loadItems(), loadShop()]);
  }

  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-login-error]'); err.hidden = true;
    try { await api('/login', json('POST', { password: $('#pw').value })); $('#pw').value = ''; await showApp(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  $('[data-logout]').addEventListener('click', async () => { try { await api('/logout', { method: 'POST' }); } catch (_) { /* ignore */ } showLogin(); });

  function showStorageWarnings(st) {
    const box = $('[data-warn]'); box.replaceChildren();
    const add = (t) => { const p = el('p', '', t); box.append(p); };
    if (!st.persistent) add('No database is connected, so this site is showing sample content and cannot save anything. Messages, items and shop details will not be kept. Connect a Postgres database (Vercel: Storage, then Neon) and redeploy.');
    if (!st.photos) add('Photo storage is not connected, so photos cannot be uploaded yet. Connect Vercel Blob to enable them.');
    box.hidden = !box.children.length;
  }

  // ---- tabs ----
  const tabs = $$('[role="tab"]');
  function selectTab(name, focus) {
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
    });
  });

  // ---- messages ----
  function setBadge(n) { const b = $('[data-badge]'); b.textContent = n; b.hidden = !n; }
  const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  async function loadMessages() {
    const { inquiries } = await api('/inquiries');
    setBadge(inquiries.filter((m) => !m.handled).length);
    const box = $('[data-messages]');
    if (!inquiries.length) { box.replaceChildren(el('p', 'adm-empty', 'No messages yet. New requests from the website will appear here.')); return; }
    box.replaceChildren(...inquiries.map((m) => {
      const c = el('article', 'msg' + (m.handled ? ' is-done' : ''));
      const top = el('div', 'msg__top');
      top.append(el('span', 'msg__about', m.itemTitle ? `About: ${m.itemTitle}` : 'General request'), el('span', 'msg__time', fmtDate(m.createdAt)));
      const who = el('p', 'msg__who'); who.append(`${m.name}, `);
      const looksEmail = m.contact.includes('@');
      const a = el('a', '', m.contact); a.href = (looksEmail ? 'mailto:' : 'tel:') + m.contact.replace(/\s/g, ''); who.append(a);
      const body = el('p', 'msg__body', m.message);
      const acts = el('div', 'msg__acts');
      const done = el('button', '', m.handled ? 'Mark as new' : 'Mark as handled'); done.type = 'button';
      done.addEventListener('click', async () => { try { await api('/inquiries/' + m.id, json('PATCH', { handled: !m.handled })); await loadMessages(); } catch (x) { toast(x.message); } });
      const del = el('button', '', 'Delete'); del.type = 'button';
      del.addEventListener('click', async () => { if (!confirm('Delete this message for good?')) return; try { await api('/inquiries/' + m.id, { method: 'DELETE' }); toast('Message deleted.'); await loadMessages(); } catch (x) { toast(x.message); } });
      acts.append(done, del);
      c.append(top, who, body, acts);
      return c;
    }));
  }

  // ---- items ----
  function fillSelects() {
    const fill = (name, opts) => { const s = $(`[data-item-form] [name="${name}"]`); s.replaceChildren(...opts.map(([v, l]) => { const o = el('option', '', l); o.value = v; return o; })); };
    fill('category', meta.categories.map((c) => [c.id, c.label]));
    fill('status', meta.statuses.map((s) => [s, { available: 'Available', sold: 'Sold (shows as sold)', hidden: 'Hidden (not shown)' }[s] || s]));
    fill('art', meta.art.map((a) => [a, a.charAt(0).toUpperCase() + a.slice(1)]));
  }

  const catLabel = (id) => (meta.categories.find((c) => c.id === id) || { label: id }).label;

  async function loadItems() {
    ({ items } = await api('/items'));
    const box = $('[data-items]');
    if (!items.length) { box.replaceChildren(el('p', 'adm-empty', 'No items yet. Add your first one.')); return; }
    const table = el('table', 'adm-table');
    const thead = el('thead'); const hr = el('tr');
    ['', 'Title', 'Category', 'Price', 'Status', ''].forEach((h) => hr.append(el('th', '', h)));
    thead.append(hr);
    const tbody = el('tbody');
    items.forEach((it) => {
      const tr = el('tr');
      const tdImg = el('td');
      if (it.image) { const im = el('img', 'thumb'); im.src = it.image; im.alt = ''; tdImg.append(im); }
      else { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 160 200'); sv.setAttribute('class', 'thumb'); sv.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `/art.svg#${it.art}`); sv.append(u); tdImg.append(sv); }
      const tdStatus = el('td'); tdStatus.append(el('span', 'pill ' + it.status, it.status));
      const tdActs = el('td', 'row-acts');
      const edit = el('button', '', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => openItemForm(it));
      const del = el('button', '', 'Delete'); del.type = 'button';
      del.addEventListener('click', async () => { if (!confirm(`Delete “${it.title}” for good?`)) return; try { await api('/items/' + it.id, { method: 'DELETE' }); toast('Item deleted.'); await loadItems(); } catch (x) { toast(x.message); } });
      tdActs.append(edit, del);
      tr.append(tdImg, el('td', '', it.title), el('td', '', catLabel(it.category)), el('td', 'num', it.price == null ? 'Ask' : '$' + it.price), tdStatus, tdActs);
      tbody.append(tr);
    });
    table.append(thead, tbody);
    const wrap = el('div', 'adm-scroll'); wrap.append(table);
    box.replaceChildren(wrap);
  }

  const idlg = $('[data-item-dlg]'), iform = $('[data-item-form]');
  function openItemForm(it) {
    iform.reset();
    errorsOn(iform, {});
    $$('[aria-invalid]', iform).forEach((n) => n.removeAttribute('aria-invalid'));
    $('[data-item-error]').hidden = true;
    $('[data-item-dlg-title]').textContent = it ? 'Edit item' : 'Add an item';
    iform.elements.id.value = it ? it.id : '';
    if (it) {
      iform.elements.title.value = it.title; iform.elements.category.value = it.category; iform.elements.status.value = it.status;
      iform.elements.price.value = it.price == null ? '' : it.price; iform.elements.era.value = it.era;
      iform.elements.description.value = it.description; iform.elements.art.value = it.art;
    }
    const thumb = $('[data-thumb]'), rm = $('[data-remove-wrap]');
    thumb.hidden = rm.hidden = !(it && it.image);
    if (it && it.image) thumb.src = it.image;
    idlg.showModal();
    iform.elements.title.focus();
  }
  $('[data-new-item]').addEventListener('click', () => openItemForm(null));
  $('[data-item-cancel]').addEventListener('click', () => idlg.close());

  iform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = iform.elements.id.value;
    const fd = new FormData(iform); fd.delete('id');
    if (!(fd.get('image') && fd.get('image').size)) fd.delete('image');
    const btn = $('button[type="submit"]', iform); btn.disabled = true;
    const ge = $('[data-item-error]'); ge.hidden = true;
    try {
      await api(id ? '/items/' + id : '/items', { method: id ? 'PUT' : 'POST', body: fd });
      idlg.close(); toast(id ? 'Item saved.' : 'Item added.'); await loadItems();
    } catch (x) {
      if (x.fields) errorsOn(iform, x.fields);
      if (!x.fields || x.fields.image === undefined) { ge.textContent = x.message; ge.hidden = false; }
    } finally { btn.disabled = false; }
  });

  // ---- shop details ----
  const TEXT = [['name', 'Shop name'], ['tagline', 'Tagline'], ['street', 'Street'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ['phone', 'Phone'], ['payment', 'Payment'], ['parking', 'Parking'], ['hoursNote', 'Note under the hours']];

  async function loadShop() { ({ shop } = await api('/shop')); renderShopForm(); }

  function renderShopForm() {
    const f = $('[data-shop-form]'); f.replaceChildren();
    const grid = el('div', 'adm-grid');
    TEXT.forEach(([k, label]) => {
      const w = el('div', 'field' + (k === 'hoursNote' || k === 'tagline' ? ' wide' : ''));
      const l = el('label', '', label); l.htmlFor = 's-' + k;
      const i = el('input'); i.id = 's-' + k; i.name = k; i.value = shop[k] || '';
      const p = el('p', 'err'); p.id = `s-${k}-err`; p.hidden = true;
      w.append(l, i, p); grid.append(w);
    });
    const accWrap = el('div', 'field wide'); const accL = el('label', 'check'); const acc = el('input'); acc.type = 'checkbox'; acc.name = 'accessible'; acc.checked = !!shop.accessible;
    accL.append(acc, ' Wheelchair accessible'); accWrap.append(accL); grid.append(accWrap);
    f.append(grid);

    f.append(el('h2', 'adm-h2', 'Opening hours'));
    const hg = el('div', 'hours-grid');
    DAYS.forEach(([k, label]) => {
      const h = shop.hours[k];
      const lab = el('span', '', label);
      const o = el('input'); o.type = 'time'; o.name = k + '-open'; o.value = h ? h[0] : '10:00'; o.setAttribute('aria-label', label + ' opens');
      const c = el('input'); c.type = 'time'; c.name = k + '-close'; c.value = h ? h[1] : '17:00'; c.setAttribute('aria-label', label + ' closes');
      const cl = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.name = k + '-closed'; cb.checked = !h;
      cl.append(cb, ' Closed');
      const sync = () => { o.disabled = c.disabled = cb.checked; };
      cb.addEventListener('change', sync); sync();
      hg.append(lab, o, c, cl);
    });
    f.append(hg);
    const hp = el('p', 'err'); hp.id = 's-hours-err'; hp.hidden = true; f.append(hp);
    const ge = el('p', 'err err--form'); ge.hidden = true; ge.dataset.shopError = ''; f.append(ge);
    const b = el('button', 'btn btn--paper', 'Save shop details'); b.type = 'submit'; f.append(b);
  }

  $('[data-shop-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const body = { hours: {} };
    TEXT.forEach(([k]) => { body[k] = f.elements[k].value; });
    body.accessible = f.elements.accessible.checked;
    DAYS.forEach(([k]) => { body.hours[k] = f.elements[k + '-closed'].checked ? null : [f.elements[k + '-open'].value, f.elements[k + '-close'].value]; });
    const ge = $('[data-shop-error]', f); ge.hidden = true;
    $$('.err', f).forEach((p) => { p.hidden = true; });
    try { ({ shop } = await api('/shop', json('PUT', body))); toast('Shop details saved. The website now shows them.'); renderShopForm(); }
    catch (x) {
      if (x.fields) { errorsOn(f, x.fields); if (x.fields.hours) { const hp = $('#s-hours-err'); hp.textContent = x.fields.hours; hp.hidden = false; } }
      ge.textContent = x.message; ge.hidden = false;
    }
  });

  // ---- start ----
  showApp().catch((e) => { if (e.status !== 401) { login.hidden = false; } });
})();
