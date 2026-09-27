'use strict';

const logger = require('./logger');

class ProcessManager {
  constructor() {
    this.processes = new Map(); // name -> ChildProcess
    this.shuttingDown = false;
  }

  register(name, child) {
    this.processes.set(name, child);
    child.on('exit', (code, signal) => {
      logger.debug(`[${name}] exited code=${code} signal=${signal}`);
      this.processes.delete(name);
    });
  }

  get(name) {
    return this.processes.get(name);
  }

  isRunning(name) {
    const p = this.processes.get(name);
    return p && !p.killed && p.exitCode === null;
  }

  stop(name, signal = 'SIGTERM', timeoutMs = 5000) {
    return new Promise((resolve) => {
      const p = this.processes.get(name);
      if (!p || p.killed) return resolve();

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      p.once('exit', finish);
      try {
        p.kill(signal);
      } catch (_) { /* ignore */ }

      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch (_) {}
        finish();
      }, timeoutMs);
    });
  }

  async stopAll() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    logger.info('Stopping all child processes...');
    for (const name of [...this.processes.keys()]) {
      await this.stop(name);
    }
    logger.info('All child processes stopped.');
  }

  attachSignals() {
    const handler = async (sig) => {
      logger.info(`Received ${sig}, shutting down...`);
      await this.stopAll();
      process.exit(0);
    };
    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
  }
}

module.exports = { ProcessManager };
