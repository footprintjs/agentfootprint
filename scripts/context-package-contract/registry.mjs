/** The original registry control adapter; never selected by the paired facade. */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const installOptions = [
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  '--registry',
  'https://registry.npmjs.org',
];

export function registryInstallers() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  function execute(args, root) {
    execFileSync(npm, args, {
      cwd: root,
      env: { ...process.env, NODE_PATH: '' },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  return {
    async installSourceRoot(request) {
      await writeFile(join(request.rootRealPath, 'package.json'), request.originalManifestText);
      await writeFile(join(request.rootRealPath, 'package-lock.json'), request.originalLockText);
      execute(
        [
          'ci',
          '--omit=dev',
          ...installOptions,
          ...(request.policy.offline ? ['--offline'] : []),
          '--cache',
          request.cache.realPath,
        ],
        request.rootRealPath,
      );
    },
    async installPackedConsumer(request) {
      await writeFile(
        join(request.rootRealPath, 'package.json'),
        JSON.stringify({ name: 'context-package-smoke', private: true, type: 'module' }),
      );
      execute(
        [
          'install',
          ...installOptions,
          ...(request.policy.offline ? ['--offline'] : []),
          '--cache',
          request.cache.realPath,
          request.contextArtifact.path,
        ],
        request.rootRealPath,
      );
    },
  };
}
