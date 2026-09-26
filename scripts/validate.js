#!/usr/bin/env node
/* ================================================================
   Datenvalidierung für data/*.json – Regeln siehe CLAUDE.md
   Aufruf: node scripts/validate.js
   Exit 0 = alles ok, Exit 1 = mindestens ein Verstoß (wird gelistet)
   Keine Dependencies, nur Node-Standardbibliothek.
   ================================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const CATEGORIES = ['food', 'marketing', 'special', 'closing'];
const RASTER_START = 8 * 60;   /* 08:00 – Zeiten davor werden nicht angezeigt */
const RASTER_END = 22 * 60;    /* 22:00 exklusiv */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

const errors = [];
const err = (file, where, msg) => errors.push(`${file} – ${where}: ${msg}`);

const minutesOf = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const slotOf = t => Math.floor((minutesOf(t) - RASTER_START) / 30);

function parseDate(str) {
  const m = DATE_RE.exec(str || '');
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  /* Rückrechnung entlarvt ungültige Daten wie 31.02. */
  if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return null;
  return d;
}

const dayIdx = date => (date.getDay() + 6) % 7;   /* 0 = Montag */

/* Effektive Zeiten eines Schedules: times, once+from oder from/to/every */
function timesOf(o) {
  if (Array.isArray(o.times)) return o.times.slice();
  if (o.once) return o.from ? [o.from] : [];
  if (o.from && o.to && o.every > 0) {
    const out = [];
    for (let t = minutesOf(o.from); t <= minutesOf(o.to); t += o.every) {
      out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
    return out;
  }
  return null;   /* keine erkennbare Zeitangabe */
}

/* Datumsbereich [start, end] als Date-Paar; ohne end offen (weit in der Zukunft) */
const FAR_FUTURE = new Date(9999, 0, 1);
function rangeOf(o) {
  const start = parseDate(o.start);
  if (!start) return null;
  if (o.type === 'single') return [start, start];
  const end = o.end ? parseDate(o.end) : FAR_FUTURE;
  if (!end) return null;
  return [start, end];
}

/* Kommt Wochentag di im Bereich [from, to] vor? */
function weekdayInRange(di, from, to) {
  if ((to - from) / 86400000 >= 6) return true;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (dayIdx(d) === di) return true;
  }
  return false;
}

/* Wochentage, an denen ein Schedule läuft */
function daysOf(o) {
  if (o.type === 'single') {
    const d = parseDate(o.start);
    return d ? [dayIdx(d)] : [];
  }
  return (o.days || []).map(code => DAYS.indexOf(code)).filter(i => i >= 0);
}

