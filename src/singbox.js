'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function generateSingBoxConfig(cfg) {
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [{
      type: 'vless',
      tag: 'vless-in',
      listen: cfg.server.listen,
      listen_port: cfg.server.port,
      users: [{ uuid: cfg.vless.uuid }],
      transport: {
        type: 'ws',
        path: cfg.vless.path
      }
    }],
    outbounds: [{ type: 'direct', tag: 'direct' }]
  };
}

function writeSingBoxConfig(cfg) {
  ensureDirs();
  const configPath = path.join(CONFIG_DIR, 'sing-box.json');
  const config = generateSingBoxConfig(cfg);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  logger.info(`Sing-box config written to ${configPath}`);
  return configPath;
}

function validateConfig(singBoxPath, configPath) {
  try {
    execFileSync(singBoxPath, ['check', '-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
    logger.info('Sing-box config validation passed');
    return true;
  } catch (e) {
    logger.error(`Sing-box config validation failed: ${e.stderr ? e.stderr.toString() : e.message}`);
    return false;
  }
}

function start(singBoxPath, configPath, pm, cfg) {
  const listen = cfg ? cfg.server.listen : '127.0.0.1';
  const port = cfg ? cfg.server.port : '';
  logger.info(`Starting Sing-box on ${listen}:${port}...`);

  const child = spawn(singBoxPath, ['run', '-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) logger.debug(`[sing-box] ${line}`);
  });
  child.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) logger.debug(`[sing-box] ${line}`);
  });

  child.on('error', (e) => {
    logger.error(`Sing-box failed to start: ${e.message}`);
  });

  pm.register('sing-box', child);
  return child;
}

module.exports = { writeSingBoxConfig, validateConfig, start };
