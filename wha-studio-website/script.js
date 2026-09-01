/* ==========================================================================
   WHA Studio — "Drawn, Then Built"
   Vanilla JS. No dependencies. Progressive enhancement throughout:
   without JS the page is a legible single-column document.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. Project data — single source of truth.
   Content marked [PLACEHOLDER] is awaiting confirmation from the studio;
   everything else is drawn from WHA Studio's published material.
   -------------------------------------------------------------------------- */

const PROJECTS = [
  {
    slug: 'rm-residence',
    title: 'RM Residence',
    category: 'Residential',
    discipline: ['Architecture', 'Interior'],
    location: 'Surabaya, Indonesia',
    year: '', // [PLACEHOLDER] year unconfirmed
    scope: 'Architecture & Interior Design',
    statement:
      'A 78-metre site read as one continuous line. Living spaces unfold along a linear spine, a one-storey cube stands apart as a secluded pavilion for the parents, and the entry descends past a cascading waterfall that carries the main stair within it.',
    heroImage: 'assets/projects/rm-residence/01.svg',
    cover: 'assets/projects/rm-residence/cover.svg',
    images: ['assets/projects/rm-residence/01.svg', 'assets/projects/rm-residence/02.svg'],
    captions: ['The linear spine [placeholder image]', 'Entry sequence study [placeholder image]'],
  },
  {
    slug: 'bs-residence',
    title: 'BS Residence',
    category: 'Residential',
    discipline: ['Architecture', 'Interior'],
    location: 'Surabaya, Indonesia',
    year: '2023',
    scope: 'Architecture & Interior Design',
    statement:
      'Three masses on a 21 × 30 metre corner lot: a square volume takes the entrance, while two linear boxes flank it and fold around a central swimming pool — the house organised as an ensemble rather than a single block.',
    heroImage: 'assets/projects/bs-residence/01.svg',
    cover: 'assets/projects/bs-residence/cover.svg',
    images: ['assets/projects/bs-residence/01.svg', 'assets/projects/bs-residence/02.svg'],
    captions: ['Three masses, one court [placeholder image]', 'Massing study [placeholder image]'],
  },
  {
    slug: 'aj-residence',
    title: 'AJ Residence',
    category: 'Residential',
    discipline: ['Architecture', 'Interior'],
    location: 'Surabaya, Indonesia',
    year: '2024',
    scope: 'Architecture & Interior Design',
    statement:
      '[PLACEHOLDER] Project statement awaiting studio copy — a private residence in East Java completed in 2024.',
    heroImage: 'assets/projects/aj-residence/01.svg',
    cover: 'assets/projects/aj-residence/cover.svg',
    images: ['assets/projects/aj-residence/01.svg', 'assets/projects/aj-residence/02.svg'],
    captions: ['[Placeholder image]', '[Placeholder image]'],
  },
  {
    slug: 'al-residence',
    title: 'AL Residence',
    category: 'Residential',
    discipline: ['Architecture', 'Interior'],
    location: 'Indonesia',
    year: '', // [PLACEHOLDER] year unconfirmed
    scope: 'Architecture & Interior Design',
    statement:
      '[PLACEHOLDER] Project statement awaiting studio copy — a private residence from the studio’s residential portfolio.',
    heroImage: 'assets/projects/al-residence/01.svg',
    cover: 'assets/projects/al-residence/cover.svg',
    images: ['assets/projects/al-residence/01.svg', 'assets/projects/al-residence/02.svg'],
    captions: ['[Placeholder image]', '[Placeholder image]'],
  },
  {
    slug: 'expat-mori',
    title: 'Expat Roasters — Mori Tower',
    category: 'Commercial',
    discipline: ['Interior'],
    location: 'Jakarta, Indonesia',
    year: '2023',
    scope: 'Interior Design',
    statement:
      'A café perched at the sky lobby. Raw concrete is set against verdant green terrazzo — an industrial yet inviting room for one of Indonesia’s leading specialty roasters.',
    heroImage: 'assets/projects/expat-mori/01.svg',
    cover: 'assets/projects/expat-mori/cover.svg',
    images: ['assets/projects/expat-mori/01.svg', 'assets/projects/expat-mori/02.svg'],
    captions: ['Concrete and green terrazzo [placeholder image]', 'Material palette [placeholder image]'],
  },
  {
    slug: 'expat-flagship',
    title: 'Expat Roasters — Flagship',
    category: 'Commercial',
    discipline: ['Architecture', 'Interior'],
    location: 'Surabaya, Indonesia', // [PLACEHOLDER] confirm location
    year: '2023',
    scope: 'Architecture & Interior Design',
    statement:
      'Four storeys on a narrow 6 × 25 metre plot. Where the typology expects artificial light, the section is cut open instead — daylight drawn down through the building so the café breathes on every floor. Published on ArchDaily.',
    heroImage: 'assets/projects/expat-flagship/01.svg',
    cover: 'assets/projects/expat-flagship/cover.svg',
    images: ['assets/projects/expat-flagship/01.svg', 'assets/projects/expat-flagship/02.svg'],
    captions: ['The light shaft [placeholder image]', 'Section study [placeholder image]'],
  },
];

