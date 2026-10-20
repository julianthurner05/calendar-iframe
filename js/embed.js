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
  { value: 'closing',    label: 'Opening/Closing', color: 'var(--cat-closing)' },
  { value: 'standard',   label: 'Standard',        color: 'var(--cat-standard)' },
  { value: 'commercial', label: 'Commercial',      color: 'var(--cat-commercial)' },
  { value: 'special',    label: 'Special',         color: 'var(--cat-special)' },
];
const catOf    = id => CATEGORIES.find(c => c.value === id) || {};
const catColor = id => catOf(id).color || 'transparent';

function catVars(id) {
  const v = { '--cat': catColor(id), '--cat-tint': '', '--cat-tint-strong': '' };
  if (id === 'commercial') { v['--cat-tint'] = 'var(--cat-tint-commercial)'; v['--cat-tint-strong'] = 'var(--cat-tint-commercial-strong)'; }
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
const calendarView = document.querySelector('.calendar-view');

const isMobile = () => window.matchMedia('(max-width: 980px)').matches;
let mobileDay = dayIdx(new Date());     /* Tagesansicht am Handy */

const SLOT_MIN       = 15;                         /* Länge eines Slots in Minuten – einzige Quelle fürs Raster */
const CAL_HOUR_START = 8;
const CAL_HOUR_END   = 22;                         /* exklusiv */
const CAL_SLOTS      = (CAL_HOUR_END - CAL_HOUR_START) * 60 / SLOT_MIN;
const SLOTS_PER_HOUR = 60 / SLOT_MIN;
document.documentElement.style.setProperty('--cal-slots', CAL_SLOTS);
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

const slotIndex = t => Math.floor((minutesOf(t) - CAL_HOUR_START * 60) / SLOT_MIN);
const slotTime  = s => hhmm(CAL_HOUR_START * 60 + s * SLOT_MIN);

/* Zeitspalte: volle Stunde kräftig, halbe Stunde nur im ausgeklappten Modus;
   gestreckte Slots (rowsPer > 1) bekommen leere Zusatzzeilen */
function timeColumn(rowsPer) {
  let html = '<div class="cal-col cal-col--time"><div class="cal-col__head"></div><div class="cal-col__body">';
  for (let s = 0; s < CAL_SLOTS; s++) {
    const hour = s % SLOTS_PER_HOUR === 0;
    const half = !hour && s % (SLOTS_PER_HOUR / 2) === 0;
    html += `<div class="cal-time${half ? ' cal-time--half' : ''}">${hour || half ? slotTime(s) : ''}</div>`;
    html += '<div class="cal-time"></div>'.repeat(rowsPer[s] - 1);
  }
  return html + '</div></div>';
}
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

  /* Zeilen je Slot: mehrere Opening/Closing-Zeiten im selben Slot passen
     nicht ins Raster und bekommen je eine eigene Zeile – der Slot wird für
     die ganze Woche gestreckt, damit Zeitspalte und alle Tage bündig bleiben */
  const rowsPer = [...Array(CAL_SLOTS)].map((_, s) => Math.max(1, ...grid.map(slots => slots[s].spots.length)));
  const totalRows = rowsPer.reduce((a, b) => a + b, 0);
  calendarView.style.setProperty('--cal-slots', totalRows);

  let html = timeColumn(rowsPer);

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
    let row = 0;                             /* laufende Zeile – für die Stapelung */
    const emptyRow = (s, closed) =>
      `<div class="cal-slot${closed ? ' cal-slot--closed' : ''}" data-slot="${s}" style="z-index:${totalRows - row++}"><div class="cal-slot__inner"></div></div>`;

    slots.forEach((slot, s) => {
      if (skip > 0) { skip--; return; }

      /* Quiet Hour als Block */
      if (slot.quiet && !slot.spots.length) {
        let n = 1;
        while (slots[s + n] && slots[s + n].quiet && !slots[s + n].spots.length) n++;
        skip = n - 1;
        const rows = rowsPer.slice(s, s + n).reduce((a, b) => a + b, 0);
        row += rows;
        html += `<div class="cal-quiet" data-slot="${s}" data-span="${n}" style="height: calc(${rows} * var(--slot-h) + ${rows - 1} * var(--slot-gap))">Quiet Hour</div>`;
        return;
      }

      /* ein Spot pro Zeile – mehrere (nur Opening/Closing) stehen untereinander */
      const sorted = [...slot.spots].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
      sorted.forEach(({ o, uid, time }) => {
        html += `<div class="cal-slot cal-slot--spot cal-hit" data-slot="${s}" data-uid="${uid}" style="${catStyle(o.category)}z-index:${totalRows - row++}">
          <div class="cal-slot__inner">
            <div class="cal-slot__title">
              <span class="cal-slot__time">${time}</span>
              ${o.locked ? icon('lock', 'cal-slot__lock') : ''}
              <span class="cal-slot__text">${escapeHtml(o.title)}</span>
            </div>
          </div>
        </div>`;
      });
      for (let r = sorted.length; r < rowsPer[s]; r++) html += emptyRow(s, slot.closed);
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
  const s = (now.getHours() * 60 + now.getMinutes() - CAL_HOUR_START * 60) / SLOT_MIN;
  if (s < 0 || s >= CAL_SLOTS) return;
  const body = col.querySelector('.cal-col__body');
  /* Elemente des aktuellen Slots (gestreckte Slots: mehrere Zeilen, Quiet-Block:
     mehrere Slots) – Position aus dem DOM */
  const covers = el => {
    const a = parseInt(el.dataset.slot, 10), n = parseInt(el.dataset.span, 10) || 1;
    return Math.floor(s) >= a && Math.floor(s) < a + n;
  };
  const els = [...body.querySelectorAll('.cal-slot, .cal-quiet')].filter(covers);
  if (!els.length) return;
  const start = parseInt(els[0].dataset.slot, 10);
  const span = parseInt(els[0].dataset.span, 10) || 1;
  const top = els[0].offsetTop;
  const last = els[els.length - 1];
  const line = document.createElement('div');
  line.className = 'cal-now';
  line.style.top = `${top + (s - start) / span * (last.offsetTop + last.offsetHeight - top)}px`;
  body.appendChild(line);
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

/* ---- Dichte: Collapsed (Farblinien) ↔ Expanded (Slots mit Titel) ----
   FLIP: das Layout springt sofort in den Zielzustand, sichtbar gleitet es
   nur per transform – jede Zeile startet an ihrer alten Position und Höhe.
   Keyframes enthalten nur transform (transform-origin steht fest im CSS),
   damit der Browser sie auf dem Compositor abspielt; Höhen-Transitions über
   ~450 Zeilen hätten jeden Frame ein Layout erzwungen (in Safari ruckelig).
   Das Raster selbst – Fläche und Spaltenlinien – wird per clip-path auf-
   bzw. zugedeckt: ohne Layout, mit exakten runden Ecken. */
let densityAnims = [];
let titleTimer = null;

function morphDensity(value) {
  setLit(null);
  calGrid.querySelectorAll('.cal-now').forEach(n => n.remove());

  const rows = [...calGrid.querySelectorAll('.cal-col__body > .cal-time, .cal-col__body > .cal-slot, .cal-col__body > .cal-quiet')];
  const top0 = calGrid.getBoundingClientRect().top;
  const first = rows.map(el => el.getBoundingClientRect());

  densityAnims.forEach(a => a.cancel());
  densityAnims = [];
  calGrid.style.minHeight = '';
  const gridFirst = calGrid.getBoundingClientRect().height;
  calendarView.dataset.density = value;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { renderNowLine(); return; }

  const top1 = calGrid.getBoundingClientRect().top;
  const last = rows.map(el => el.getBoundingClientRect());
  const gridLast = calGrid.getBoundingClientRect().height;
  const css = getComputedStyle(calendarView);
  const timing = {
    duration: parseFloat(css.getPropertyValue('--density-dur')) || 560,
    easing: css.getPropertyValue('--ease').trim() || 'ease',
  };

  calGrid.classList.add('is-morphing', 'is-hiding-titles');
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => calGrid.classList.remove('is-hiding-titles'), timing.duration * 0.6);
  rows.forEach((el, i) => {
    const a = first[i], b = last[i];
    let from;
    if (el.classList.contains('cal-time') || el.classList.contains('cal-quiet')) {
      /* reine Text-Zeilen (Uhrzeit, „Quiet Hour“) nur verschieben (mittig), nie stauchen */
      const dy = (a.top - top0 + a.height / 2) - (b.top - top1 + b.height / 2);
      if (Math.abs(dy) < 0.5) return;
      from = `translateY(${dy}px)`;
    } else {
      const dy = (a.top - top0) - (b.top - top1);
      const sy = b.height ? a.height / b.height : 1;
      from = `translateY(${dy}px) scaleY(${sy})`;
    }
    densityAnims.push(el.animate([{ transform: from }, { transform: 'none' }], timing));
  });

  /* Raster für die Dauer mindestens so hoch wie das größere der beiden
     Zustände halten (beim Zuklappen) und den Überstand unten wegclippen */
  const gridMax = Math.max(gridFirst, gridLast);
  const radius = getComputedStyle(calGrid).borderTopLeftRadius;
  const clip = h => `inset(0px 0px ${gridMax - h}px 0px round ${radius})`;
  calGrid.style.minHeight = `${gridMax}px`;
  const gridAnim = calGrid.animate([{ clipPath: clip(gridFirst) }, { clipPath: clip(gridLast) }], timing);
  densityAnims.push(gridAnim);

  gridAnim.finished.then(() => {
    calGrid.style.minHeight = '';
    calGrid.classList.remove('is-morphing');
    renderNowLine();
  }, () => {});                                   /* abgebrochen: der nächste Wechsel übernimmt */
}

const densityToggle = document.getElementById('cal-density');
densityToggle.addEventListener('click', () => {
  const expanded = densityToggle.getAttribute('aria-checked') !== 'true';
  densityToggle.setAttribute('aria-checked', String(expanded));
  densityToggle.dataset.tip = expanded ? 'Collapse' : 'Expand';
  morphDensity(expanded ? 'expanded' : 'collapsed');
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
