'use strict';

const net = require('net');
const { execFileSync } = require('child_process');
const logger = require('./logger');

/**
 * Check if a TCP port is available (not in use) on the given host.
 */
function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      server.close(() => resolve(false));
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Get public IP via official API. Returns null on failure.
 */
function getPublicIP() {
  const apis = [
    'https://api.ipify.org',
    'https://ifconfig.me',
    'https://icanhazip.com'
  ];
  for (const url of apis) {
    try {
      const ip = execFileSync('curl', ['-fsSL', '--max-time', '5', url], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.startsWith('0.') && !ip.startsWith('127.')) {
        return ip;
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

module.exports = { isPortAvailable, getPublicIP };
