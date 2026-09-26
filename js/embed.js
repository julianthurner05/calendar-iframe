/* ================================================================
   EMBED CALENDAR – eigenständige, schreibgeschützte Wochenansicht
   - Datensatz kommt pro Store aus data/<store>.json (?store=… oder
     Pfadsegment /<store>/), nicht mehr aus den Scheduler-Karten
   - Kategorie färbt die Slots, Hover leuchtet alle Slots eines Spots
   - Öffnungszeiten & Quiet Hours werden als gesperrt gezeichnet
   - Keine Edit-Funktionen: kein Stift, kein "Schedule spot here"
   ================================================================ */

/* ---- Helfer (aus app.js übernommen) ---- */
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const hhmm = mins => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
const minutesOf = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function parseDate(str) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date();
}

const dayIdx = date => (date.getDay() + 6) % 7;

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - dayIdx(m));
  return m;
}

const use = name => `<use href="#i-${name}"/>`;
const icon = (name, cls = '') => `<svg class="icon${cls ? ' ' + cls : ''}">${use(name)}</svg>`;

/* ---- Kategorien (aus schedule.js übernommen) ---- */
const CATEGORIES = [
  { value: 'food',      label: 'Food',      color: 'var(--cat-food)' },
  { value: 'marketing', label: 'Marketing', color: 'var(--cat-marketing)' },
  { value: 'special',   label: 'Special',   color: 'var(--cat-special)' },
  { value: 'closing',   label: 'Closing',   color: 'var(--cat-closing)' },
];
const catOf    = id => CATEGORIES.find(c => c.value === id) || {};
const catColor = id => catOf(id).color || 'transparent';

function catVars(id) {
  const v = { '--cat': catColor(id), '--cat-tint': '', '--cat-tint-strong': '' };
  if (id === 'food') { v['--cat-tint'] = 'var(--cat-tint-food)'; v['--cat-tint-strong'] = 'var(--cat-tint-food-strong)'; }
  return v;
}
const catStyle = id => Object.entries(catVars(id)).filter(([, v]) => v).map(([k, v]) => `${k}:${v};`).join('');

/* ---- DOM ---- */
const calStore  = document.getElementById('cal-store');
const calGrid   = document.getElementById('cal-grid');
const calRange  = document.getElementById('cal-range');
const calLegend = document.getElementById('cal-legend');
const calDays   = document.getElementById('cal-days');
const calEmpty  = document.getElementById('cal-empty');

const isMobile = () => window.matchMedia('(max-width: 980px)').matches;
let mobileDay = dayIdx(new Date());     /* Tagesansicht am Handy */

const CAL_HOUR_START = 8;
const CAL_HOUR_END   = 22;                         /* exklusiv */
const CAL_SLOTS      = (CAL_HOUR_END - CAL_HOUR_START) * 2;
const DAYS           = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_NAMES      = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_SHORT    = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---- Store-Datensatz: einzige Quelle für Regeln und Schedules ----
   Wird aus data/<store>.json geladen; bis dahin bleibt alles leer. */
let STORE_HOURS = [null, null, null, null, null, null, null];
let QUIET_HOURS = [];
let SCHEDULES   = [];

/* Store-Slug: erst ?store=…, sonst letztes Pfadsegment (/<store>/) */
function storeSlug() {
  const p = new URLSearchParams(location.search).get('store');
  if (p) return p;
  const seg = location.pathname.split('/').filter(Boolean).pop();
  return seg && seg !== 'index.html' ? seg : '';
}

let calWeekStart = mondayOf(new Date());

const slotIndex = t => Math.floor((minutesOf(t) - CAL_HOUR_START * 60) / 30);
const slotTime  = s => hhmm(CAL_HOUR_START * 60 + s * 30);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const weekDates = monday => [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });

function isOpen(dayI, time) {
  const h = STORE_HOURS[dayI];
  return !!h && minutesOf(time) >= minutesOf(h[0]) && minutesOf(time) < minutesOf(h[1]);
}

function isQuiet(dayI, time) {
  return QUIET_HOURS.some(q => q.day === dayI && minutesOf(time) >= minutesOf(q.from) && minutesOf(time) < minutesOf(q.to));
}

