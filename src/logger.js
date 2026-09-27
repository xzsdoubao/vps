'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
let currentLevel = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || LEVELS.INFO;

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) { /* ignore */ }
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size >= MAX_FILE_SIZE) {
        const bak = LOG_FILE.replace(/\.log$/, `-${Date.now()}.log`);
        fs.renameSync(LOG_FILE, bak);
      }
    }
  } catch (_) { /* ignore */ }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function write(level, msg) {
  if (LEVELS[level] < currentLevel) return;
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) { /* console already printed */ }
}

module.exports = {
  debug: (m) => write('DEBUG', m),
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
};
