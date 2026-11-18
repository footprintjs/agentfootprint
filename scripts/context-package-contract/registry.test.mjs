/** Registry adapter IO parity only; no npm installation is executed. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { registryInstallers } from './registry.mjs';

test('the registry control preserves all four original install arguments and source bytes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'context-registry-unit-'));
  const calls = [];
  mock.method(childProcess, 'execFileSync', (command, args, options) => {
    calls.push({ command, args, options });
    return '';
  });
  syncBuiltinESMExports();
  try {
    const ports = registryInstallers();
    const originalManifestText = '{"name":"agentfootprint","private":true}\r\n';
    const originalLockText = '{"lockfileVersion":3}\r\n';
    const archive = join(parent, 'source-context.tgz');
    for (const family of ['source', 'consumer']) {
      for (const offline of [false, true]) {
        const root = join(parent, `${family}-${offline ? 'offline' : 'online'}`);
        await mkdir(root);
        const request = {
          rootRealPath: root,
          originalManifestText,
          originalLockText,
          policy: { offline },
          cache: { realPath: join(parent, `${family}-cache`) },
          contextArtifact: { path: archive },
        };
        if (family === 'source') {
          await ports.installSourceRoot(request);
          assert.equal(await readFile(join(root, 'package.json'), 'utf8'), originalManifestText);
          assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), originalLockText);
        } else {
          await ports.installPackedConsumer(request);
          assert.equal(
            await readFile(join(root, 'package.json'), 'utf8'),
            JSON.stringify({ name: 'context-package-smoke', private: true, type: 'module' }),
          );
        }
        const call = calls.at(-1);
        assert.equal(call.command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
        assert.deepEqual(call.args, [
          ...(family === 'source' ? ['ci', '--omit=dev'] : ['install']),
          '--ignore-scripts',
          '--legacy-peer-deps',
          '--no-audit',
          '--no-fund',
          '--registry',
          'https://registry.npmjs.org',
          ...(offline ? ['--offline'] : []),
          '--cache',
          request.cache.realPath,
          ...(family === 'consumer' ? [archive] : []),
        ]);
        assert.equal(call.options.cwd, root);
        assert.equal(call.options.env.NODE_PATH, '');
        assert.equal(call.options.encoding, 'utf8');
        assert.equal(call.options.maxBuffer, 16 * 1024 * 1024);
      }
    }
    assert.equal(calls.length, 4);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await rm(parent, { recursive: true, force: true });
  }
});
