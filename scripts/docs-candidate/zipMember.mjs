/** One original, hash-bound package member. This is not a package executor. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

export function readOriginalMember(bytes, selected) {
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64 * 1024 * 1024, 'docs-input-zip-bound');
  assert.equal(bytes.length, selected.artifact.bytes, 'docs-input-zip-length');
  assert.equal(sha256(bytes), selected.artifact.sha256, 'docs-input-zip-identity');
  assert(Number.isSafeInteger(selected.tar.bytes) && selected.tar.bytes > 0 && selected.tar.bytes <= 32 * 1024 * 1024);
  const result = spawnSync('python3', ['-B', fileURLToPath(new URL('./zip-member.py', import.meta.url)),
    selected.artifact.member, String(selected.tar.bytes)], {
    input: bytes, timeout: 45000, maxBuffer: selected.tar.bytes + 65536,
    env: Object.fromEntries(['PATH', 'SYSTEMROOT', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
  });
  assert(!result.error && result.status === 0 && result.signal === null, 'docs-input-zip-refused');
  assert.equal(result.stdout.length, selected.tar.bytes, 'docs-input-tar-length');
  assert.equal(sha256(result.stdout), selected.tar.sha256, 'docs-input-tar-identity');
  assert.equal(integrity(result.stdout), selected.tar.integrity, 'docs-input-tar-integrity');
  return result.stdout;
}
