import { it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('runs the release route and candidate package contract', () => {
  try {
    execFileSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=tap',
        '--test-concurrency=1',
        'scripts/release-route.test.mjs',
        'scripts/publish-source.test.mjs',
        'scripts/publish-manifest.test.mjs',
        'scripts/publish-archive/archive.test.mjs',
        'scripts/publish-archive/route.test.mjs',
        'scripts/publish-archive/build.test.mjs',
        'scripts/publish-archive/wrapper.test.mjs',
        'scripts/release-route-git.test.mjs',
        'scripts/release-route-guards.test.mjs',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    // A failing contract must expose its TAP, not an opaque Buffer summary.
    const child = error as { stdout?: string; stderr?: string };
    if (typeof child.stdout === 'string') process.stderr.write(child.stdout);
    if (typeof child.stderr === 'string') process.stderr.write(child.stderr);
    throw error;
  }
}, 90_000);
