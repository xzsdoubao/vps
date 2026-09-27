'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./logger');
const { verifySha256, findChecksum } = require('./checksum');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const TMP_DIR = path.join(__dirname, '..', 'tmp');

// Unified binary manifest: version -> platform -> { url, sha256 }
// All URLs point to official GitHub Releases only.
// No "latest". No auto-guessed URLs.
const BINARY_MANIFEST = {
  singBox: {
    '1.9.3': {
      'linux-amd64': {
        url: 'https://github.com/SagerNet/sing-box/releases/download/v1.9.3/sing-box-1.9.3-linux-amd64.tar.gz',
        sha256: '76be005265322f1e9600529cca8c247a09eb1f5454c926c4280bc392dafd2fb9'
      }
    }
  },
  cloudflared: {
    '2024.10.1': {
      'linux-amd64': {
        url: 'https://github.com/cloudflare/cloudflared/releases/download/2024.10.1/cloudflared-linux-amd64',
        sha256: null // will be fetched from official SHA256SUMS; if unavailable, abort
      }
    }
  }
};

function getManifestEntry(product, version) {
  const entry = BINARY_MANIFEST[product];
  if (!entry || !entry[version]) {
    throw new Error(`Unsupported binary version: ${product}@${version}. Check BINARY_MANIFEST.`);
  }
  const platform = 'linux-amd64';
  const plat = entry[version][platform];
  if (!plat) {
    throw new Error(`Unsupported platform ${platform} for ${product}@${version}.`);
  }
  return plat;
}

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

  const manifest = getManifestEntry('singBox', version);
  const filename = path.basename(manifest.url);

  logger.info(`Downloading sing-box v${version} from official GitHub...`);

  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(manifest.url, tmpFile);

  // SHA256 verification is mandatory; no fallback.
  if (!manifest.sha256) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    logger.error(`No trusted SHA256 in manifest for sing-box@${version}, aborting.`);
    process.exit(1);
  }
  if (!verifySha256(tmpFile, manifest.sha256)) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    logger.error('SHA256 verification failed for sing-box, aborting.');
    process.exit(1);
  }
  logger.info('Sing-box SHA256 verified OK');

  // Extract
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
 * SHA256 is fetched from official SHA256SUMS. If unavailable, abort (no fallback).
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

  const manifest = getManifestEntry('cloudflared', version);
  const filename = path.basename(manifest.url);
  const sumsUrl = `https://github.com/cloudflare/cloudflared/releases/download/${version}/SHA256SUMS`;

  logger.info(`Downloading cloudflared ${version} from official GitHub...`);

  // If manifest has a hardcoded sha256, use it.
  // Otherwise fetch from official SHA256SUMS. No fallback.
  let expectedHash = manifest.sha256;
  if (!expectedHash) {
    try {
      const sumsText = fetchText(sumsUrl);
      expectedHash = findChecksum(sumsText, filename);
    } catch (e) {
      logger.error(`Could not fetch SHA256SUMS for cloudflared: ${e.message}`);
      logger.error('Refusing to run cloudflared without verified checksum.');
      process.exit(1);
    }
  }
  if (!expectedHash) {
    logger.error(`SHA256 not found in SHA256SUMS for cloudflared-${version}-linux-amd64`);
    logger.error('Refusing to run cloudflared without verified checksum.');
    process.exit(1);
  }
  logger.info('Found expected SHA256 for cloudflared (official source)');

  const tmpFile = path.join(TMP_DIR, filename);
  downloadUrl(manifest.url, tmpFile);

  if (!verifySha256(tmpFile, expectedHash)) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    logger.error('SHA256 verification failed for cloudflared, aborting.');
    process.exit(1);
  }
  logger.info('cloudflared SHA256 verified OK');

  fs.copyFileSync(tmpFile, binPath);
  fs.chmodSync(binPath, 0o755);
  fs.unlinkSync(tmpFile);

  logger.info(`cloudflared ${version} ready`);
  return binPath;
}

module.exports = { ensureSingBox, ensureCloudflared, BIN_DIR, BINARY_MANIFEST };
