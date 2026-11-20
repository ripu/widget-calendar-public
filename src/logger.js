// Log giornaliero in log/YYYY-MM-DD.txt. I log del renderer
// arrivano via IPC e sono scritti con prefisso [BROWSER:LEVEL].
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'log');

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function write(tag, args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} [${tag}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `${today()}.txt`), line + '\n');
  } catch (e) {
    console.error('log write failed', e.message);
  }
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  browser: (level, msg) => write(`BROWSER:${String(level).toUpperCase()}`, [msg]),
};