/* --------------------------------------------------------------------------
   2. Environment + motion preferences
   -------------------------------------------------------------------------- */

const mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const mqTouchOrNarrow = window.matchMedia('(max-width: 767px), (pointer: coarse)');
const mqFine = window.matchMedia('(pointer: fine)');
const mqNarrowProcess = window.matchMedia('(max-width: 860px)');

const motionOff = () =>
  mqReduced.matches || document.body.classList.contains('reduce-motion');

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* Storage + history can throw in sandboxed iframes / file:// contexts —
   degrade gracefully (intro replays, motion pref not persisted, no deep-link
   URL updates) rather than letting one SecurityError kill every interaction. */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
  sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch { /* unavailable */ } },
};
const safeHistory = {
  push(state, url) { try { history.pushState(state, '', url); } catch { /* sandboxed */ } },
  replace(state, url) { try { history.replaceState(state, '', url); } catch { /* sandboxed */ } },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* --------------------------------------------------------------------------
   3. Opening sequence — once per session, skippable, motion-aware
   -------------------------------------------------------------------------- */

const intro = $('#intro');
(function runIntro() {
  const seen = store.sget('wha-intro-seen');
  if (seen || motionOff()) {
    document.body.dataset.intro = 'skipped';
    return;
  }
  store.sset('wha-intro-seen', '1');
  const finish = () => {
    if (document.body.dataset.intro !== 'pending') return;
    document.body.dataset.intro = 'done';
  };
  const t = setTimeout(finish, 1700);
  const skipNow = () => { clearTimeout(t); finish(); };
  $('#introSkip').addEventListener('click', skipNow);
  intro.addEventListener('pointerdown', skipNow);
  window.addEventListener('keydown', skipNow, { once: true });
})();

/* --------------------------------------------------------------------------
   4. Focus trap utility (mobile menu + project overlay)
   -------------------------------------------------------------------------- */

function trapFocus(container) {
  const sel =
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = $$(sel, container).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

let scrollLocks = 0;
function lockScroll(on) {
  scrollLocks = Math.max(0, scrollLocks + (on ? 1 : -1));
  document.documentElement.style.overflow = scrollLocks ? 'hidden' : '';
}

/* --------------------------------------------------------------------------
   5. Navigation: scrolled state, progress bar, mobile menu
   -------------------------------------------------------------------------- */

const nav = $('#nav');
const progressBar = $('#progressBar');

const menu = $('#mobileMenu');
const menuToggle = $('#menuToggle');
let releaseMenuTrap = null;

function openMenu() {
  menu.hidden = false;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menuToggle.setAttribute('aria-expanded', 'true');
  menuToggle.setAttribute('aria-label', 'Close menu');
  releaseMenuTrap = trapFocus(menu);
  lockScroll(true);
  $('.menu__links a', menu).focus();
}
function closeMenu(returnFocus = true) {
  if (menu.hidden) return;
  menu.classList.remove('is-open');
  menu.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open menu');
  if (releaseMenuTrap) releaseMenuTrap();
  lockScroll(false);
  if (returnFocus) menuToggle.focus();
}
menuToggle.addEventListener('click', () =>
  menu.hidden ? openMenu() : closeMenu()
);
$('#menuClose').addEventListener('click', () => closeMenu());
$$('.menu__links a', menu).forEach((a) =>
  a.addEventListener('click', () => closeMenu(false))
);

/* --------------------------------------------------------------------------
   6. Project universe — scroll-driven horizontal rail
   -------------------------------------------------------------------------- */

const universe = $('.universe');
const railSticky = $('.universe__sticky');
const rail = $('#rail');
const railIndexEl = $('#railIndex');
const railTotalEl = $('#railTotal');
const railProgress = $('#railProgress');

let visibleProjects = [...PROJECTS];
let railMax = 0;          // max horizontal shift in px
let railRatio = 0;        // vertical scroll px per horizontal px
let railMode = 'static';  // 'driven' | 'native' | 'static'

function projectCard(p, i) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pcard';
  btn.dataset.slug = p.slug;
  btn.setAttribute('role', 'listitem');
  btn.setAttribute(
    'aria-label',
    `${p.title} — ${p.category}, ${p.location}${p.year ? ', ' + p.year : ''}. Open project.`
  );
  btn.innerHTML = `
    <span class="pcard__frame">
      <img src="${p.cover}" alt="" loading="lazy">
      <span class="pcard__no">${String(i + 1).padStart(2, '0')}</span>
    </span>
    <span class="pcard__body">
      <span class="pcard__title">${p.title}</span>
      <span class="pcard__meta">${p.category} · ${p.location}${p.year ? ' · ' + p.year : ''}</span>
      <span class="pcard__statement">${p.statement.replace(/\[PLACEHOLDER\]\s*/, '')}</span>
    </span>`;
  btn.addEventListener('click', () => openDetail(p.slug));
  return btn;
}

function renderRail() {
  rail.innerHTML = '';
  visibleProjects.forEach((p, i) => rail.appendChild(projectCard(p, i)));
  railTotalEl.textContent = String(visibleProjects.length).padStart(2, '0');
  layoutRail();
}

function layoutRail() {
  const driven = !mqTouchOrNarrow.matches && !motionOff();
  railMode = driven ? 'driven' : 'native';
  if (!driven) {
    universe.style.height = '';
    rail.style.transform = '';
    updateRailReadout(0);
    return;
  }
  rail.style.transform = 'translateX(0)';
  const trackW = rail.scrollWidth;
  const viewW = rail.clientWidth;
  railMax = Math.max(0, trackW - viewW);
  /* one viewport of vertical travel per ~55vw of horizontal shift */
  const travel = Math.max(railMax * 1.1, window.innerHeight * 0.5);
  railRatio = railMax ? travel / railMax : 0;
  universe.style.height = `${window.innerHeight + travel}px`;
  updateRail();
}

function railScrollProgress() {
  const rect = universe.getBoundingClientRect();
  const total = universe.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return clamp01(-rect.top / total);
}

function updateRail() {
  if (railMode !== 'driven') return;
  const p = railScrollProgress();
  rail.style.transform = `translateX(${-p * railMax}px)`;
  updateRailReadout(p);
}

function updateRailReadout(p) {
  const n = visibleProjects.length;
  let idx;
  if (railMode === 'driven') {
    idx = n ? Math.min(n, Math.floor(p * n) + 1) : 0;
    railProgress.style.transform = `scaleX(${p})`;
  } else {
    const max = rail.scrollWidth - rail.clientWidth;
    const sp = max > 0 ? rail.scrollLeft / max : 0;
    idx = n ? Math.min(n, Math.floor(sp * n) + 1) : 0;
    railProgress.style.transform = `scaleX(${sp})`;
  }
  railIndexEl.textContent = String(idx || (n ? 1 : 0)).padStart(2, '0');
}

rail.addEventListener('scroll', () => { if (railMode === 'native') updateRailReadout(0); }, { passive: true });

/* drag the rail (desktop driven mode) — translates drag into page scroll */
(function railDrag() {
  let dragging = false, lastX = 0, moved = 0;
  rail.addEventListener('pointerdown', (e) => {
    if (railMode !== 'driven' || e.pointerType !== 'mouse') return;
    dragging = true; lastX = e.clientX; moved = 0;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    window.scrollBy(0, -dx * railRatio);
  });
  window.addEventListener('pointerup', () => {
    if (dragging && moved > 6) {
      /* swallow the click that follows a real drag */
      rail.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
    }
    dragging = false;
  });
})();

/* keyboard: arrows step between projects while the rail (or a card) has focus */
function scrollToCard(i) {
  const n = visibleProjects.length;
  if (!n) return;
  const target = clamp01(n === 1 ? 0 : i / (n - 1));
  if (railMode === 'driven') {
    const total = universe.offsetHeight - window.innerHeight;
    window.scrollTo({ top: universe.offsetTop + target * total, behavior: motionOff() ? 'auto' : 'smooth' });
  } else {
    const card = rail.children[i];
    if (card) rail.scrollTo({ left: card.offsetLeft - rail.offsetLeft, behavior: motionOff() ? 'auto' : 'smooth' });
  }
}
function currentCardIndex() {
  const n = visibleProjects.length;
  if (railMode === 'driven') return Math.round(railScrollProgress() * Math.max(0, n - 1));
  const max = rail.scrollWidth - rail.clientWidth;
  return Math.round((max ? rail.scrollLeft / max : 0) * Math.max(0, n - 1));
}
rail.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.preventDefault(); scrollToCard(Math.min(visibleProjects.length - 1, currentCardIndex() + 1)); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollToCard(Math.max(0, currentCardIndex() - 1)); }
  if (e.key === 'Enter' && e.target === rail && visibleProjects.length) {
    /* prevent the same keystroke from activating the freshly-focused Close button */
    e.preventDefault();
    openDetail(visibleProjects[currentCardIndex()].slug);
  }
});
/* keep a tab-focused card in view in driven mode */
rail.addEventListener('focusin', (e) => {
  const card = e.target.closest('.pcard');
  if (card && railMode === 'driven') scrollToCard([...rail.children].indexOf(card));
});

