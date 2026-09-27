'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const logger = require('./logger');
const { verifySha256, findChecksum } = require('./checksum');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const TMP_DIR = path.join(__dirname, '..', 'tmp');

const SINGBOX_REPO = 'https://github.com/SagerNet/sing-box';
const CLOUDFLARED_REPO = 'https://github.com/cloudflare/cloudflared';

function ensureDirs() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function downloadUrl(url, destPath) {
  logger.debug(`Downloading ${url} -> ${destPath}`);
  // Use curl for reliable download (present on the host image)
  execFileSync('curl', [
    '-fsSL', '--retry', '2', '--max-time', '120',
    '-o', destPath, url
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function fetchText(url) {
  logger.debug(`Fetching text: ${url}`);
  return execFileSync('curl', ['-fsSL', '--max-time', '30', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/**
 * Download and verify sing-box binary.
 * Returns the path to the verified binary, or exits on failure.
 */
function ensureSingBox(version) {
  ensureDirs();
  const binPath = path.join(BIN_DIR, 'sing-box');

  // If already exists, verify it runs and matches version
  if (fs.existsSync(binPath)) {
    try {
      const out = execFileSync(binPath, ['version'], { encoding: 'utf8', timeout: 5000 });
      if (out.includes(version)) {
        logger.info(`Sing-box v${version} already present`);
        return binPath;
      }
      logger.warn(`Sing-box version mismatch, re-downloading`);
      fs.unlinkSync(binPath);
    } catch (_) {
      logger.warn('Existing sing-box binary broken, re-downloading');
      fs.unlinkSync(binPath);
    }
  }

  const filename = `sing-box-${version}-linux-amd64.tar.gz`;
  const downloadUrl = `${SINGBOX_REPO}/releases/download/v${version}/${filename}`;
  const checksumsUrl = `${SINGBOX_REPO}/releases/download/v${version}/checksums.txt`;

  logger.info(`Downloading sing-box v${version} from official GitHub...`);

  // 1. Download checksums file
  const checksumsText = fetchText(checksumsUrl);
  const expectedHash = findChecksum(checksumsText, filename);
  if (!expectedHash) {
    logger.error('Could not find expected checksum in official checksums.txt');
    process.exit(1);
  }

  // 2. Download tarball to temp
  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(downloadUrl, tmpFile);

  // 3. Verify SHA256
  if (!verifySha256(tmpFile, expectedHash)) {
    fs.unlinkSync(tmpFile);
    logger.error('SHA256 verification failed for sing-box, aborting.');
    process.exit(1);
  }
  logger.info('Sing-box SHA256 verified OK');

  // 4. Extract
  const extractDir = path.join(TMP_DIR, `sb-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tmpFile, '-C', extractDir]);
  const extracted = path.join(extractDir, `sing-box-${version}-linux-amd64`, 'sing-box');
  fs.copyFileSync(extracted, binPath);
  fs.chmodSync(binPath, 0o755);

  // Cleanup
  fs.unlinkSync(tmpFile);
  fs.rmSync(extractDir, { recursive: true, force: true });

  logger.info(`Sing-box v${version} ready at ${binPath}`);
  return binPath;
}

/**
 * Download and verify cloudflared binary.
 */
function ensureCloudflared(version) {
  ensureDirs();
  const binPath = path.join(BIN_DIR, 'cloudflared');

  if (fs.existsSync(binPath)) {
    try {
      const out = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (out.includes(version)) {
        logger.info(`cloudflared ${version} already present`);
        return binPath;
      }
      logger.warn('cloudflared version mismatch, re-downloading');
      fs.unlinkSync(binPath);
    } catch (_) {
      logger.warn('Existing cloudflared broken, re-downloading');
      fs.unlinkSync(binPath);
    }
  }

  const filename = 'cloudflared-linux-amd64';
  const downloadUrl = `${CLOUDFLARED_REPO}/releases/download/${version}/${filename}`;
  const checksumsUrl = `${CLOUDFLARED_REPO}/releases/download/${version}/SHA256SUMS`;

  logger.info(`Downloading cloudflared ${version} from official GitHub...`);

  const checksumsText = fetchText(checksumsUrl);
  const expectedHash = findChecksum(checksumsText, filename);
  if (!expectedHash) {
    logger.error('Could not find expected checksum in SHA256SUMS');
    process.exit(1);
  }

  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(downloadUrl, tmpFile);

  if (!verifySha256(tmpFile, expectedHash)) {
    fs.unlinkSync(tmpFile);
    logger.error('SHA256 verification failed for cloudflared, aborting.');
    process.exit(1);
  }
  logger.info('cloudflared SHA256 verified OK');

  fs.copyFileSync(tmpFile, binPath);
  fs.chmodSync(binPath, 0o755);
  fs.unlinkSync(tmpFile);

  logger.info(`cloudflared ${version} ready at ${binPath}`);
  return binPath;
}

module.exports = { ensureSingBox, ensureCloudflared, BIN_DIR };
