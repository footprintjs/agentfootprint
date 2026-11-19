import assert from 'node:assert/strict';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProbes, probeState, removeProbes } from './files.mjs';
import { renderContextProbes } from './probes.mjs';

async function fixture(run) {
  const box = await realpath(await mkdtemp(join(tmpdir(), 'af-context-files-')));
  const agent = join(box, 'agent');
  await mkdir(agent);
  const all = renderContextProbes(join(box, 'consumer'));
  try {
    return await run({ box, agent, all, runtime: all.slice(0, 2), types: all.slice(2) });
  } finally {
    await rm(box, { recursive: true, force: true });
  }
}

test('reserved paths move from empty to runtime pair to all four and back to empty', async () => {
  await fixture(async ({ agent, all, runtime, types }) => {
    const owned = [];
    const retained = join(agent, 'archive-member.txt');
    await writeFile(retained, 'original archive bytes');
    await probeState(agent, all, []);
    await createProbes(agent, runtime, owned);
    await probeState(agent, all, runtime);
    assert.equal(owned.length, 2);
    for (const probe of runtime)
      assert.equal(await readFile(join(agent, probe.relativePath), 'utf8'), probe.body);
    await createProbes(agent, types, owned);
    await probeState(agent, all, all);
    assert.equal(owned.length, 4);
    await removeProbes(owned);
    await probeState(agent, all, []);
    assert.equal(await readFile(retained, 'utf8'), 'original archive bytes');
  });
});

test('a pre-existing identical reserved file is neither overwritten nor deleted', async () => {
  await fixture(async ({ agent, all, runtime }) => {
    const target = join(agent, runtime[0].relativePath);
    await writeFile(target, runtime[0].body);
    const before = await lstat(target);
    const owned = [];
    await assert.rejects(createProbes(agent, runtime, owned), { code: 'EEXIST' });
    assert.deepEqual(owned, []);
    await removeProbes(owned);
    assert.equal(await readFile(target, 'utf8'), runtime[0].body);
    assert.equal((await lstat(target)).ino, before.ino);
    await assert.rejects(probeState(agent, all, []));
  });
});

test('partial batch creation cleans only the created prefix after a later collision', async () => {
  await fixture(async ({ agent, all, runtime }) => {
    const existing = join(agent, runtime[1].relativePath);
    await writeFile(existing, 'pre-existing bytes');
    const owned = [];
    await assert.rejects(createProbes(agent, runtime, owned), { code: 'EEXIST' });
    assert.equal(owned.length, 1);
    assert.equal(await readFile(join(agent, runtime[0].relativePath), 'utf8'), runtime[0].body);
    await removeProbes(owned);
    await assert.rejects(lstat(join(agent, runtime[0].relativePath)), { code: 'ENOENT' });
    assert.equal(await readFile(existing, 'utf8'), 'pre-existing bytes');
    await assert.rejects(probeState(agent, all, []));
  });
});

test('wrong same-size bytes and a missing expected probe refuse the runtime phase', async () => {
  await fixture(async ({ agent, all, runtime }) => {
    const owned = [];
    await createProbes(agent, runtime, owned);
    const path = join(agent, runtime[0].relativePath);
    const changed = runtime[0].body.replace('node/11', 'node/12');
    assert.equal(Buffer.byteLength(changed), runtime[0].size);
    await writeFile(path, changed);
    await assert.rejects(probeState(agent, all, runtime));
    await writeFile(path, runtime[0].body);
    await unlink(path);
    await assert.rejects(probeState(agent, all, runtime));
    await removeProbes(owned);
    await probeState(agent, all, []);
  });
});

test('type probes appearing before their phase refuse an otherwise correct runtime set', async () => {
  await fixture(async ({ agent, all, runtime }) => {
    const owned = [];
    await createProbes(agent, all, owned);
    await assert.rejects(probeState(agent, all, runtime));
    await probeState(agent, all, all);
    await removeProbes(owned);
    await probeState(agent, all, []);
  });
});

