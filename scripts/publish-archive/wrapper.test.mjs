import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
test('native test wrapper exposes failed child TAP and preserves the failure', (t) => {
  const original = readFileSync(path.join(ROOT, 'test/docs/release-route.test.ts'), 'utf8');
  const files = [...original.matchAll(/'(scripts\/[^']+\.mjs)'/g)].map((match) => match[1]);
  assert(files.length >= 8);
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-tap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'test/docs');
  mkdirSync(dir, { recursive: true });
  // Only registration is inert. The real wrapper callback, child-process call,
  // options and error path execute unchanged after Node strips its TS types.
  // The inert registrar deliberately hides Error properties, as an opaque outer
  // reporter can; the wrapper itself must deliver the useful child diagnostics.
  const entry = original.replace("from 'vitest'", "from './test-driver.mjs'");
  assert.notEqual(entry, original);
  writeFileSync(path.join(dir, 'entry.mts'), entry);
  writeFileSync(
    path.join(dir, 'test-driver.mjs'),
    'export function it(_name, run) { try { run(); } catch { process.stderr.write("NATIVE_REGISTRATION_CAUGHT_FAILURE\\n"); process.exitCode = 1; } }\n',
  );
  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    const fails = file === 'scripts/publish-source.test.mjs';
    writeFileSync(
      target,
      "import test from 'node:test'; import assert from 'node:assert/strict';\n" +
        (fails
          ? "test('NATIVE_TAP_SENTINEL', () => assert.fail('OWNED_TEST_FAULT'));\n"
          : "test('inert child', () => {});\n"),
    );
  }
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', path.join(dir, 'entry.mts')],
    {
      cwd: root,
      env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin' },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert(
    !/SyntaxError|ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND/.test(r.stderr),
    'wrapper probe must execute',
  );
  assert.equal(r.status, 1, 'inner failure must remain a failing physical process');
  assert.match(r.stderr, /not ok \d+ - NATIVE_TAP_SENTINEL/);
  assert.match(r.stderr, /OWNED_TEST_FAULT/);
  assert.match(r.stderr, /# fail 1/);
});
