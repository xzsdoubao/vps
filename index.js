'use strict';

const logger = require('./src/logger');
const { loadConfig, saveConfig } = require('./src/config');
const { ensureUUID, maskUUID, buildVlessLink } = require('./src/security');
const { isPortAvailable, getPublicIP } = require('./src/network');
const { ensureSingBox, ensureCloudflared } = require('./src/downloader');
const { ProcessManager } = require('./src/processManager');
const sb = require('./src/singbox');
const cf = require('./src/cloudflared');

async function shutdownWithError(pm, msg, exitCode = 1) {
  logger.error(msg);
  try {
    await pm.stopAll();
  } catch (_) { /* ignore */ }
  process.exit(exitCode);
}

async function main() {
  logger.info('=== Secure VLESS Node v2.0 starting ===');

  // 1. Node.js version check
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    logger.error(`Node.js >= 18 required, current: ${process.versions.node}`);
    process.exit(1);
  }
  logger.info(`Node.js ${process.versions.node} OK`);

  // 2. Load config
  const cfg = loadConfig();
  logger.info(`Listen: ${cfg.server.listen}:${cfg.server.port}`);
  logger.info(`Direct mode: ${cfg.security.enableDirect ? 'ENABLED' : 'disabled (tunnel mode)'}`);

  // 3. UUID
  const { uuid, generated } = ensureUUID(cfg.vless.uuid);
  cfg.vless.uuid = uuid;
  if (generated) {
    logger.info(`Generated new UUID: ${maskUUID(uuid)}`);
    saveConfig(cfg);
  } else {
    logger.info(`UUID: ${maskUUID(uuid)}`);
  }

  // 4. Port check
  const available = await isPortAvailable(cfg.server.listen, cfg.server.port);
  if (!available) {
    logger.error(`Port ${cfg.server.port} on ${cfg.server.listen} is already in use. Aborting.`);
    process.exit(1);
  }
  logger.info(`Port ${cfg.server.port} is available`);

  // 5. Download/verify binaries
  const singBoxPath = ensureSingBox(cfg.versions.singBox);
  const cloudflaredPath = ensureCloudflared(cfg.versions.cloudflared);

  // 6. Generate and validate sing-box config
  const sbConfigPath = sb.writeSingBoxConfig(cfg);
  if (!sb.validateConfig(singBoxPath, sbConfigPath)) {
    logger.error('Sing-box config validation failed, aborting.');
    process.exit(1);
  }

  // 7. Start process manager
  const pm = new ProcessManager();
  pm.attachSignals();

  // 8. Start sing-box
  sb.start(singBoxPath, sbConfigPath, pm, cfg);

  // Wait a moment for sing-box to bind
  await new Promise((r) => setTimeout(r, 2000));

  if (!pm.isRunning('sing-box')) {
    await shutdownWithError(pm, 'Sing-box failed to stay running.');
  }
  logger.info('Sing-box is running');

  // 9. Start cloudflared tunnel
  let tunnelHost = null;
  try {
    tunnelHost = await cf.startTunnel(cloudflaredPath, cfg.server.port, pm, (newHost) => {
      // Tunnel changed after a restart - log the new node link
      logger.info(`Tunnel re-established: ${newHost}`);
      const newLink = buildVlessLink({
        uuid, host: newHost, port: 443,
        path: cfg.vless.path, tls: true, sni: newHost,
        showFull: cfg.security.showFullLink
      });
      logger.info(`[CF Tunnel] ${newLink}`);
    });
  } catch (e) {
    logger.error(`Cloudflare Tunnel failed: ${e.message}`);
    // In tunnel mode (enableDirect=false), tunnel failure means service is unusable.
    // Must shut down sing-box and exit.
    if (!cfg.security.enableDirect) {
      await shutdownWithError(pm, 'Tunnel mode: Cloudflare Tunnel failed and cannot recover. Shutting down.');
    }
  }

  // 10. Output node info (masked)
  const publicIP = getPublicIP();
  logger.info('--- Node information (UUID masked) ---');

  if (tunnelHost) {
    const tunnelLink = buildVlessLink({
      uuid, host: tunnelHost, port: 443,
      path: cfg.vless.path, tls: true, sni: tunnelHost,
      showFull: cfg.security.showFullLink
    });
    logger.info(`[CF Tunnel] ${tunnelLink}`);
  }

  if (cfg.security.enableDirect && publicIP) {
    const directLink = buildVlessLink({
      uuid, host: publicIP, port: cfg.server.port,
      path: cfg.vless.path, tls: false, showFull: cfg.security.showFullLink
    });
    logger.warn(`[Direct]    ${directLink}`);
    logger.warn('Direct node uses UNENCRYPTED WebSocket. Use CF Tunnel for safety.');
  }

  if (cfg.security.showFullLink) {
    logger.info('SHOW_FULL_LINK=true: full link printed above.');
  } else {
    logger.info('Set SHOW_FULL_LINK=true in env to print full unmasked link.');
  }

  // 11. Monitor sing-box: if it dies, shut everything down (no zombie proxy)
  const sbChild = pm.get('sing-box');
  if (sbChild) {
    sbChild.on('exit', async (code, signal) => {
      if (pm.shuttingDown) return;
      logger.error(`Sing-box exited code=${code} signal=${signal}. Shutting down.`);
      await shutdownWithError(pm, 'Sing-box died, no zombie process allowed.');
    });
  }

  logger.info('=== Startup complete ===');
}

// Global error handling
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack || '');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

main().catch((e) => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
