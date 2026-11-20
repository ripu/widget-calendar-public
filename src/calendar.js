// Scarica il feed iCal e lo trasforma in una lista di occorrenze ordinate,
// espandendo gli eventi ricorrenti (RRULE) ed escludendo le EXDATE.
const ical = require('node-ical');
const log = require('./logger');

function dayKey(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function occurrences(ev, from, to) {
  const out = [];
  const duration = (ev.end ? ev.end - ev.start : 0) || (ev.datetype === 'date' ? 86400000 : 0);
  const allDay = ev.datetype === 'date';
  const push = (start, src) => out.push({
    id: `${ev.uid}-${start.getTime()}`,
    uid: ev.uid,
    title: src.summary || '(senza titolo)',
    location: src.location || '',
    start: start.toISOString(),
    end: new Date(start.getTime() + duration).toISOString(),
    allDay,
    url: src.url || '',
  });

  if (ev.rrule) {
    const exdates = new Set(Object.values(ev.exdate || {}).map((d) => new Date(d).getTime()));
    // Le date tutto-il-giorno vanno confrontate per giorno, non per istante.
    const isExcluded = (d) => exdates.has(d.getTime()) || (allDay && [...exdates].some((x) => dayKey(new Date(x)) === dayKey(d)));
    for (const d of ev.rrule.between(new Date(from.getTime() - duration), to, true)) {
      if (isExcluded(d)) continue;
      const override = ev.recurrences && Object.values(ev.recurrences).find((r) => r.recurrenceid && new Date(r.recurrenceid).getTime() === d.getTime());
      if (override) continue; // le eccezioni modificate arrivano come VEVENT propri
      push(d, ev);
    }
    for (const r of Object.values(ev.recurrences || {})) {
      if (r.start < to && new Date(r.end || r.start) > from && r.status !== 'CANCELLED') push(new Date(r.start), r);
    }
  } else if (ev.start < to && new Date(ev.start.getTime() + duration) > from) {
    push(ev.start, ev);
  }
  return out;
}

async function fetchEvents(url, days) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'WidgetCalendar/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const t1 = Date.now();
  const data = ical.sync.parseICS(text);

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000);

  const events = Object.values(data)
    .filter((e) => e.type === 'VEVENT' && e.status !== 'CANCELLED' && !e.recurrenceid)
    .flatMap((e) => occurrences(e, from, to))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  log.info(`fetch ${t1 - t0}ms, parse ${Date.now() - t1}ms, ${events.length} eventi in ${days} giorni`);
  return events;
}

// Unisce le liste di più calendari togliendo i doppioni: un invito presente in
// due calendari ha lo stesso UID; in subordine stesso titolo, inizio e fine.
function mergeEvents(lists) {
  const seen = new Set();
  const out = [];
  let dupes = 0;
  for (const ev of lists.flat()) {
    const keys = [ev.id, `${ev.title.trim().toLowerCase()}|${ev.start}|${ev.end}`];
    if (keys.some((k) => seen.has(k))) { dupes++; continue; }
    keys.forEach((k) => seen.add(k));
    out.push(ev);
  }
  if (dupes) log.info(`rimossi ${dupes} doppioni tra ${lists.length} calendari`);
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

function demoEvents() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const at = (day, h, m = 0) => new Date(base.getTime() + day * 86400000 + (h * 60 + m) * 60000);
  const mk = (title, day, h, m, mins, location = '') => ({
    id: `${title}-${day}`, title, location, allDay: false,
    start: at(day, h, m).toISOString(), end: new Date(at(day, h, m).getTime() + mins * 60000).toISOString(),
  });
  // Un evento fra 12 minuti, così la demo mostra sempre il segnale "imminente".
  const soon = new Date(Math.ceil((Date.now() + 12 * 60000) / 60000) * 60000);
  return [
    { id: 'soon', title: 'Call con Luca', location: 'Google Meet', allDay: false,
      start: soon.toISOString(), end: new Date(soon.getTime() + 30 * 60000).toISOString() },
    { id: 'bday', title: 'Compleanno Marco', allDay: true, start: at(0, 0).toISOString(), end: at(1, 0).toISOString(), location: '' },
    mk('Standup team', 0, 9, 30, 15, 'Google Meet'),
    mk('Revisione progetto', 0, 11, 0, 60, 'Sala riunioni'),
    mk('Pranzo con cliente', 0, 13, 0, 90, 'Trattoria da Nino'),
    mk('Call fornitore', 1, 10, 0, 30),
    mk('Palestra', 1, 18, 30, 60),
    mk('Dentista', 2, 15, 0, 45, 'Via Etnea 120'),
    mk('Consegna preventivo', 4, 12, 0, 30),
  ];
}

module.exports = { fetchEvents, mergeEvents, demoEvents };