test('a reserved symlink is not followed, overwritten or accepted as a regular probe', async () => {
  await fixture(async ({ box, agent, all, runtime }) => {
    const target = join(box, 'unowned-target');
    const path = join(agent, runtime[0].relativePath);
    await writeFile(target, runtime[0].body);
    await symlink(target, path);
    const owned = [];
    await assert.rejects(createProbes(agent, runtime, owned), { code: 'EEXIST' });
    await assert.rejects(probeState(agent, all, [runtime[0]]));
    await removeProbes(owned);
    assert.equal(await readlink(path), target);
    assert.equal(await readFile(target, 'utf8'), runtime[0].body);
  });
});

test('hardlinked probes refuse state and cleanup until their extra link is removed', async () => {
  await fixture(async ({ box, agent, all, runtime }) => {
    const owned = [];
    await createProbes(agent, [runtime[0]], owned);
    const path = join(agent, runtime[0].relativePath);
    const extra = join(box, 'extra-hardlink');
    await link(path, extra);
    await assert.rejects(probeState(agent, all, [runtime[0]]));
    await assert.rejects(removeProbes(owned), AggregateError);
    assert.equal(await readFile(path, 'utf8'), runtime[0].body);
    assert.equal(await readFile(extra, 'utf8'), runtime[0].body);
    await unlink(extra);
    await removeProbes(owned);
    await probeState(agent, all, []);
  });
});

test('cleanup refuses an unowned replacement even when its bytes match', async () => {
  await fixture(async ({ box, agent, runtime }) => {
    const owned = [];
    await createProbes(agent, [runtime[0]], owned);
    const path = join(agent, runtime[0].relativePath);
    const original = join(box, 'original-inode');
    await rename(path, original);
    await writeFile(path, runtime[0].body);
    assert.notEqual((await lstat(path)).ino, (await lstat(original)).ino);
    await assert.rejects(removeProbes(owned), AggregateError);
    assert.equal(await readFile(path, 'utf8'), runtime[0].body);
    assert.equal(await readFile(original, 'utf8'), runtime[0].body);
  });
});

test('cleanup refuses a symlink replacement without deleting its target', async () => {
  await fixture(async ({ box, agent, runtime }) => {
    const owned = [];
    await createProbes(agent, [runtime[0]], owned);
    const path = join(agent, runtime[0].relativePath);
    const original = join(box, 'original-inode');
    const target = join(box, 'unowned-target');
    await rename(path, original);
    await writeFile(target, 'retained target');
    await symlink(target, path);
    await assert.rejects(removeProbes(owned), AggregateError);
    assert.equal(await readlink(path), target);
    assert.equal(await readFile(target, 'utf8'), 'retained target');
  });
});

test('direct and ancestor directory aliases refuse before any probe is created', async () => {
  await fixture(async ({ box, agent, all, runtime }) => {
    const direct = join(box, 'agent-alias');
    const ancestor = join(box, 'parent-alias');
    await symlink(agent, direct, 'dir');
    await mkdir(join(box, 'real-parent'));
    await mkdir(join(box, 'real-parent', 'agent'));
    await symlink(join(box, 'real-parent'), ancestor, 'dir');
    for (const alias of [direct, join(ancestor, 'agent')]) {
      const owned = [];
      await assert.rejects(createProbes(alias, runtime, owned));
      await assert.rejects(probeState(alias, all, []));
      assert.deepEqual(owned, []);
    }
    await probeState(agent, all, []);
  });
});

test('a changed parent alias prevents cleanup through the replacement directory', async () => {
  await fixture(async ({ box, agent, runtime }) => {
    const owned = [];
    await createProbes(agent, [runtime[0]], owned);
    const retained = join(box, 'retained-agent');
    const replacement = join(box, 'replacement-agent');
    await rename(agent, retained);
    await mkdir(replacement);
    const foreign = join(replacement, runtime[0].relativePath);
    await writeFile(foreign, 'foreign bytes');
    await symlink(replacement, agent, 'dir');
    await assert.rejects(removeProbes(owned), AggregateError);
    assert.equal(await readFile(foreign, 'utf8'), 'foreign bytes');
    assert.equal(await readFile(join(retained, runtime[0].relativePath), 'utf8'), runtime[0].body);
  });
});
