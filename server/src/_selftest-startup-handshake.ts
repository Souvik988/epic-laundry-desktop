import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'epic-startup-handshake-'));
const secret = randomBytes(32).toString('base64url');
const nonce = randomBytes(24).toString('base64url');
let child: ChildProcess | undefined;

try {
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', EPIC_WORKSPACE_MODE: 'production', EPIC_STARTUP_SECRET: secret, EPIC_STARTUP_NONCE: nonce, EPIC_DB_FILE: join(directory, 'epic.sqlite'), EPIC_LEGACY_JSON_FILE: join(directory, 'epic.json') },
  });
  const ready = await new Promise<{ port: number; nonce: string; proof: string }>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('authenticated startup line was not emitted')), 5000);
    child!.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const line = output.split(/\r?\n/).find((item) => item.startsWith('EPIC_READY '));
      if (!line) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(line.slice('EPIC_READY '.length))); } catch (error) { reject(error); }
    });
    child!.stderr?.on('data', (chunk: Buffer) => reject(new Error(chunk.toString('utf8'))));
  });
  assert.ok(Number.isInteger(ready.port) && ready.port >= 1024, 'backend reports its assigned loopback port');
  assert.equal(ready.nonce, nonce, 'backend echoes the parent nonce');
  assert.equal(ready.proof, createHmac('sha256', secret).update(`${nonce}:${ready.port}`).digest('hex'), 'backend startup proof authenticates the nonce and actual port');
  const health = await fetch(`http://127.0.0.1:${ready.port}/api/health`);
  assert.equal(health.status, 200, 'authenticated port serves the local health endpoint');
  console.log('PASS authenticated random-port startup handshake self-test complete');
} finally {
  if (child && !child.killed) child.kill();
  await new Promise((resolve) => child?.once('exit', resolve) || resolve(undefined));
  rmSync(directory, { recursive: true, force: true });
}
