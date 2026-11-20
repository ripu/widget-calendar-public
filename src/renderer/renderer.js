// Relay dei log del renderer verso log/YYYY-MM-DD.txt.
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    window.widget.log(level, args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
}
window.addEventListener('error', (e) => window.widget.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => window.widget.log('error', `unhandled: ${e.reason}`));

const $ = (id) => document.getElementById(id);
const locale = navigator.language || 'it-IT';
const fmtTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const fmtClock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
let state = { events: [], days: 7 };

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Domani';
  return fmtDay.format(d);
}

// Link profondo al giorno in Google Calendar.
function gcalDayUrl(d) {
  return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderHeader() {
  const now = new Date();
  $('weekday').textContent = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now);
  $('date').textContent = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(now);
}

// "18 min", "2 h 05"
function fmtSpan(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// "tra 18 min", "tra 2 h 05", "domani 10:00", "tra 3 giorni".
function fmtDistance(ms, start) {
  if (ms < 60000) return 'ora';
  const days = Math.round((startOfDay(start) - startOfDay(new Date())) / 86400000);
  if (days === 1) return `domani ${fmtTime.format(start)}`;
  if (days > 1) return `tra ${days} giorni`;
  return `tra ${fmtSpan(ms)}`;
}

// Eventi con orario (non "giornata") in corso e prossimo da iniziare.
function findNow() {
  const now = Date.now();
  const timed = state.events.filter((e) => !e.allDay);
  const current = timed.filter((e) => Date.parse(e.start) <= now && now < Date.parse(e.end))
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))[0];
  const next = timed.find((e) => Date.parse(e.start) > now);
  return { current, next };
}

function line(label, what, when) {
  const row = el('div', 'line');
  row.append(el('span', 'label', label), el('span', 'what', what), el('span', 'when', when));
  return row;
}

// Aggiorna orologio, segnale del prossimo evento e badge in lista. Leggero: gira ogni secondo.
let lastTickKey = '';
function tick() {
  const now = new Date();
  $('clock').textContent = fmtClock.format(now);

  // Il resto cambia al massimo una volta al minuto.
  const { current, next } = findNow();
  const key = `${fmtTime.format(now)}|${current?.id}|${next?.id}`;
  if (key === lastTickKey) return;
  lastTickKey = key;

  const box = $('next');
  box.replaceChildren();
  box.className = 'next';
  if (!state.loaded || (!state.events.length && state.error)) { box.hidden = true; return; }
  box.hidden = false;

  if (current) {
    const left = Date.parse(current.end) - now;
    box.append(line('In corso', current.title, `ancora ${fmtSpan(left)}`));
  }
  if (next) {
    const start = new Date(next.start);
    const ms = start - now;
    box.append(line('Prossimo', next.title, fmtDistance(ms, start)));
    // Nell'ultima ora prima dell'inizio compare una barra che si riempie.
    if (ms <= 3600000) {
      const bar = el('div', 'bar');
      const fill = el('span');
      fill.style.width = `${Math.round(100 * (1 - ms / 3600000))}%`;
      bar.append(fill);
      box.append(bar);
    }
    if (ms <= 15 * 60000) box.classList.add('imminent');
    else if (ms <= 60 * 60000) box.classList.add('soon');
  } else if (!current) {
    box.append(line('Libero', `nessun altro impegno nei prossimi ${state.days} giorni`, ''));
  }

  for (const row of document.querySelectorAll('.ev.next-ev')) {
    row.classList.remove('next-ev');
    row.querySelector('.badge')?.remove();
  }
  // Badge in lista solo se il prossimo evento è oggi: per quelli lontani basta il segnale in alto.
  if (next && startOfDay(new Date(next.start)).getTime() === startOfDay(now).getTime()) {
    const row = document.querySelector(`.ev[data-id="${CSS.escape(next.id)}"]`);
    if (row) {
      row.classList.add('next-ev');
      row.querySelector('.time').append(el('div', 'badge', fmtDistance(new Date(next.start) - now, new Date(next.start))));
    }
  }
}

