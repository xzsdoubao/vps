'use strict';

const crypto = require('crypto');
const logger = require('./logger');

/**
 * Validate UUID format (RFC 4122, any version).
 */
function isValidUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(uuid);
}

/**
 * Generate a new v4 UUID using Node.js crypto.
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Mask UUID for safe logging: keep first 4 and last 4 chars.
 */
function maskUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return '****';
  if (uuid.length <= 8) return '****';
  return `${uuid.slice(0, 4)}****${uuid.slice(-4)}`;
}

/**
 * Ensure UUID is valid. If missing/placeholder/invalid, generate a new one.
 * Returns { uuid, generated }.
 */
function ensureUUID(existing) {
  if (existing && existing !== '你的uuid' && existing !== 'your-uuid' && isValidUUID(existing)) {
    return { uuid: existing, generated: false };
  }
  logger.warn('UUID missing or invalid, generating a new one...');
  return { uuid: generateUUID(), generated: true };
}

/**
 * Build a VLESS share link.
 */
function buildVlessLink({ uuid, host, port, path, tls, sni, showFull }) {
  const displayUUID = showFull ? uuid : maskUUID(uuid);
  const security = tls ? 'tls' : 'none';
  let link = `vless://${showFull ? uuid : displayUUID}@${host}:${port}`;
  const params = [`encryption=none`, `security=${security}`, `type=ws`, `path=${encodeURIComponent(path)}`];
  if (tls && sni) {
    params.push(`sni=${sni}`, `host=${sni}`);
  }
  link += '?' + params.join('&');
  return link;
}

module.exports = { isValidUUID, generateUUID, maskUUID, ensureUUID, buildVlessLink };
