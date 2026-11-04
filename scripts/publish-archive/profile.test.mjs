import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { archiveBytes } from './archive-fixture.mjs';
import verifier from './verify.cjs';
import archive from './archive.cjs';
const source = { name: 'agentfootprint', version: '13.2.0' };
function file(t, bytes) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'archive-profile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'package.tgz');
  writeFileSync(input, bytes);
  return input;
}
function members(total) {
  return archiveBytes(source, {
    extra: Array.from({ length: total - 2 }, (_, i) => ['package/dist/f' + i, Buffer.alloc(0)]),
  });
}
for (const count of [10001, 20000])
  test('native archive profile admits ' + count + ' regular members', (t) => {
    const input = file(t, members(count));
    let actual;
    assert.doesNotThrow(() => {
      actual = verifier.inspectFile(input, source, source.version);
    });
    assert.equal(actual.report.files.length, count);
  });
test('native archive profile refuses 20001 members', (t) => {
  const input = file(t, members(20001));
  assert.throws(
    () => verifier.inspectFile(input, source, source.version),
    (e) => verifier.refusalCode(e) === 'invalid-archive',
  );
});
test('native archive profile has bounded expansion headroom above the prior 64MiB', (t) => {
  const bytes = archiveBytes(source, {
    extra: [['package/dist/large', Buffer.alloc(64 * 1024 * 1024)]],
  });
  const input = file(t, bytes);
  assert.doesNotThrow(() => verifier.inspectFile(input, source, source.version));
});
test('native archive profile refuses expansion above 128MiB', (t) => {
  const bytes = archiveBytes(source, {
    extra: [['package/dist/large', Buffer.alloc(128 * 1024 * 1024)]],
  });
  const input = file(t, bytes);
  assert.throws(
    () => verifier.inspectFile(input, source, source.version),
    (e) => verifier.refusalCode(e) === 'invalid-archive',
  );
});
// Same flags-zero policy as Foottrace's reviewed gzip-profile test; every
// nonzero bit is covered, including FTEXT and reserved bits with valid raw data.
for (const bit of [1, 2, 4, 8, 16, 32, 64, 128])
  test('canonical gzip refuses flag bit ' + bit, () => {
    const bytes = archiveBytes(source);
    assert.equal(bytes[3], 0);
    bytes[3] = bit;
    assert.throws(
      () => archive.inspectArchive(bytes, { package: source.name, version: source.version }),
      (e) => archive.archiveRefusalCode(e) === 'invalid-archive',
    );
  });