function validateFile(file) {
  const name = `data/${file}`;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (e) {
    err(name, 'JSON', `nicht parsebar: ${e.message}`);
    return;
  }

  /* ---- Grundstruktur ---- */
  if (typeof data.storeName !== 'string' || !data.storeName) err(name, 'storeName', 'fehlt oder ist kein String');
  if (!Array.isArray(data.storeHours) || data.storeHours.length !== 7) {
    err(name, 'storeHours', 'muss ein Array mit genau 7 Einträgen sein (0 = Montag … 6 = Sonntag)');
    return;
  }
  data.storeHours.forEach((h, i) => {
    if (h === null) return;
    if (!Array.isArray(h) || h.length !== 2 || !TIME_RE.test(h[0]) || !TIME_RE.test(h[1])) {
      err(name, `storeHours[${i}]`, 'muss null oder ["HH:MM","HH:MM"] sein');
    } else if (minutesOf(h[0]) >= minutesOf(h[1])) {
      err(name, `storeHours[${i}]`, `Öffnung ${h[0]} liegt nicht vor Schließung ${h[1]}`);
    }
  });

  const quiet = Array.isArray(data.quietHours) ? data.quietHours : [];
  quiet.forEach((q, i) => {
    if (!Number.isInteger(q.day) || q.day < 0 || q.day > 6) err(name, `quietHours[${i}]`, `day muss 0–6 sein (ist ${q.day})`);
    if (!TIME_RE.test(q.from) || !TIME_RE.test(q.to)) err(name, `quietHours[${i}]`, 'from/to müssen "HH:MM" sein');
    else if (minutesOf(q.from) >= minutesOf(q.to)) err(name, `quietHours[${i}]`, `from ${q.from} liegt nicht vor to ${q.to}`);
  });

  const isQuiet = (di, t) => quiet.some(q =>
    q.day === di && TIME_RE.test(q.from) && TIME_RE.test(q.to) &&
    minutesOf(t) >= minutesOf(q.from) && minutesOf(t) < minutesOf(q.to));

  const schedules = Array.isArray(data.schedules) ? data.schedules : [];
  if (!Array.isArray(data.schedules)) err(name, 'schedules', 'fehlt oder ist kein Array');

  /* ---- Einzelne Schedules ---- */
  schedules.forEach((o, i) => {
    const label = `schedules[${i}] „${o.title || '(ohne Titel)'}“`;

    if (typeof o.title !== 'string' || !o.title) err(name, label, 'title fehlt');
    if (!CATEGORIES.includes(o.category)) err(name, label, `category muss exakt eine von ${CATEGORIES.join(' | ')} sein (ist ${JSON.stringify(o.category)})`);
    if (o.type !== 'weekly' && o.type !== 'single') err(name, label, `type muss "weekly" oder "single" sein (ist ${JSON.stringify(o.type)})`);

    if (!DATE_RE.test(o.start || '')) err(name, label, `start muss "dd.mm.yyyy" sein (ist ${JSON.stringify(o.start)})`);
    else if (!parseDate(o.start)) err(name, label, `start ${o.start} ist kein gültiges Datum`);
    if (o.end !== undefined) {
      if (!DATE_RE.test(o.end)) err(name, label, `end muss "dd.mm.yyyy" sein (ist ${JSON.stringify(o.end)})`);
      else if (!parseDate(o.end)) err(name, label, `end ${o.end} ist kein gültiges Datum`);
      else if (parseDate(o.start) && parseDate(o.start) > parseDate(o.end)) err(name, label, `start ${o.start} liegt nach end ${o.end}`);
    }

    if (o.type === 'weekly') {
      if (!Array.isArray(o.days) || !o.days.length) err(name, label, 'weekly braucht ein nicht-leeres days-Array');
      else o.days.forEach(d => { if (!DAYS.includes(d)) err(name, label, `unbekanntes Tageskürzel ${JSON.stringify(d)} (erlaubt: ${DAYS.join(', ')})`); });
    }
    if (o.type === 'single') {
      if (o.days !== undefined) err(name, label, 'single darf kein days haben');
      if (o.end !== undefined) err(name, label, 'single darf kein end haben');
    }

    const times = timesOf(o);
    if (times === null) { err(name, label, 'braucht times (oder from/to/every bzw. once+from)'); return; }
    if (!times.length) err(name, label, 'times ist leer');
    times.forEach(t => { if (!TIME_RE.test(t)) err(name, label, `Zeit ${JSON.stringify(t)} ist kein "HH:MM"`); });

    const validTimes = times.filter(t => TIME_RE.test(t));
    const dayIdxs = daysOf(o);

    validTimes.forEach(t => {
      const tm = minutesOf(t);

      /* Regel 4: Kalenderraster 08:00–22:00 */
      if (tm < RASTER_START || tm >= RASTER_END) {
        err(name, label, `Zeit ${t} liegt außerhalb des Kalenderrasters 08:00–22:00 und würde nicht angezeigt`);
      }

      dayIdxs.forEach(di => {
        /* Regel 1: Öffnungszeiten (closing darf bis einschließlich Schließzeit) */
        const h = data.storeHours[di];
        if (!h || !Array.isArray(h)) {
          err(name, label, `${DAYS[di]} ist geschlossen (storeHours null), trotzdem Zeit ${t} eingetragen`);
        } else if (TIME_RE.test(h[0]) && TIME_RE.test(h[1])) {
          const open = minutesOf(h[0]), close = minutesOf(h[1]);
          const okClose = o.category === 'closing' ? tm <= close : tm < close;
          if (tm < open || !okClose) {
            err(name, label, `Zeit ${t} am ${DAYS[di]} liegt außerhalb der Öffnungszeit ${h[0]}–${h[1]}${o.category === 'closing' ? ' (closing: bis einschließlich Schließzeit erlaubt)' : ''}`);
          }
        }

        /* Regel 2: Quiet Hours */
        if (isQuiet(di, t)) {
          const q = quiet.find(x => x.day === di && minutesOf(t) >= minutesOf(x.from) && minutesOf(t) < minutesOf(x.to));
          err(name, label, `Zeit ${t} am ${DAYS[di]} fällt in die Quiet Hour ${q.from}–${q.to}`);
        }
      });
    });

    /* Regel 3 (innerhalb eines Schedules): mehrere Nicht-closing-Zeiten im selben Slot */
    if (o.category !== 'closing') {
      const seen = new Map();
      validTimes.forEach(t => {
        const s = slotOf(t);
        if (s < 0) return;
        if (seen.has(s)) err(name, label, `Zeiten ${seen.get(s)} und ${t} liegen im selben 30-Minuten-Slot (nur closing darf das)`);
        else seen.set(s, t);
      });
    }
  });

  /* ---- Regel 3: Ein Spot pro Slot – über Schedules hinweg ---- */
  for (let a = 0; a < schedules.length; a++) {
    for (let b = a + 1; b < schedules.length; b++) {
      const A = schedules[a], B = schedules[b];
      if (A.category === 'closing' && B.category === 'closing') continue;

      const rA = rangeOf(A), rB = rangeOf(B);
      if (!rA || !rB) continue;   /* Datumsfehler wurden oben gemeldet */
      const from = rA[0] > rB[0] ? rA[0] : rB[0];
      const to = rA[1] < rB[1] ? rA[1] : rB[1];
      if (from > to) continue;    /* Zeiträume überlappen nicht */

      const daysA = daysOf(A), daysB = daysOf(B);
      const tA = (timesOf(A) || []).filter(t => TIME_RE.test(t));
      const tB = (timesOf(B) || []).filter(t => TIME_RE.test(t));

      daysA.filter(d => daysB.includes(d)).forEach(di => {
        if (!weekdayInRange(di, from, to)) return;
        tA.forEach(x => tB.forEach(y => {
          const s = slotOf(x);
          if (s >= 0 && s === slotOf(y) && !isQuiet(di, x) && !isQuiet(di, y)) {
            err(name, `„${A.title}“ / „${B.title}“`,
              `Slot-Konflikt am ${DAYS[di]}: ${x} und ${y} liegen im selben 30-Minuten-Slot (überlappender Zeitraum ab ${String(from.getDate()).padStart(2, '0')}.${String(from.getMonth() + 1).padStart(2, '0')}.${from.getFullYear()})`);
          }
        }));
      });
    }
  }
}

/* ---- Alle data/*.json prüfen ---- */
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('Keine data/*.json gefunden.');
  process.exit(1);
}

files.forEach(validateFile);

if (errors.length) {
  console.error(`✗ ${errors.length} Verstoß/Verstöße gefunden:\n`);
  errors.forEach(e => console.error(`  • ${e}`));
  process.exit(1);
}

console.log(`✓ ${files.length} Datei(en) geprüft, keine Verstöße: ${files.join(', ')}`);