/* category filters */
$$('.universe__filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('.universe__filters .chip').forEach((c) => {
      c.classList.toggle('is-active', c === chip);
      c.setAttribute('aria-pressed', String(c === chip));
    });
    const f = chip.dataset.filter;
    visibleProjects = f === 'all'
      ? [...PROJECTS]
      : PROJECTS.filter((p) => p.category === f || p.discipline.includes(f));
    renderRail();
    if (railMode === 'driven') {
      /* keep the section in view so the filter result is visible immediately */
      const top = universe.offsetTop;
      if (window.scrollY > top + universe.offsetHeight - window.innerHeight || window.scrollY < top) {
        window.scrollTo({ top, behavior: motionOff() ? 'auto' : 'smooth' });
      }
    }
  });
});

/* --------------------------------------------------------------------------
   7. Project detail overlay — dialog, hash deep-links, prev/next
   -------------------------------------------------------------------------- */

const detail = $('#detail');
const detailScroll = $('#detailScroll');
let releaseDetailTrap = null;
let detailSlug = null;
let lastCardFocused = null;

function detailHTML(p) {
  const meta = [
    ['Typology', p.category],
    ['Discipline', p.discipline.join(' · ')],
    ['Location', p.location],
    ['Year', p.year || '—'],
    ['Scope', p.scope],
  ];
  $('#detailEyebrow').textContent = `${p.category} · ${p.location}`;
  $('#detailTitle').textContent = p.title;
  $('#detailMeta').innerHTML = meta
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  $('#detailBody').innerHTML = `
    <p class="detail__statement">${p.statement.replace(/\[PLACEHOLDER\]\s*/, '')}</p>
    <figure class="detail__hero">
      <img src="${p.heroImage}" alt="${p.title} — placeholder artwork awaiting project photography">
      <figcaption>${p.captions[0] || ''}</figcaption>
    </figure>
    <div class="detail__pair">
      <figure>
        <img src="${p.images[0]}" alt="${p.title} — wide view placeholder" loading="lazy">
        <figcaption>${p.captions[0] || ''}</figcaption>
      </figure>
      <figure>
        <img src="${p.images[1] || p.cover}" alt="${p.title} — detail placeholder" loading="lazy">
        <figcaption>${p.captions[1] || ''}</figcaption>
      </figure>
    </div>
    <div class="detail__scopebox">
      <span>Scope — ${p.scope}</span>
      <span>Status — imagery pending from studio archive</span>
    </div>`;
  const list = PROJECTS;
  const i = list.findIndex((x) => x.slug === p.slug);
  const prev = list[(i - 1 + list.length) % list.length];
  const next = list[(i + 1) % list.length];
  $('#detailPrevLabel').textContent = prev.title;
  $('#detailNextLabel').textContent = next.title;
  $('#detailPrev').dataset.slug = prev.slug;
  $('#detailNext').dataset.slug = next.slug;
}