function render() {
  const t0 = performance.now();
  renderHeader();
  const list = $('list');
  list.replaceChildren();
  const now = Date.now();

  if (state.error && !state.events.length) {
    const box = el('div', 'state err');
    box.append(el('strong', '', 'Calendario non disponibile'), el('span', '', state.error));
    list.append(box);
    return;
  }

  // Raggruppa per giorno; un evento di più giorni compare in ognuno.
  const groups = new Map();
  const first = startOfDay(new Date());
  for (const ev of state.events) {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    for (let d = startOfDay(s); d < e || d.getTime() === startOfDay(s).getTime(); d = new Date(d.getTime() + 86400000)) {
      if (d < first) continue;
      const k = d.getTime();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ev);
      if (!ev.allDay) break;
    }
  }

  if (!groups.size) {
    const box = el('div', 'state');
    box.append(el('strong', '', 'Nessun impegno'), el('span', '', `Niente in agenda nei prossimi ${state.days} giorni.`));
    list.append(box);
  }

  for (const [k, evs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const d = new Date(k);
    const isToday = k === first.getTime();
    list.append(el('div', `day${isToday ? ' today' : ''}`, dayLabel(d)));
    evs.sort((a, b) => (b.allDay - a.allDay) || (a.start < b.start ? -1 : 1));
    for (const ev of evs) {
      const s = new Date(ev.start).getTime();
      const e = new Date(ev.end).getTime();
      const cls = ['ev'];
      if (ev.allDay) cls.push('allday');
      else if (e < now) cls.push('past');
      else if (s <= now && now < e) cls.push('now');
      const row = el('div', cls.join(' '));
      row.dataset.id = ev.id;
      row.tabIndex = 0;
      row.title = ev.location ? `${ev.title} — ${ev.location}` : ev.title;
      row.append(el('div', 'time', ev.allDay ? 'giornata' : fmtTime.format(new Date(ev.start))));
      const body = el('div');
      body.append(el('div', 'title', ev.title));
      if (ev.location) body.append(el('div', 'loc', ev.location));
      row.append(body);
      const open = () => window.widget.openExternal(gcalDayUrl(d));
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      list.append(row);
    }
  }

  const foot = $('foot');
  foot.className = `foot${state.error ? ' err' : ''}`;
  foot.textContent = state.error
    ? state.error
    : `Aggiornato alle ${fmtTime.format(new Date(state.updatedAt || Date.now()))}${state.demo ? ' · dati demo' : ''}`;
  lastTickKey = '';
  tick();
  console.log(`render ${state.events.length} eventi in ${Math.round(performance.now() - t0)}ms`);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  window.widget.setTheme(next);
}

function togglePin() {
  $('btn-pin').classList.toggle('on');
  window.widget.togglePin();
}

function refresh() {
  $('foot').textContent = 'Aggiornamento…';
  window.widget.refresh();
}

$('btn-refresh').addEventListener('click', refresh);
$('btn-theme').addEventListener('click', toggleTheme);
$('btn-pin').addEventListener('click', togglePin);
$('btn-guide').addEventListener('click', () => window.widget.openGuide());
$('btn-hide').addEventListener('click', () => window.widget.hide());

// Shortcut da tastiera, documentate nel README.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const actions = { r: refresh, t: toggleTheme, p: togglePin, g: () => window.widget.openGuide(), escape: () => window.widget.hide() };
  const fn = actions[e.key.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

window.widget.onEvents((payload) => {
  state = { ...state, ...payload, loaded: true };
  render();
});

window.widget.init().then((cfg) => {
  document.documentElement.dataset.theme = cfg.theme;
  if (cfg.pinned) $('btn-pin').classList.add('on');
  if (!cfg.hasGuide) $('btn-guide').hidden = true;
  state.days = cfg.days;
  state.demo = cfg.demo;
  renderHeader();
  tick();
});

// Ridisegna ogni minuto per aggiornare "in corso"/"passato" e il cambio giorno;
// orologio e segnale del prossimo evento si aggiornano ogni secondo.
setInterval(render, 60000);
setInterval(tick, 1000);
