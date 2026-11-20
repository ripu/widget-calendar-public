// Rigenera i PNG di branding dagli SVG sorgente.
// Uso: npx electron scripts/render-branding.js [--root=<cartella>]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const rootArg = process.argv.find((a) => a.startsWith('--root='));
const ROOT = rootArg ? path.resolve(rootArg.slice(7)) : path.join(__dirname, '..');
const JOBS = [
  { src: 'cover.svg', out: 'cover.png', w: 1200, h: 630 },
  { src: 'assets/branding/logo.svg', out: 'assets/branding/icon.png', w: 256, h: 256 },
  { src: 'assets/branding/logo.svg', out: 'assets/branding/icon-512.png', w: 512, h: 512 },
];

// Rendering offscreen: una finestra nascosta non viene dipinta e capturePage fallisce.
function render(job) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: job.w, height: job.h, show: false, frame: false, transparent: true, useContentSize: true,
      webPreferences: { offscreen: true },
    });
    const timer = setTimeout(() => reject(new Error(`timeout ${job.out}`)), 15000);
    win.webContents.setFrameRate(10);
    let ready = false;
    win.webContents.on('did-finish-load', () => setTimeout(() => { ready = true; win.webContents.invalidate(); }, 300));
    win.webContents.on('paint', (_e, _dirty, image) => {
      if (!ready) return;
      ready = false;
      clearTimeout(timer);
      fs.writeFileSync(path.join(ROOT, job.out), image.resize({ width: job.w, height: job.h }).toPNG());
      console.log(`${job.out} ${job.w}x${job.h}`);
      win.destroy();
      resolve();
    });
    const svg = fs.readFileSync(path.join(ROOT, job.src), 'utf8');
    const html = `<html><body style="margin:0;background:transparent"><img style="width:${job.w}px;height:${job.h}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
    win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    win.webContents.invalidate();
  });
}

// Fra un job e l'altro non ci sono finestre aperte: senza questo l'app uscirebbe.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    for (const job of JOBS) await render(job);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  app.quit();
});
