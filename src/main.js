const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { fetchEvents, mergeEvents, demoEvents } = require('./calendar');

const ROOT = path.join(__dirname, '..');
const DEMO = process.argv.includes('--demo');
const SCREENSHOT = process.argv.includes('--screenshot');

// .env minimale: KEY=VALUE per riga, # commenti. Nessuna dipendenza esterna.
function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    log.warn('.env non trovato: copia .env.example in .env e inserisci ICAL_URL');
  }
  return env;
}

const env = loadEnv();
const config = {
  // ICAL_URL, ICAL_URL_2, ICAL_URL_3…; ognuna può contenere più indirizzi separati da virgola.
  urls: Object.keys(env)
    .filter((k) => /^ICAL_URL(_\d+)?$/.test(k))
    .sort((a, b) => (Number(a.split('_')[2]) || 1) - (Number(b.split('_')[2]) || 1))
    .flatMap((k) => env[k].split(','))
    .map((s) => s.trim())
    .filter(Boolean),
  days: Number(env.DAYS) || 7,
  refreshMin: Number(env.REFRESH_MIN) || 5,
};

// Stato della finestra (posizione, dimensione, tema, pin) in userData.
const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
let settings = { width: 340, height: 520, theme: 'dark', pinned: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch { /* primo avvio */ }
const saveSettings = () => fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));

// Da sorgente l'eseguibile è electron.exe: senza il percorso del progetto
// come argomento, all'accesso partirebbe un Electron vuoto.
const LOGIN_ITEM = { path: process.execPath, args: app.isPackaged ? [] : [ROOT] };

let win;
let tray;
let lastEvents = [];

async function refresh() {
  if (DEMO) {
    lastEvents = demoEvents();
  } else if (!config.urls.length) {
    send({ error: 'ICAL_URL mancante nel file .env', events: [] });
    return;
  } else {
    try {
      const lists = await Promise.all(config.urls.map((u) => fetchEvents(u, config.days)));
      lastEvents = mergeEvents(lists);
    } catch (e) {
      // L'URL contiene un token segreto: non finisce mai nei log.
      log.error('aggiornamento fallito:', e.message);
      send({ error: `Aggiornamento non riuscito (${e.message})`, events: lastEvents });
      return;
    }
  }
  send({ events: lastEvents, updatedAt: new Date().toISOString() });
}

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('events', { ...payload, days: config.days });
}

const GUIDE = 'docs/guide/manuale{lang}.html';
const SLIDES = 'docs/slides/presentazione{lang}.html';

// Percorso del documento nella lingua di sistema, con ripiego sull'italiano;
// null se non c'è (la copia pubblica del progetto non include docs/).
function docPath(rel) {
  const lang = app.getLocale().startsWith('it') ? '' : '_en';
  return [rel.replace('{lang}', lang), rel.replace('{lang}', '')]
    .map((r) => path.join(ROOT, r))
    .find((f) => fs.existsSync(f)) || null;
}

function openDoc(rel) {
  const target = docPath(rel);
  if (!target) { log.warn('documento assente', rel); return; }
  log.info('apro documento', path.relative(ROOT, target));
  shell.openPath(target);
}

// Solo Google Calendar: gli eventi arrivano da feed di terzi (chiunque ti invii un invito).
function openSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'calendar.google.com') return shell.openExternal(url);
  } catch { /* URL non valido */ }
  log.warn('link esterno bloccato', String(url).slice(0, 80));
}

function setPinned(on) {
  settings.pinned = on;
  win.setAlwaysOnTop(on, 'floating');
  saveSettings();
  buildTray();
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'branding', 'icon.png'));
  if (!tray) {
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Widget Calendar');
    tray.on('click', () => (win.isVisible() ? win.hide() : win.show()));
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Aggiorna ora', click: refresh },
    { label: 'Mostra / nascondi', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: 'Sempre in primo piano', type: 'checkbox', checked: settings.pinned, click: (i) => setPinned(i.checked) },
    { label: 'Avvia con Windows', type: 'checkbox', checked: app.getLoginItemSettings(LOGIN_ITEM).openAtLogin,
      click: (i) => app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: i.checked }) },
    { type: 'separator' },
    ...(docPath(GUIDE) ? [{ label: '📖 Guida', click: () => openDoc(GUIDE) }] : []),
    ...(docPath(SLIDES) ? [{ label: '🎞️ Presentazione', click: () => openDoc(SLIDES) }] : []),
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: settings.width, height: settings.height, x: settings.x, y: settings.y,
    minWidth: 260, minHeight: 200,
    frame: false, transparent: true, resizable: true, skipTaskbar: true,
    alwaysOnTop: settings.pinned, show: false, backgroundColor: '#00000000',
    icon: path.join(ROOT, 'assets', 'branding', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // capturePage non funziona su una finestra nascosta: in QA la mostro senza rubare il focus.
  win.once('ready-to-show', () => (SCREENSHOT ? win.showInactive() : win.show()));

  const persist = () => {
    if (win.isDestroyed()) return;
    Object.assign(settings, win.getBounds());
    saveSettings();
  };
  win.on('moved', persist);
  win.on('resized', persist);

  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafe(url);
    return { action: 'deny' };
  });
  // La finestra mostra solo la pagina locale del widget: niente navigazione altrove.
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    log.warn('navigazione bloccata', String(url).slice(0, 80));
  });
}

ipcMain.handle('init', () => ({ theme: settings.theme, pinned: settings.pinned, days: config.days, demo: DEMO, hasGuide: !!docPath(GUIDE) }));
ipcMain.on('refresh', refresh);
ipcMain.on('log', (_e, level, msg) => log.browser(level, msg));
ipcMain.on('set-theme', (_e, theme) => { settings.theme = theme; saveSettings(); });
ipcMain.on('toggle-pin', () => setPinned(!settings.pinned));
ipcMain.on('hide', () => win.hide());
ipcMain.on('open-guide', () => openDoc(GUIDE));
ipcMain.on('open-external', (_e, url) => openSafe(url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && win.show());
  app.whenReady().then(async () => {
    log.info(`avvio v${app.getVersion()} demo=${DEMO} calendari=${config.urls.length} giorni=${config.days} refresh=${config.refreshMin}min`);
    createWindow();
    buildTray();
    // Ctrl+Alt+C da qualunque app mostra/nasconde il widget.
    globalShortcut.register('Control+Alt+C', () => (win.isVisible() ? win.hide() : (win.show(), win.focus())));
    win.webContents.once('did-finish-load', async () => {
      await refresh();
      if (SCREENSHOT) await screenshot();
    });
    setInterval(refresh, config.refreshMin * 60000);
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

// QA: salva uno screenshot numerato in tests/qa_screenshots/YYYY-MM-DD/.
async function screenshot() {
  await new Promise((r) => setTimeout(r, 800));
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOT, 'tests', 'qa_screenshots', day);
  fs.mkdirSync(dir, { recursive: true });
  const n = fs.readdirSync(dir).filter((f) => /^\d{3}-/.test(f)).length + 1;
  const slug = process.argv.find((a) => a.startsWith('--slug='))?.slice(7) || 'widget';
  for (const theme of ['dark', 'light']) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'`);
    await new Promise((r) => setTimeout(r, 200));
    const img = await win.webContents.capturePage();
    const file = path.join(dir, `${String(n + (theme === 'light' ? 1 : 0)).padStart(3, '0')}-${slug}-${theme}.png`);
    fs.writeFileSync(file, img.toPNG());
    log.info('screenshot', path.relative(ROOT, file));
  }
  app.quit();
}