/* Slot-Vorkommen eines Schedules an einem Datum */
function occurrences(o, date) {
  const start = parseDate(o.start);
  if (date < start) return [];
  if (o.type === 'single') {
    if (!sameDay(start, date)) return [];
  } else {
    if (o.end && date > parseDate(o.end)) return [];
    if (!(o.days || []).includes(DAYS[dayIdx(date)])) return [];
  }

  const times = [];
  if (o.times) times.push(...o.times);
  else if (o.once) times.push(o.from);
  else {
    for (let t = minutesOf(o.from); t <= minutesOf(o.to); t += o.every) times.push(hhmm(t));
  }
  const di = dayIdx(date);
  return times
    .map(t => ({ time: t, slot: slotIndex(t) }))
    .filter(x => x.slot >= 0 && x.slot < CAL_SLOTS && !isQuiet(di, x.time));
}

function renderLegend() {
  calLegend.innerHTML = CATEGORIES.map(c =>
    `<span class="cal-legend__item"><span class="cal-legend__dot" style="background:${c.color}"></span>${c.label}</span>`
  ).join('');
}

function renderCalendar() {
  const days = weekDates(calWeekStart);
  const last = days[6];
  const sameMonth = days[0].getMonth() === last.getMonth();
  calRange.textContent = sameMonth
    ? `${MONTH_SHORT[days[0].getMonth()]} ${days[0].getDate()} – ${last.getDate()}, ${last.getFullYear()}`
    : `${MONTH_SHORT[days[0].getMonth()]} ${days[0].getDate()} – ${MONTH_SHORT[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;

  const today = new Date();

  /* Belegung je Tag & Slot */
  const grid = days.map((date, di) => {
    const slots = [...Array(CAL_SLOTS)].map((_, s) => ({
      spots: [],
      closed: !isOpen(di, slotTime(s)),
      quiet: isQuiet(di, slotTime(s)),
    }));
    SCHEDULES.forEach((o, uid) => occurrences(o, date).forEach(({ time, slot }) =>
      slots[slot].spots.push({ o, uid, time })));

    return slots;
  });

  /* Zeitspalte */
  let html = '<div class="cal-col cal-col--time"><div class="cal-col__head"></div><div class="cal-col__body">';
  for (let s = 0; s < CAL_SLOTS; s++) {
    html += `<div class="cal-time">${s % 2 === 0 ? slotTime(s) : ''}</div>`;
  }
  html += '</div></div>';

  /* Tagesleiste (Handy) */
  const mobile = isMobile();
  calDays.innerHTML = days.map((date, di) => `
    <button class="cal-days__btn${di === mobileDay ? ' is-active' : ''}" data-day="${di}" type="button">
      <span>${DAYS[di]}</span><span>${date.getDate()}</span>
    </button>`).join('');

  const total = grid.reduce((n, slots) => n + slots.reduce((m, s) => m + s.spots.length, 0), 0);
  calEmpty.hidden = total > 0;
  calEmpty.textContent = 'Nothing scheduled this week.';

  /* Tagesspalten */
  days.forEach((date, di) => {
    if (mobile && di !== mobileDay) return;
    const slots = grid[di];
    const isToday = sameDay(date, today);
    html += `<div class="cal-col${isToday ? ' cal-col--today' : ''}" data-day="${di}">
      <div class="cal-col__head">${DAY_NAMES[di].slice(0, 3)}<span class="cal-col__date">${date.getDate()}</span></div>
      <div class="cal-col__body">`;

    let skip = 0;
    slots.forEach((slot, s) => {
      if (skip > 0) { skip--; return; }

      /* Quiet Hour als Block */
      if (slot.quiet && !slot.spots.length) {
        let n = 1;
        while (slots[s + n] && slots[s + n].quiet && !slots[s + n].spots.length) n++;
        skip = n - 1;
        html += `<div class="cal-quiet" data-rows="${n}" style="height: calc(${n} * var(--slot-h) + ${n - 1} * var(--slot-gap))">Quiet Hour</div>`;
        return;
      }

      const z = CAL_SLOTS - s;               /* oben liegt über unten */
      if (!slot.spots.length) {
        html += `<div class="cal-slot${slot.closed ? ' cal-slot--closed' : ''}" data-slot="${s}" style="z-index:${z}"><div class="cal-slot__inner"></div></div>`;
        return;
      }

      /* ein Spot pro Slot – mehrere (nur Closing) werden zusammengefasst */
      const sorted = [...slot.spots].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
      const first = sorted[0];
      const o = first.o;
      const title = sorted.length > 1 ? `${o.title} +${sorted.length - 1}` : o.title;
      html += `<div class="cal-slot cal-slot--spot cal-hit" data-uid="${first.uid}" style="${catStyle(o.category)}z-index:${z}">
          <div class="cal-slot__inner">
            <span class="cal-slot__label">${escapeHtml(title)}</span>
            <div class="cal-slot__title">
              <span class="cal-slot__time">${first.time}</span>
              ${o.locked ? icon('lock', 'cal-slot__lock') : ''}
              <span class="cal-slot__text">${escapeHtml(title)}</span>
            </div>
          </div>
        </div>`;
    });

    html += '</div></div>';
  });

  calGrid.innerHTML = html;
  litUid = null;
  renderLegend();
  renderNowLine();
}

/* ---- Jetzt-Linie in der heutigen Spalte ---- */
function renderNowLine() {
  calGrid.querySelectorAll('.cal-now').forEach(n => n.remove());
  const col = calGrid.querySelector('.cal-col--today');
  if (!col) return;
  const now = new Date();
  const s = (now.getHours() * 60 + now.getMinutes() - CAL_HOUR_START * 60) / 30;
  if (s < 0 || s >= CAL_SLOTS) return;
  const body = col.querySelector('.cal-col__body');
  /* Slot-Elemente decken die Reihen ab (Quiet-Blöcke mehrere) – Position aus dem DOM */
  let row = 0;
  for (const el of body.querySelectorAll('.cal-slot, .cal-quiet')) {
    const span = parseInt(el.dataset.rows, 10) || 1;
    if (Math.floor(s) < row + span) {
      const line = document.createElement('div');
      line.className = 'cal-now';
      line.style.top = `${el.offsetTop + (s - row) / span * el.offsetHeight}px`;
      body.appendChild(line);
      return;
    }
    row += span;
  }
}

setInterval(renderNowLine, 60000);

calDays.addEventListener('click', e => {
  const btn = e.target.closest('.cal-days__btn');
  if (!btn) return;
  mobileDay = parseInt(btn.dataset.day, 10);
  renderCalendar();
});

let calResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(calResizeTimer);
  calResizeTimer = setTimeout(renderCalendar, 150);
});

/* ---- Hover: alle Slots desselben Spots leuchten auf ---- */
let litUid = null;

function setLit(uid) {
  if (uid === litUid) return;
  litUid = uid;
  calGrid.querySelectorAll('.cal-hit').forEach(s =>
    s.classList.toggle('is-lit', uid !== null && s.dataset.uid === uid));
}

calGrid.addEventListener('mousemove', e => {
  const hit = e.target.closest('.cal-hit');
  if (hit) { setLit(hit.dataset.uid); return; }
  if (e.target.closest('.cal-slot, .cal-quiet, .cal-col__head')) setLit(null);
});

calGrid.addEventListener('mouseleave', () => setLit(null));

/* ---- Titel dauerhaft anzeigen (reduziert ↔ beschriftet) ---- */
const calTitles = document.getElementById('cal-titles');
calTitles.addEventListener('click', () => {
  const on = !calTitles.classList.contains('is-on');
  calTitles.classList.toggle('is-on', on);
  calTitles.setAttribute('aria-checked', String(on));
  calGrid.classList.toggle('show-titles', on);
});

/* ---- Wochennavigation ---- */
const calPrev = document.getElementById('cal-prev');
const calNext = document.getElementById('cal-next');
calPrev.addEventListener('click', () => { calWeekStart.setDate(calWeekStart.getDate() - 7); renderCalendar(); });
calNext.addEventListener('click', () => { calWeekStart.setDate(calWeekStart.getDate() + 7); renderCalendar(); });
document.getElementById('cal-today').addEventListener('click', () => { calWeekStart = mondayOf(new Date()); renderCalendar(); });

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') calPrev.click();
  if (e.key === 'ArrowRight') calNext.click();
});

/* ---- Datensatz laden ---- */
async function loadStore() {
  const slug = storeSlug();
  try {
    if (!slug) throw new Error('no store');
    const res = await fetch(`data/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    STORE_HOURS = data.storeHours || STORE_HOURS;
    QUIET_HOURS = data.quietHours || [];
    SCHEDULES   = data.schedules  || [];
    if (data.storeName) {
      calStore.textContent = `Announcement Calendar · ${data.storeName}`;
      document.title = `${data.storeName} – Announcement Calendar`;
    }
    renderCalendar();
  } catch {
    document.querySelector('.calendar-view').hidden = true;
    const err = document.createElement('p');
    err.className = 'embed-error';
    err.innerHTML = `${icon('alert')} Calendar could not be loaded – unknown store.`;
    document.querySelector('.embed-main').appendChild(err);
  }
}

renderLegend();
loadStore();
