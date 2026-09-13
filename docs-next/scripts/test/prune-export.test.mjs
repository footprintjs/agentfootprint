import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const script = new URL('../prune-export.mjs', import.meta.url);
const html = '<html><body>404: This page could not be found.</body></html>';
const internalFiles = ['index.html', 'index.txt', '__next._tree.txt', '__next._head.txt',
  '__next._index.txt', '__next._not-found.txt', '__next._not-found.__PAGE__.txt'];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-prune-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '_not-found'));
  mkdirSync(path.join(root, '404'));
  mkdirSync(path.join(root, 'docs'));
  for (const name of internalFiles) {
    writeFileSync(path.join(root, '_not-found', name), name === 'index.html' ? html : 'rsc');
  }
  writeFileSync(path.join(root, '404.html'), html);
  writeFileSync(path.join(root, '404/index.html'), html);
  writeFileSync(path.join(root, 'docs/index.html'), '<html>Valid documentation</html>');
  return root;
}

function prune(root) {
  execFileSync(process.execPath, [script.pathname, root], {
    env: { ...process.env, DOCS_KEEP_FULL_RSC: '' }, stdio: 'pipe',
  });
}

test('removes only the internal error-route copies and preserves public 404s and docs', (t) => {
  const root = fixture(t);
  prune(root);
  assert.equal(existsSync(path.join(root, '_not-found')), false);
  assert.equal(readFileSync(path.join(root, '404.html'), 'utf8'), html);
  assert.equal(readFileSync(path.join(root, '404/index.html'), 'utf8'), html);
  assert.equal(readFileSync(path.join(root, 'docs/index.html'), 'utf8'), '<html>Valid documentation</html>');
});

for (const scenario of ['different HTML', 'missing public 404', 'unknown internal file', 'linked internal route']) {
  test(`keeps the internal route on ${scenario}`, (t) => {
    const root = fixture(t);
    if (scenario === 'different HTML') writeFileSync(path.join(root, '404.html'), 'different');
    if (scenario === 'missing public 404') rmSync(path.join(root, '404/index.html'));
    if (scenario === 'unknown internal file') writeFileSync(path.join(root, '_not-found/new.txt'), 'new format');
    if (scenario === 'linked internal route') {
      writeFileSync(path.join(root, 'docs/index.html'), '<a href="/base/_not-found/">Error details</a>');
    }
    prune(root);
    for (const name of internalFiles) assert.equal(existsSync(path.join(root, '_not-found', name)), true);
  });
}
