'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./logger');
const { verifySha256, findChecksum } = require('./checksum');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const TMP_DIR = path.join(__dirname, '..', 'tmp');

const SINGBOX_REPO = 'https://github.com/SagerNet/sing-box';
const CLOUDFLARED_REPO = 'https://github.com/cloudflare/cloudflared';

// Hardcoded SHA256 for known-good sing-box v1.9.3 linux-amd64 tarball.
// Source: official GitHub release (no checksums.txt published upstream).
// Verified 2026-09-27 by downloading and hashing.
const SINGBOX_EXPECTED_SHA256 = '76be005265322f1e9600529cca8c247a09eb1f5454c926c4280bc392dafd2fb9';

function ensureDirs() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function downloadUrl(url, destPath) {
  logger.debug(`Downloading ${url} -> ${destPath}`);
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
 */
function ensureSingBox(version) {
  ensureDirs();
  const binPath = path.join(BIN_DIR, 'sing-box');

  if (fs.existsSync(binPath)) {
    try {
      const out = execFileSync(binPath, ['version'], { encoding: 'utf8', timeout: 5000 });
      if (out.includes(version)) {
        logger.info(`Sing-box v${version} already present`);
        return binPath;
      }
      logger.warn('Sing-box version mismatch, re-downloading');
      fs.unlinkSync(binPath);
    } catch (_) {
      logger.warn('Existing sing-box broken, re-downloading');
      fs.unlinkSync(binPath);
    }
  }

  const filename = `sing-box-${version}-linux-amd64.tar.gz`;
  const tarballUrl = `${SINGBOX_REPO}/releases/download/v${version}/${filename}`;

  logger.info(`Downloading sing-box v${version} from official GitHub...`);

  // 1. Download tarball to temp
  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(tarballUrl, tmpFile);

  // 2. Verify SHA256 against hardcoded known-good hash
  if (!verifySha256(tmpFile, SINGBOX_EXPECTED_SHA256)) {
    fs.unlinkSync(tmpFile);
    logger.error('SHA256 verification failed for sing-box, aborting.');
    logger.error(`Expected: ${SINGBOX_EXPECTED_SHA256}`);
    process.exit(1);
  }
  logger.info('Sing-box SHA256 verified OK');

  // 3. Extract
  const extractDir = path.join(TMP_DIR, `sb-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tmpFile, '-C', extractDir]);
  const extracted = path.join(extractDir, `sing-box-${version}-linux-amd64`, 'sing-box');
  fs.copyFileSync(extracted, binPath);
  fs.chmodSync(binPath, 0o755);

  fs.unlinkSync(tmpFile);
  fs.rmSync(extractDir, { recursive: true, force: true });

  logger.info(`Sing-box v${version} ready`);
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
  const binUrl = `${CLOUDFLARED_REPO}/releases/download/${version}/${filename}`;
  const sumsUrl = `${CLOUDFLARED_REPO}/releases/download/${version}/SHA256SUMS`;

  logger.info(`Downloading cloudflared ${version} from official GitHub...`);

  // Try to fetch SHA256SUMS for verification
  let expectedHash = null;
  try {
    const sumsText = fetchText(sumsUrl);
    expectedHash = findChecksum(sumsText, filename);
    if (expectedHash) {
      logger.info('Found expected SHA256 in official SHA256SUMS');
    }
  } catch (_) {
    logger.warn('Could not fetch SHA256SUMS for cloudflared, skipping remote checksum verification');
  }

  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(binUrl, tmpFile);

  if (expectedHash) {
    if (!verifySha256(tmpFile, expectedHash)) {
      fs.unlinkSync(tmpFile);
      logger.error('SHA256 verification failed for cloudflared, aborting.');
      process.exit(1);
    }
    logger.info('cloudflared SHA256 verified OK');
  } else {
    logger.warn('cloudflared downloaded without remote checksum verification (SHA256SUMS unavailable)');
  }

  fs.copyFileSync(tmpFile, binPath);
  fs.chmodSync(binPath, 0o755);
  fs.unlinkSync(tmpFile);

  logger.info(`cloudflared ${version} ready`);
  return binPath;
}

module.exports = { ensureSingBox, ensureCloudflared, BIN_DIR };
