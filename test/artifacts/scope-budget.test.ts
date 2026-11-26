/**
 * `ArtifactStore.scopeBudget` — every in-tree adapter states the budget its
 * `put` enforces, and states nothing when none binds.
 *
 * The law: the budget a store STATES is the one it ENFORCES. A payload one
 * byte over the stated byte budget is refused by `put`, and a scope at the
 * stated count gives up its oldest artifact to admit the next one.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IN_MEMORY_ARTIFACT_RETENTION,
  fileArtifacts,
  gcsArtifacts,
  inMemoryArtifacts,
  s3Artifacts,
  sqliteArtifacts,
} from '../../src/index.js';
import type { ArtifactRetention, ArtifactStore } from '../../src/artifacts/types.js';
import { fakeGcs, fakeS3 } from './fakes/objectServices.js';

const SCOPE = { conversationId: 'budget' };

const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'af-scope-budget-'));
  dirs.push(dir);
  return dir;
};

const ADAPTERS: readonly [string, (retention?: ArtifactRetention) => ArtifactStore][] = [
  ['inMemoryArtifacts', (retention) => inMemoryArtifacts(retention ? { retention } : {})],
  [
    'fileArtifacts',
    (retention) => fileArtifacts({ directory: temp(), ...(retention && { retention }) }),
  ],
  ...(sqliteAvailable
    ? ([
        [
          'sqliteArtifacts',
          (retention?: ArtifactRetention) =>
            sqliteArtifacts({ file: join(temp(), 'a.sqlite'), ...(retention && { retention }) }),
        ],
      ] as const)
    : []),
  [
    's3Artifacts',
    (retention) =>
      s3Artifacts({ bucket: 'b', _client: fakeS3().client, ...(retention && { retention }) }),
  ],
  [
    'gcsArtifacts',
    (retention) =>
      gcsArtifacts({ bucket: 'b', _storage: fakeGcs().storage, ...(retention && { retention }) }),
  ],
];

describe.each(ADAPTERS)('%s states the budget its put enforces', (name, create) => {
  it('states both dials, and only the dials that bind', async () => {
    // The in-memory store always bounds both: a dial left out keeps its default.
    const defaults = name === 'inMemoryArtifacts';
    const bytes = defaults
      ? { maxBytes: DEFAULT_IN_MEMORY_ARTIFACT_RETENTION.maxBytesPerScope }
      : {};
    const count = defaults
      ? { maxCount: DEFAULT_IN_MEMORY_ARTIFACT_RETENTION.maxCountPerScope }
      : {};
    expect(
      await create({ maxBytesPerScope: 1000, maxCountPerScope: 3 }).scopeBudget!(SCOPE),
    ).toEqual({ maxBytes: 1000, maxCount: 3 });
    expect(await create({ maxBytesPerScope: 1000 }).scopeBudget!(SCOPE)).toEqual({
      maxBytes: 1000,
      ...count,
    });
    expect(await create({ maxCountPerScope: 3, ttlMs: 60_000 }).scopeBudget!(SCOPE)).toEqual({
      ...bytes,
      maxCount: 3,
    });
  });

  it('states nothing when no budget binds (a ttl alone is not a budget)', async () => {
    const expected =
      name === 'inMemoryArtifacts'
        ? {
            maxBytes: DEFAULT_IN_MEMORY_ARTIFACT_RETENTION.maxBytesPerScope,
            maxCount: DEFAULT_IN_MEMORY_ARTIFACT_RETENTION.maxCountPerScope,
          }
        : null;
    expect(await create().scopeBudget!(SCOPE)).toEqual(expected);
    if (name !== 'inMemoryArtifacts') {
      expect(await create({ ttlMs: 60_000 }).scopeBudget!(SCOPE)).toBeNull();
    }
  });

  it('the stated byte budget is the one put refuses past', async () => {
    const store = create({ maxBytesPerScope: 100 });
    const { maxBytes } = (await store.scopeBudget!(SCOPE))!;
    await expect(
      store.put(SCOPE, { kind: 'note', mediaType: 'text/plain', data: 'x'.repeat(maxBytes! + 1) }),
    ).rejects.toThrow();
    await expect(
      store.put(SCOPE, { kind: 'note', mediaType: 'text/plain', data: 'x'.repeat(maxBytes!) }),
    ).resolves.toBeDefined();
  });

  it('the stated count is the one put evicts to stay within', async () => {
    const store = create({ maxCountPerScope: 2 });
    const { maxCount } = (await store.scopeBudget!(SCOPE))!;
    const swept: string[] = [];
    for (let i = 0; i <= maxCount!; i++) {
      const result = await store.put(SCOPE, {
        kind: 'note',
        mediaType: 'text/plain',
        data: `n${i}`,
      });
      swept.push(...result.swept.map((row) => row.ref));
    }
    expect(swept).toHaveLength(1);
    expect((await store.list(SCOPE)).artifacts).toHaveLength(maxCount!);
  });
});

it('cleans its temporary folders', () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
