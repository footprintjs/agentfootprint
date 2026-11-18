/** Only this downloader receives the existing job token. No credential fallback. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiOperation, inputFailure } from './failures.mjs';

export function githubInputReader() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'docs-input-hosted-downloader-only');
  assert.equal(process.env.GITHUB_REPOSITORY, 'footprintjs/agentfootprint',
    'docs-input-hosted-repository');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  assert(typeof token === 'string' && token.length > 0, 'docs-input-job-token-required');
  const config = mkdtempSync(join(tmpdir(), 'af-docs-input-gh-'));
  const env = Object.fromEntries(['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL']
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(env, { GH_TOKEN: token, GH_HOST: 'github.com', GH_CONFIG_DIR: config,
    XDG_STATE_HOME: join(config, 'state'), XDG_CACHE_HOME: join(config, 'cache'),
    XDG_DATA_HOME: join(config, 'data'),
    GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' });
  return {
    get(path, limit = 2 * 1024 * 1024) {
      const operation = apiOperation(path);
      const result = spawnSync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', path],
        { env, cwd: config, timeout: 45_000, maxBuffer: limit });
      // Provider output can contain authentication details. Never include it in errors.
      if (result.error || result.status !== 0 || result.signal !== null) {
        const status = /\bHTTP\s+([45]\d\d)\b/.exec(String(result.stderr))?.[1];
        throw inputFailure(new Error('docs-input-api-read-refused'), operation, status && Number(status));
      }
      if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0 || result.stdout.length > limit) {
        throw inputFailure(new Error('docs-input-api-response-bound'), operation);
      }
      return result.stdout;
    },
    close() { rmSync(config, { recursive: true, force: true }); },
  };
}
