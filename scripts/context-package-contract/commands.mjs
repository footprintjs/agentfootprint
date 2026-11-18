/** Fixed real command IO; callers cannot supply argv, code or environment. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function nativeCommands(sourceRoot, paired) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const environment = paired
    ? Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(PATH|SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR)$/i.test(key),
        ),
      )
    : { ...process.env, NODE_PATH: '' };
  function execute(command, args, cwd) {
    const options = { cwd, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 };
    if (!paired) return { stdout: execFileSync(command, args, options), stderr: '' };
    const result = spawnSync(command, args, { ...options, timeout: 60_000 });
    if (result.error || result.status !== 0 || result.signal) {
      const error =
        result.error ?? new Error(`Context command exited with status ${result.status}.`);
      Object.assign(error, {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      });
      throw error;
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }
  return Object.freeze({
    execute(id, { root, temporary }) {
      switch (id) {
        case 'source-cjs':
          return execute(
            process.execPath,
            [
              '--input-type=commonjs',
              '-e',
              "const c=require('contextfootprint'); if(c.participates(0)!==true)throw Error('source dependency did not load');",
            ],
            root,
          );
        case 'source-pack':
          return execute(
            npm,
            [
              'pack',
              '--offline',
              '--ignore-scripts',
              '--json',
              '--cache',
              join(temporary, 'pack-cache'),
              '--pack-destination',
              temporary,
            ],
            sourceRoot,
          );
        case 'packed-cjs':
        case 'packed-esm':
          return execute(
            process.execPath,
            [
              join(
                root,
                'node_modules',
                'agentfootprint',
                id === 'packed-cjs' ? '.context-smoke.cjs' : '.context-smoke.mjs',
              ),
            ],
            root,
          );
        case 'packed-types':
          return execute(
            process.execPath,
            [
              join(sourceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
              '--noEmit',
              '--strict',
              '--skipLibCheck',
              '--target',
              'ES2022',
              '--module',
              'NodeNext',
              '--moduleResolution',
              'NodeNext',
              '.context-types.mts',
              '.context-types.cts',
            ],
            join(root, 'node_modules', 'agentfootprint'),
          );
        default:
          assert.fail('Unknown context contract command.');
      }
    },
  });
}
