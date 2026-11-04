import { it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('runs the native R0-small release-route and RC package contract', () => {
  execFileSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      'scripts/release-route.test.mjs',
      'scripts/release-route-git.test.mjs',
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: 'pipe',
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
}, 90_000);
