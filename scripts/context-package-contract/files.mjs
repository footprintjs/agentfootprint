/** Exclusive, finite probe ownership; never remove a pre-existing collision. */
import assert from 'node:assert/strict';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256 } from './oracle.mjs';

async function statOrAbsent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function probeState(agent, all, present) {
  assert.equal(await realpath(agent), resolve(agent), 'Installed Agent must not be an alias.');
  const expected = new Set(present.map((probe) => probe.id));
  for (const probe of all) {
    const path = join(agent, probe.relativePath);
    const stat = await statOrAbsent(path);
    if (!expected.has(probe.id)) {
      assert.equal(stat, null, `Unexpected context probe: ${probe.relativePath}`);
      continue;
    }
    assert.ok(
      stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      `Context probe must be an unaliased regular file: ${probe.relativePath}`,
    );
    const bytes = await readFile(path);
    assert.equal(bytes.length, probe.size);
    assert.equal(sha256(bytes), probe.sha256);
    assert.deepEqual(bytes, Buffer.from(probe.body, 'utf8'));
  }
}

export async function createProbes(agent, probes, owned) {
  assert.equal(await realpath(agent), resolve(agent), 'Installed Agent must not be an alias.');
  for (const probe of probes) {
    const path = join(agent, probe.relativePath);
    const handle = await open(path, 'wx', 0o600);
    try {
      const stat = await handle.stat();
      owned.push({ path, agent, device: stat.dev, inode: stat.ino });
      await handle.writeFile(probe.body, 'utf8');
    } finally {
      await handle.close();
    }
  }
}

export async function removeProbes(owned) {
  const failures = [];
  for (const file of owned.toReversed()) {
    try {
      assert.equal(
        await realpath(file.agent),
        resolve(file.agent),
        'Cannot clean a probe through a changed parent alias.',
      );
      const stat = await statOrAbsent(file.path);
      if (!stat) continue;
      assert.ok(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.nlink === 1 &&
          stat.dev === file.device &&
          stat.ino === file.inode,
        'Cannot remove a replaced context probe.',
      );
      await rm(file.path);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Context probe cleanup failed.');
}
