import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { t } from '@agora/core';
import { REPO_ROOT } from '@agora/core/node';
import { intFlag } from './args.js';
import { c } from './ui.js';

export const DEFAULT_PORT = 8787;

/** Signals that should stop the server along with the CLI. */
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Resolve to null when `port` can be listened on, or to the error code (EADDRINUSE, EACCES)
 * when it cannot. It binds the same way the server does (every interface), then lets go.
 */
export function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (e) => resolve(e.code || 'ERROR'));
    try {
      server.listen(port, () => server.close(() => resolve(null)));
    } catch (e) {
      resolve(e.code || 'ERROR');
    }
  });
}

/** PORT from the environment when it is a usable port number, else the default. */
function envPort() {
  const n = Number(process.env.PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
}

/**
 * `agora serve`: run the API and web server as a child process.
 *
 * The port is checked first, because the server prints "listening" even when the port is
 * taken and then exits, which looked like success. While the child runs, SIGINT, SIGTERM
 * and SIGHUP sent to the CLI are passed on to it: before, a process manager or `kill` that
 * stopped only the CLI left the server running with no parent. The exit code follows the
 * child, using 128 + signal number when a signal stopped it.
 * @returns {Promise<number>} exit code
 */
export async function serve(flags, io = console, { entry = path.join(REPO_ROOT, 'packages', 'server', 'src', 'index.js') } = {}) {
  const port = intFlag(flags, 'port', { min: 1, max: 65535, fallback: envPort() });
  const problem = await probePort(port);
  if (problem) {
    io.error(c.red(problem === 'EADDRINUSE' ? t('cli.serve.portBusy', { port }) : t('cli.serve.portUnavailable', { port, error: problem })));
    return 1;
  }

  const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  for (const signal of FORWARDED) process.on(signal, forward);

  try {
    return await new Promise((resolve) => {
      let failed = false;
      child.on('error', (e) => {
        if (failed) return;
        failed = true;
        io.error(c.red(t('cli.serve.couldNotStart', { error: e.message })));
        resolve(1);
      });
      child.once('exit', (code, signal) => {
        if (signal) resolve(128 + (os.constants.signals[signal] || 0));
        else resolve(code || 0);
      });
    });
  } finally {
    for (const signal of FORWARDED) process.removeListener(signal, forward);
  }
}
