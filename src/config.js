'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  server: { port: 3000, listen: '127.0.0.1' },
  vless: { uuid: '', path: '/vless-ws' },
  security: { enableDirect: false, showFullLink: false },
  versions: { singBox: '1.9.3', cloudflared: '2024.10.1' },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) &&
        base[key] && typeof base[key] === 'object') {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

function loadConfig() {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    logger.warn(`config.json parse failed: ${e.message}, using defaults`);
  }

  const cfg = deepMerge(DEFAULTS, fileConfig);

  // Env overrides
  if (process.env.VLESS_UUID) cfg.vless.uuid = process.env.VLESS_UUID;
  if (process.env.SERVER_PORT) cfg.server.port = parseInt(process.env.SERVER_PORT, 10);
  if (process.env.PORT) cfg.server.port = parseInt(process.env.PORT, 10);
  if (process.env.ENABLE_DIRECT === 'true') cfg.security.enableDirect = true;
  if (process.env.SHOW_FULL_LINK === 'true') cfg.security.showFullLink = true;

  // Validate port
  if (!Number.isInteger(cfg.server.port) || cfg.server.port < 1 || cfg.server.port > 65535) {
    throw new Error(`Invalid port: ${cfg.server.port} (must be 1-65535)`);
  }

  // Normalize listen address
  if (cfg.security.enableDirect) {
    cfg.server.listen = '0.0.0.0';
    logger.warn('========================================');
    logger.warn('  DIRECT MODE ENABLED');
    logger.warn('  Sing-box will listen on 0.0.0.0 (public).');
    logger.warn('  VLESS traffic is UNENCRYPTED WebSocket.');
    logger.warn('  This may be intercepted or blocked.');
    logger.warn('  Use Cloudflare Tunnel mode for security.');
    logger.warn('========================================');
  } else {
    cfg.server.listen = '127.0.0.1';
  }

  return cfg;
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {
    logger.error(`Failed to save config: ${e.message}`);
  }
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
