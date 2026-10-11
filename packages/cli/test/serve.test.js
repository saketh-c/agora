import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probePort } from '../src/serve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'agora.js');
const env = { ...process.env, NO_COLOR: '1', AGORA_PREFS: path.join(here, 'no-such-prefs.json') };
delete env.PORT;
delete env.AGORA_LANG;

/** Listen on a free port and resolve with the server and its port. */
function occupy() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function freePort() {
  const { server, port } = await occupy();
  await new Promise((r) => server.close(r));
  return port;
}

test('probePort tells a taken port from a free one', async () => {
  const { server, port } = await occupy();
  try {
    assert.equal(await probePort(port), 'EADDRINUSE');
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(await probePort(port), null);
});

test('serve on a busy port says so and exits 1 instead of claiming to listen', async () => {
  const { server, port } = await occupy();
  try {
    const r = spawnSync(process.execPath, [bin, 'serve', '--port', String(port)], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`Port ${port} is already in use`));
    assert.doesNotMatch(r.stdout, /listening/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('SIGTERM to the CLI stops the server it started', { skip: process.platform === 'win32' }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [bin, 'serve', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 20000);
      let seen = '';
      child.stdout.on('data', (d) => {
        seen += d;
        if (/listening/.test(seen)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', () => reject(new Error(`exited early: ${seen}`)));
    });
    assert.equal(await probePort(port), 'EADDRINUSE', 'the server is up');
    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 143, '128 + SIGTERM');
    // Give the OS a moment to release the socket, then the port must be free: no orphan.
    let free = 'unchecked';
    for (let i = 0; i < 20; i += 1) {
      free = await probePort(port);
      if (free === null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(free, null, 'the server child stopped with the CLI');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
