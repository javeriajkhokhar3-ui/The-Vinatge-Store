(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NS = 'http://www.w3.org/2000/svg';
  const motion = document.documentElement.classList.contains('motion');

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

  const state = { shop: null, categories: [], items: [], filter: 'all', trigger: null };

  // ---------- helpers ----------
  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong. Please try again.');
      err.status = res.status;
      err.fields = data && data.fields;
      throw err;
    }
    return data;
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function artSvg(key) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 160 200');
    svg.setAttribute('class', 'art');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `/art.svg#${/^[a-z]+$/.test(key) ? key : 'vase'}`);
    svg.appendChild(use);
    return svg;
  }

  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

  function fmtTime(t) {
    const [h, m] = t.split(':').map(Number);
    const hh = ((h + 11) % 12) + 1;
    return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  // ---------- header ----------
  const header = $('[data-header]');
  const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const menu = $('[data-menu]');
  const nav = $('#nav');
  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Close' : 'Menu';
  }
  menu.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); menu.focus(); } });

  // ---------- opening status (in the shop's own time zone) ----------
  function nowInZone(tz) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return { day: get('weekday').slice(0, 3).toLowerCase(), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
  }

  function openStatus(shop) {
    let now;
    try { now = nowInZone(shop.timezone); } catch (_) { return null; }
    const today = shop.hours[now.day];
    if (today) {
      const open = toMin(today[0]), close = toMin(today[1]);
      if (now.minutes >= open && now.minutes < close) return { day: now.day, open: true, text: `Open now, until ${fmtTime(today[1])}` };
      if (now.minutes < open) return { day: now.day, open: false, text: `Closed now, opens today at ${fmtTime(today[0])}` };
    }
    const start = DAYS.indexOf(now.day);
    for (let i = 1; i <= 7; i++) {
      const d = DAYS[(start + i) % 7];
      if (shop.hours[d]) {
        const when = i === 1 ? 'tomorrow' : DAY_NAMES[d];
        return { day: now.day, open: false, text: `Closed now, opens ${when} at ${fmtTime(shop.hours[d][0])}` };
      }
    }
    return { day: now.day, open: false, text: 'Closed for now. Call for hours.' };
  }

  function updateStatus() {
    if (!state.shop) return;
    const s = openStatus(state.shop);
    if (!s) return;
    const sign = $('[data-sign]');
    sign.dataset.state = s.open ? 'open' : 'closed';
    $('[data-sign-word]').textContent = s.open ? 'Open' : 'Closed';
    $('[data-sign-detail]').textContent = s.text;
    $$('[data-hours] tr').forEach((tr) => tr.classList.toggle('is-today', tr.dataset.day === s.day));
  }

  // ---------- hero: cabinet tilts toward the pointer ----------
  (function tilt() {
    const hero = $('.hero');
    const cab = $('[data-cabinet]');
    if (!motion || !cab || !window.matchMedia('(pointer: fine)').matches) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      cab.style.setProperty('--mx', cx.toFixed(3));
      cab.style.setProperty('--my', cy.toFixed(3));
      raf = Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : null;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      kick();
    });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
  })();

  // ---------- collection ----------
  const grid = $('[data-shelves]');
  const filtersEl = $('[data-filters]');
  const countEl = $('[data-count]');
  let io = null;

  function categoryLabel(id) {
    const c = state.categories.find((x) => x.id === id);
    return c ? c.label : id;
  }

  function renderFilters() {
    const counts = {};
    state.items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    const entries = [{ id: 'all', label: 'Everything', n: state.items.length }]
      .concat(state.categories.filter((c) => counts[c.id]).map((c) => ({ id: c.id, label: c.label, n: counts[c.id] })));
    if (!entries.some((e) => e.id === state.filter)) state.filter = 'all';
    filtersEl.replaceChildren(...entries.map((e) => {
      const b = el('button', 'filter', e.label);
      b.type = 'button';
      b.dataset.id = e.id;
      b.setAttribute('aria-pressed', String(state.filter === e.id));
      b.appendChild(el('span', 'filter__n', String(e.n)));
      return b;
    }));
  }

  function pieceEl(item) {
    const sold = item.status === 'sold';
    const b = el('button', 'piece' + (sold ? ' is-sold' : ''));
    b.type = 'button';
    b.dataset.id = item.id;
    const priceText = sold ? 'sold' : item.price == null ? 'ask us' : money(item.price);
    b.setAttribute('aria-label', `${item.title}, ${priceText}. Ask about this piece.`);

    const hang = el('span', 'hang');
    const tag = el('span', 'tag tag--item');
    tag.append(el('span', 'tag__title', item.title), el('span', 'tag__price', priceText));
    hang.appendChild(tag);

    const wrap = el('span', 'piece__art');
    if (item.image) {
      const img = el('img', 'piece__photo');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      wrap.appendChild(img);
    } else {
      wrap.appendChild(artSvg(item.art));
    }
    b.append(hang, wrap);
    if (sold) b.appendChild(el('span', 'sold', 'Sold'));
    return b;
  }

  function observePieces() {
    if (io) io.disconnect();
    const pieces = $$('.piece', grid);
    if (!motion || !('IntersectionObserver' in window)) { pieces.forEach((p) => p.classList.add('in')); return; }
    io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.target.offsetTop - b.target.offsetTop || a.target.offsetLeft - b.target.offsetLeft);
      seen.forEach((e, i) => {
        e.target.style.setProperty('--delay', `${i * 80}ms`);
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -6% 0px' });
    pieces.forEach((p) => io.observe(p));
  }

  function renderShelves() {
    const list = state.filter === 'all' ? state.items : state.items.filter((i) => i.category === state.filter);
    if (!list.length) {
      grid.replaceChildren(el('p', 'shelves__note', 'Nothing on these shelves right now. Check back soon, or call and ask what just came in.'));
    } else {
      grid.replaceChildren(...list.map(pieceEl));
    }
    const label = state.filter === 'all' ? 'all categories' : categoryLabel(state.filter);
    countEl.textContent = `Showing ${list.length} ${list.length === 1 ? 'piece' : 'pieces'} in ${label}.`;
    observePieces();
  }

  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('.filter');
    if (!b || b.dataset.id === state.filter) return;
    state.filter = b.dataset.id;
    $$('.filter', filtersEl).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderShelves();
  });

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.piece');
    if (!b) return;
    const item = state.items.find((i) => String(i.id) === b.dataset.id);
    if (item) openItem(item, b);
  });

  // ---------- item dialog ----------
  const dlg = $('#item-dialog');
  const dlgForm = $('[data-form]', dlg);

  function openItem(item, trigger) {
    state.trigger = trigger;
    $('[data-dlg-title]').textContent = item.title;
    $('[data-dlg-era]').textContent = [categoryLabel(item.category), item.era].filter(Boolean).join(', ');
    $('[data-dlg-price]').textContent = item.status === 'sold' ? 'Sold' : item.price == null ? 'Ask us' : money(item.price);
    $('[data-dlg-desc]').textContent = item.description || '';

    const artBox = $('[data-dlg-art]', dlg);
    if (item.image) {
      const img = el('img', 'piece__photo');
      img.src = item.image; img.alt = item.title;
      artBox.replaceChildren(img);
    } else {
      artBox.replaceChildren(artSvg(item.art));
    }

    resetForm(dlgForm);
    dlgForm.elements.itemId.value = item.id;
    dlgForm.elements.message.value = item.status === 'sold'
      ? `I saw the ${item.title}. Do you have anything similar?`
      : `Hello, is the ${item.title} still available?`;

    document.documentElement.classList.add('dlg-open');
    dlg.showModal();
    dlg.scrollTop = 0;
    $('.dlg__body', dlg).scrollTop = 0;
    if (motion) {
      dlg.animate([{ opacity: 0, transform: 'translateY(22px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
      artBox.animate([{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'translateY(4px)', offset: .6 }, { opacity: 1, transform: 'none' }], { duration: 650, delay: 120, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
  }

  let closing = false;
  function closeItem() {
    if (!dlg.open || closing) return;
    const done = () => {
      closing = false;
      dlg.close();
      document.documentElement.classList.remove('dlg-open');
      if (state.trigger && document.contains(state.trigger)) state.trigger.focus({ preventScroll: true });
    };
    if (!motion) { done(); return; }
    closing = true;
    dlg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.985)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).onfinish = done;
  }

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeItem(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeItem(); });
  $('[data-dlg-close]', dlg).addEventListener('click', closeItem);
  dlg.addEventListener('close', () => document.documentElement.classList.remove('dlg-open'));

  // ---------- forms ----------
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function checkFields(data) {
    const errors = {};
    if (!data.name.trim()) errors.name = 'Add your name.';
    const c = data.contact.trim();
    const digits = c.replace(/\D/g, '');
    const phone = /^[\d\s()+.-]+$/.test(c) && digits.length >= 7 && digits.length <= 15;
    if (!(EMAIL.test(c) || phone)) errors.contact = 'Add an email address or phone number so we can reply.';
    if (data.message.trim().length < 5) errors.message = 'Tell us what you are looking for.';
    return errors;
  }

  function clearErrors(form) {
    $$('.err', form).forEach((p) => { p.hidden = true; p.textContent = ''; });
    $$('[aria-invalid]', form).forEach((i) => { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
  }

  function showErrors(form, errors) {
    let first = null;
    Object.entries(errors).forEach(([key, msg]) => {
      const input = form.elements[key];
      const p = input && $(`#${input.id}-err`, form);
      if (!input || !p) return;
      p.textContent = msg; p.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', p.id);
      if (!first) first = input;
    });
    if (first) first.focus();
  }

  function resetForm(form) {
    const holder = form.parentElement;
    clearErrors(form);
    form.reset();
    form.hidden = false;
    const done = $('[data-done]', holder);
    if (done) done.hidden = true;
    const fe = $('[data-form-error]', form); fe.hidden = true; fe.textContent = '';
  }

  $$('[data-form]').forEach((form) => {
    const holder = form.parentElement;
    const done = $('[data-done]', holder);
    const label = $('[data-label]', form);
    const submit = $('button[type="submit"]', form);
    const formErr = $('[data-form-error]', form);
    const original = label.textContent;

    form.addEventListener('input', (e) => {
      const input = e.target;
      if (input.getAttribute && input.getAttribute('aria-invalid')) {
        const p = $(`#${input.id}-err`, form);
        if (p) { p.hidden = true; p.textContent = ''; }
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      formErr.hidden = true;
      const data = Object.fromEntries(new FormData(form).entries());
      ['name', 'contact', 'message', 'company'].forEach((k) => { data[k] = typeof data[k] === 'string' ? data[k] : ''; });
      const errors = checkFields(data);
      if (Object.keys(errors).length) { showErrors(form, errors); return; }

      submit.disabled = true;
      label.textContent = 'Sending';
      try {
        await getJSON('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        form.hidden = true;
        done.hidden = false;
        $('[data-thanks]', done).textContent = `Thanks, ${data.name.trim()}. We will reply to ${data.contact.trim()} as soon as we can.`;
        $('[data-thanks]', done).focus({ preventScroll: true });
      } catch (err) {
        if (err.fields) showErrors(form, err.fields);
        else {
          formErr.textContent = err.status === 429 ? err.message : `${err.message} If it keeps happening, call the shop.`;
          formErr.hidden = false;
        }
      } finally {
        submit.disabled = false;
        label.textContent = original;
      }
    });

    const again = $('[data-again]', holder);
    if (again) again.addEventListener('click', () => { resetForm(form); $('input', form).focus(); });
  });

  // ---------- boot ----------
  async function init() {
    const phoneText = ($('.callbtn') || { textContent: '' }).textContent.replace('Call', '').trim();
    try {
      const [shopRes, itemsRes] = await Promise.all([getJSON('/api/shop'), getJSON('/api/items')]);
      state.shop = shopRes.shop;
      state.categories = shopRes.categories;
      state.items = itemsRes.items;
      updateStatus();
      setInterval(updateStatus, 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) updateStatus(); });
      renderFilters();
      renderShelves();
    } catch (err) {
      const note = el('p', 'shelves__note');
      note.append('We could not load the collection just now. ');
      if (phoneText) {
        note.append('Call ');
        const a = el('a', '', phoneText);
        a.href = `tel:${phoneText.replace(/[^\d+]/g, '')}`;
        note.append(a, ' and we will tell you what is in.');
      }
      grid.replaceChildren(note);
    }
  }
  init();
})();
