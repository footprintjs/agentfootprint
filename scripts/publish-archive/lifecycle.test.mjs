import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const command = /^          (npm pack .*?) > "\$RUNNER_TEMP\/af-pack-result.json"$/m.exec(
  workflow,
)?.[1];
assert(command && command.includes(' --ignore-scripts '));
const npmCli = process.env.NPM_CLI || process.env.npm_execpath;
assert(npmCli, 'current npm_execpath or explicit retained NPM_CLI is required');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";

test('native pack suppresses hostile prepare on npm 11 and newer; the script remains active without the flag', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-prepare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    npm_config_cache: path.join(root, 'cache'),
    npm_config_userconfig: path.join(root, 'user.npmrc'),
    npm_config_globalconfig: path.join(root, 'global.npmrc'),
  };
  for (const name of ['user.npmrc', 'global.npmrc']) writeFileSync(path.join(root, name), '');
  const version = spawnSync(process.execPath, [npmCli, '--version'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(version.error, undefined);
  assert.equal(version.signal, null);
  assert.equal(version.status, 0, version.stderr);
  const major = Number(version.stdout.trim().split('.')[0]);
  assert(Number.isSafeInteger(major) && major >= 10);
  for (const ignore of [true, false]) {
    const directory = path.join(root, ignore ? 'ignored' : 'active'),
      archive = path.join(directory, 'archive');
    mkdirSync(directory);
    mkdirSync(archive);
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'inert-prepare-control',
        version: '1.0.0',
        files: ['index.js'],
        scripts: {
          prepare:
            "node -e \"require('node:fs').writeFileSync('PREPARE_RAN','inert');process.exit(91)\"",
        },
      }),
    );
    writeFileSync(path.join(directory, 'index.js'), 'exports.inert = true;\n');
    const native = ignore ? command : command.replace(' --ignore-scripts', '');
    assert.notEqual(native.includes(' --ignore-scripts'), !ignore);
    const script = native
      .replace(/^npm /, quote(process.execPath) + ' ' + quote(npmCli) + ' ')
      .replace(' --json ', ' --offline --json ');
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', script], {
      cwd: directory,
      env: { ...env, ARCHIVE_DIR: archive },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    // npm10's prepare exception is an observed old-toolchain branch. Production
    // is separately pinned to 11.19.0; it must never inherit npm10's assumption.
    const executes = !ignore || major < 11;
    assert.equal(result.status, executes ? 91 : 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(directory, 'PREPARE_RAN')), executes);
  }
});