function openDetail(slug, pushHash = true) {
  const p = PROJECTS.find((x) => x.slug === slug);
  if (!p) return;
  const wasOpen = !detail.hidden;
  detailSlug = slug;
  detailHTML(p);
  if (!wasOpen) {
    lastCardFocused = document.activeElement;
    detail.hidden = false;
    lockScroll(true);
    releaseDetailTrap = trapFocus(detail);
  }
  detailScroll.scrollTop = 0;
  if (pushHash) {
    const url = `#/projects/${slug}`;
    if (wasOpen) safeHistory.replace({ project: slug }, url);
    else safeHistory.push({ project: slug }, url);
  }
  $('#detailClose').focus();
}

function closeDetail(fromPop = false) {
  if (detail.hidden) return;
  detail.hidden = true;
  detailSlug = null;
  lockScroll(false);
  if (releaseDetailTrap) releaseDetailTrap();
  if (!fromPop && location.hash.startsWith('#/projects/')) {
    safeHistory.push({}, location.pathname + location.search);
  }
  if (lastCardFocused && document.contains(lastCardFocused)) lastCardFocused.focus();
}

$('#detailClose').addEventListener('click', () => closeDetail());
$('#detailPrev').addEventListener('click', (e) => openDetail(e.currentTarget.dataset.slug));
$('#detailNext').addEventListener('click', (e) => openDetail(e.currentTarget.dataset.slug));
$('#detailCopy').addEventListener('click', async (e) => {
  const url = `${location.origin}${location.pathname}#/projects/${detailSlug}`;
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
  } catch {
    btn.textContent = url; /* fallback: show the URL itself */
  }
  setTimeout(() => (btn.textContent = 'Copy link'), 2200);
});

