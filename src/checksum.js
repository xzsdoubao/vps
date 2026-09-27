'use strict';

const crypto = require('crypto');
const fs = require('fs');
const logger = require('./logger');

/**
 * Verify SHA256 checksum of a file against an expected hash.
 * Returns true if match, false otherwise.
 */
function verifySha256(filePath, expectedHash) {
  try {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    hash.update(data);
    const actual = hash.digest('hex').toLowerCase();
    const expected = String(expectedHash).trim().toLowerCase();
    const ok = actual === expected;
    if (!ok) {
      logger.error(`SHA256 mismatch for ${filePath}`);
      logger.error(`  expected: ${expected}`);
      logger.error(`  actual:   ${actual}`);
    }
    return ok;
  } catch (e) {
    logger.error(`SHA256 verification failed: ${e.message}`);
    return false;
  }
}

/**
 * Parse a checksums-style text and find the expected hash for a given filename.
 * Accepts formats:
 *   "<hash>  <filename>"
 *   "<hash> *<filename>"
 *   "<hash> <filename>"
 */
function findChecksum(checksumsText, filename) {
  const lines = checksumsText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const hash = parts[0].toLowerCase();
    const name = parts.slice(1).join(' ').replace(/^\*/, '');
    // Match by suffix to handle leading directory paths
    if (name === filename || name.endsWith('/' + filename)) {
      return hash;
    }
  }
  return null;
}

module.exports = { verifySha256, findChecksum };
