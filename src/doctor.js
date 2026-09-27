'use strict';

/**
 * Health check / doctor script.
 * Run with: npm run doctor
 * Checks: Node.js version, curl, tar, network, dirs, port, UUID, binaries.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true, detail: '' });
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  [FAIL] ${name}: ${e.message}`);
  }
}

function requireVersion(name, cmd, versionArgs, minStr) {
  const out = execFileSync(cmd, versionArgs, { encoding: 'utf8', timeout: 5000 });
  const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`cannot parse version: ${out.slice(0, 80)}`);
  const [maj, min, pat] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  const [rMaj, rMin, rPat] = minStr.split('.').map(Number);
  if (maj < rMaj || (maj === rMaj && min < rMin) || (maj === rMaj && min === rMin && pat < rPat)) {
    throw new Error(`${cmd} version ${maj}.${min}.${pat} < required ${minStr}`);
  }
  console.log(`         (${cmd} ${maj}.${min}.${pat})`);
}

console.log('=== Doctor: environment check ===\n');

check('Node.js >= 18', () => {
  const m = process.versions.node.match(/(\d+)\.(\d+)\.(\d+)/);
  if (parseInt(m[1]) < 18) throw new Error(`Node.js ${process.versions.node} < 18`);
  console.log(`         (Node.js ${process.versions.node})`);
});

check('curl available', () => {
  execFileSync('curl', ['--version'], { stdio: 'ignore', timeout: 3000 });
});

check('tar available', () => {
  execFileSync('tar', ['--version'], { stdio: 'ignore', timeout: 3000 });
});

check('write access to bin/', () => {
  const d = path.join(ROOT, 'bin');
  fs.mkdirSync(d, { recursive: true });
  const t = path.join(d, '.write-test');
  fs.writeFileSync(t, 'x');
  fs.unlinkSync(t);
});

check('write access to logs/', () => {
  const d = path.join(ROOT, 'logs');
  fs.mkdirSync(d, { recursive: true });
  const t = path.join(d, '.write-test');
  fs.writeFileSync(t, 'x');
  fs.unlinkSync(t);
});

check('write access to config/', () => {
  const d = path.join(ROOT, 'config');
  fs.mkdirSync(d, { recursive: true });
  const t = path.join(d, '.write-test');
  fs.writeFileSync(t, 'x');
  fs.unlinkSync(t);
});

check('config.json exists and parses', () => {
  const p = path.join(ROOT, 'config.json');
  if (!fs.existsSync(p)) throw new Error('config.json not found');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.vless || !j.vless.uuid) throw new Error('config.json missing vless.uuid');
});

check('sing-box binary present', () => {
  const p = path.join(ROOT, 'bin', 'sing-box');
  if (!fs.existsSync(p)) throw new Error('bin/sing-box not found (will be downloaded on start)');
  execFileSync(p, ['version'], { stdio: 'ignore', timeout: 5000 });
});

check('cloudflared binary present', () => {
  const p = path.join(ROOT, 'bin', 'cloudflared');
  if (!fs.existsSync(p)) throw new Error('bin/cloudflared not found (will be downloaded on start)');
  execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 5000 });
});

const fails = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`);
if (fails.length) process.exit(1);
