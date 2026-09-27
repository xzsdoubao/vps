'use strict';

const { spawn } = require('child_process');
const logger = require('./logger');

const MAX_RESTARTS = 5;
const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt) {
  const d = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(d, MAX_DELAY_MS);
}

function startTunnel(cloudflaredPath, port, pm) {
  return new Promise((resolve, reject) => {
    let tunnelUrl = null;
    let restarts = 0;

    const run = () => {
      if (restarts >= MAX_RESTARTS) {
        logger.error(`cloudflared exceeded max restarts (${MAX_RESTARTS}), giving up`);
        return reject(new Error('cloudflared max restarts exceeded'));
      }

      if (restarts > 0) {
        const wait = backoffDelay(restarts - 1);
        logger.warn(`Restarting cloudflared in ${wait / 1000}s (attempt ${restarts + 1}/${MAX_RESTARTS})...`);
        setTimeout(() => doRun(), wait);
        return;
      }
      doRun();
    };

    const doRun = () => {
      logger.info('Starting Cloudflare Quick Tunnel...');

      const child = spawn(cloudflaredPath, [
        'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      pm.register('cloudflared', child);

      const onData = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !tunnelUrl) {
          tunnelUrl = match[0].replace('https://', '');
          logger.info(`Cloudflare Tunnel established: ${tunnelUrl}`);
          resolve(tunnelUrl);
        }
        // Log important lines
        const lines = text.split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (t && /error|fail|registered|connection/i.test(t)) {
            logger.debug(`[cloudflared] ${t}`);
          }
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('exit', (code) => {
        logger.warn(`cloudflared exited with code ${code}`);
        restarts++;
        if (!tunnelUrl) {
          run();
        }
        // If tunnel was established and later exits, let pm handle shutdown
      });
    };

    run();
  });
}

module.exports = { startTunnel };
