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

/**
 * Start Cloudflare Quick Tunnel with auto-restart.
 *
 * Resolves with the first tunnel host once established.
 * If cloudflared crashes later, it auto-restarts with exponential backoff.
 * When a new tunnel URL appears after a restart, onTunnelChange(newHost) is called.
 *
 * If max restarts exceeded, rejects. Caller should shut down sing-box and exit.
 */
function startTunnel(cloudflaredPath, port, pm, onTunnelChange) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let currentHost = null;
    let restartCount = 0;
    let restartTimer = null;

    const clearTimer = () => {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
    };

    const doRun = () => {
      if (pm.shuttingDown) {
        logger.info('Shutting down, not restarting cloudflared.');
        return;
      }

      logger.info(`Starting Cloudflare Quick Tunnel (attempt ${restartCount + 1})...`);

      const child = spawn(cloudflaredPath, [
        'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      pm.register('cloudflared', child);

      const onData = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          const host = match[0].replace('https://', '');
          if (host !== currentHost) {
            currentHost = host;
            logger.info(`Cloudflare Tunnel: ${host}`);
            if (!resolved) {
              resolved = true;
              resolve(host);
            } else if (typeof onTunnelChange === 'function') {
              onTunnelChange(host);
            }
          }
        }
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

      child.on('error', (e) => {
        logger.error(`cloudflared spawn error: ${e.message}`);
      });

      child.on('exit', (code, signal) => {
        if (pm.shuttingDown) return;

        logger.warn(`cloudflared exited code=${code} signal=${signal}`);

        if (restartCount >= MAX_RESTARTS) {
          logger.error(`cloudflared exceeded max restarts (${MAX_RESTARTS}), giving up.`);
          if (!resolved) {
            reject(new Error('cloudflared max restarts exceeded before tunnel established'));
          } else {
            // Tunnel was established but now cloudflared is dead.
            // Caller must decide: stop everything.
            reject(new Error('cloudflared died after tunnel established and could not recover'));
          }
          return;
        }

        restartCount++;
        const wait = backoffDelay(restartCount - 1);
        logger.warn(`Restarting cloudflared in ${wait / 1000}s (attempt ${restartCount + 1}/${MAX_RESTARTS})...`);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          doRun();
        }, wait);
      });
    };

    doRun();
  });
}

module.exports = { startTunnel };