detail.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') openDetail($('#detailNext').dataset.slug);
  if (e.key === 'ArrowLeft') openDetail($('#detailPrev').dataset.slug);
});

window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#\/projects\/([a-z0-9-]+)/i);
  if (m) openDetail(m[1], false);
  else closeDetail(true);
});

/* global Escape: closes overlay first, then menu */
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!detail.hidden) closeDetail();
  else if (!menu.hidden) closeMenu();
});

/* deep link on load */
(function openFromHash() {
  const m = location.hash.match(/^#\/projects\/([a-z0-9-]+)/i);
  if (m) {
    document.body.dataset.intro = 'skipped';
    openDetail(m[1], false);
  }
})();

/* --------------------------------------------------------------------------
   8. Hero pointer depth (desktop, fine pointer, motion allowed)
   -------------------------------------------------------------------------- */

(function heroDepth() {
  const hero = $('#hero');
  const layers = $$('[data-depth]', hero);
  let raf = null, tx = 0, ty = 0;
  function apply() {
    raf = null;
    layers.forEach((el) => {
      const d = parseFloat(el.dataset.depth);
      el.style.transform = `translate3d(${tx * d * 18}px, ${ty * d * 12}px, 0)`;
    });
  }
  hero.addEventListener('pointermove', (e) => {
    if (!mqFine.matches || motionOff() || e.pointerType !== 'mouse') return;
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = (e.clientY / window.innerHeight) * 2 - 1;
    if (!raf) raf = requestAnimationFrame(apply);
  });
  hero.addEventListener('pointerleave', () => {
    tx = 0; ty = 0;
    if (!raf) raf = requestAnimationFrame(apply);
  });
})();

/* --------------------------------------------------------------------------
   9. Process — sticky scroll sequence
   -------------------------------------------------------------------------- */

const processSection = $('#process');
const phases = $$('.process__phase');
const processImgs = $$('.process__visual img');
const processMeter = $('#processMeter');

function layoutProcess() {
  const driven = !mqNarrowProcess.matches && !motionOff();
  processSection.style.height = driven ? `${window.innerHeight * 3.2}px` : '';
  if (!driven) {
    phases.forEach((el) => el.classList.add('is-active'));
  } else {
    updateProcess();
  }
}

function updateProcess() {
  if (mqNarrowProcess.matches || motionOff()) return;
  const rect = processSection.getBoundingClientRect();
  const total = processSection.offsetHeight - window.innerHeight;
  if (total <= 0) return;
  const p = clamp01(-rect.top / total);
  const active = Math.min(phases.length - 1, Math.floor(p * phases.length));
  phases.forEach((el, i) => el.classList.toggle('is-active', i === active));
  processImgs.forEach((img, i) => img.classList.toggle('is-active', i === active));
  processMeter.style.transform = `scaleX(${p})`;
}

/* --------------------------------------------------------------------------
   10. Scroll loop — nav state, page progress, rail, process
   -------------------------------------------------------------------------- */

let scrollRaf = null;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 40);
    const doc = document.documentElement;
    const total = doc.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${total > 0 ? y / total : 0})`;
    updateRail();
    updateProcess();
  });
}
window.addEventListener('scroll', onScroll, { passive: true });

/* --------------------------------------------------------------------------
   11. Reveal-on-scroll
   -------------------------------------------------------------------------- */

const revealObs = new IntersectionObserver(
  (entries) => entries.forEach((en) => {
    if (en.isIntersecting) {
      en.target.classList.add('is-in');
      revealObs.unobserve(en.target);
    }
  }),
  { threshold: 0.25, rootMargin: '0px 0px -5% 0px' }
);
$$('.reveal-line').forEach((el) => revealObs.observe(el));

/* --------------------------------------------------------------------------
   12. Founder credential toggles
   -------------------------------------------------------------------------- */

$$('.founder__toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const list = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    list.hidden = open;
  });
});

/* --------------------------------------------------------------------------
   13. Inquiry form — validates, then composes an inquiry summary.
   The prototype has no backend: the summary is copied to the clipboard and
   the visitor is pointed at the studio's live channels.
   -------------------------------------------------------------------------- */

$('#inquiryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = $('#formStatus');
  const data = Object.fromEntries(new FormData(form).entries());
  let valid = true;
  ['f-name', 'f-contact'].forEach((id) => {
    const input = document.getElementById(id);
    const ok = input.value.trim().length > 1;
    input.classList.toggle('is-invalid', !ok);
    if (!ok) valid = false;
  });
  if (!valid) {
    status.textContent = 'Please add your name and a way to reach you.';
    return;
  }
  const summary =
    `Inquiry for WHA Studio\n` +
    `Name: ${data.name}\nContact: ${data.contact}\n` +
    `Location: ${data.location || '—'}\nType: ${data.type || '—'}\n` +
    `Scale: ${data.scale || '—'}\nTimeline: ${data.timeline || '—'}\n` +
    `Description: ${data.description || '—'}`;
  let copied = false;
  try { await navigator.clipboard.writeText(summary); copied = true; } catch { /* clipboard unavailable */ }
  status.textContent = copied
    ? `Thank you, ${data.name.trim()}. Your inquiry summary has been copied to your clipboard — send it to the studio via Instagram @whastudio or the contact page above. (Prototype: direct inbox delivery is wired in production.)`
    : `Thank you, ${data.name.trim()}. This prototype does not yet submit to the studio inbox — please reach out via Instagram @whastudio or the contact page above.`;
  form.reset();
});

/* --------------------------------------------------------------------------
   14. Reduced-motion toggle + tab-visibility pause + resize + boot
   -------------------------------------------------------------------------- */

const motionToggle = $('#motionToggle');
if (store.get('wha-reduce-motion') === '1') {
  document.body.classList.add('reduce-motion');
  motionToggle.setAttribute('aria-pressed', 'true');
  motionToggle.textContent = 'Motion reduced — restore';
}
motionToggle.addEventListener('click', () => {
  const on = document.body.classList.toggle('reduce-motion');
  motionToggle.setAttribute('aria-pressed', String(on));
  motionToggle.textContent = on ? 'Motion reduced — restore' : 'Reduce motion';
  store.set('wha-reduce-motion', on ? '1' : '0');
  layoutRail();
  layoutProcess();
});

document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
});

let resizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { layoutRail(); layoutProcess(); }, 150);
});
mqTouchOrNarrow.addEventListener?.('change', () => { layoutRail(); });
mqNarrowProcess.addEventListener?.('change', () => { layoutProcess(); });
mqReduced.addEventListener?.('change', () => { layoutRail(); layoutProcess(); });

$('#year').textContent = new Date().getFullYear();

renderRail();
layoutProcess();
onScroll();
