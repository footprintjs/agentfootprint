/**
 * A dataset's declared TIME AXIS — the judge, the shared wording, the reader,
 * the pre-write refusal in `stageDatasetArtifacts`, the minted event, and the
 * sqlite column added in place on a file written before it existed.
 *
 * The cross-store round-trip (put · head · list · get, and the refusal storing
 * nothing) is the conformance case `a-declared-time-axis-rides-the-ticket`,
 * run against all five stores by `./store-conformance.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindArtifacts,
  describeTimeAxis,
  inMemoryArtifacts,
  InvalidArtifactError,
  readTimeAxis,
  sqliteArtifacts,
  stageDatasetArtifacts,
  timeAxisIssues,
  type DatasetTimeAxis,
} from '../../src/index.js';
import type { ArtifactEventFact } from '../../src/artifacts/capability.js';

const SCOPE = { conversationId: 'conv-time' };
const HOURLY: DatasetTimeAxis = {
  column: 'hour',
  unit: 'iso',
  interval: '1h',
  aggregate: { read_iops: 'avg', peak_iops: 'max' },
};

describe('timeAxisIssues — the one judge', () => {
  it.each<[string, DatasetTimeAxis]>([
    ['column + unit only', { column: 'ts', unit: 'epoch-s' }],
    ['one aggregate', { column: 'ts', unit: 'epoch-ms', interval: '5m', aggregate: 'max' }],
    ['per-measure aggregates', HOURLY],
    ['raw with a cadence', { column: 't', unit: 'iso', interval: '30s', aggregate: 'raw' }],
    ['raw alone', { column: 't', unit: 'iso', aggregate: 'raw' }],
    ['a wall-clock zone', { column: 't', unit: 'iso', zone: 'Europe/London' }],
  ])('accepts %s', (_what, axis) => {
    expect(timeAxisIssues(axis)).toEqual([]);
  });

  it.each<[string, unknown, RegExp]>([
    ['not an object', 'ts', /must be an object/],
    ['a blank column', { column: ' ', unit: 'iso' }, /column must name/],
    ['an unknown unit', { column: 'ts', unit: 'seconds' }, /unit must be one of/],
    ['an unknown key', { column: 'ts', unit: 'iso', agg: 'avg' }, /unknown key 'agg'/],
    ['a zone on an epoch', { column: 'ts', unit: 'epoch-s', zone: 'UTC' }, /epoch is an instant/],
    ['a zone nobody knows', { column: 't', unit: 'iso', zone: 'Mars/Olympus' }, /IANA zone/],
    [
      'a malformed interval',
      { column: 't', unit: 'iso', interval: '1 hour', aggregate: 'avg' },
      /interval must be/,
    ],
    [
      'a summary with no interval',
      { column: 't', unit: 'iso', aggregate: 'avg' },
      /interval must say/,
    ],
    [
      'an interval with no summary',
      { column: 't', unit: 'iso', interval: '1h' },
      /needs timeAxis.aggregate/,
    ],
    [
      'an unknown aggregate',
      { column: 't', unit: 'iso', interval: '1h', aggregate: 'p95' },
      /aggregate must be/,
    ],
    [
      'raw inside a record',
      { column: 't', unit: 'iso', interval: '1h', aggregate: { a: 'raw' } },
      /aggregate\['a'\]/,
    ],
    [
      'an empty record',
      { column: 't', unit: 'iso', interval: '1h', aggregate: {} },
      /names no measure/,
    ],
    [
      'the time column as a measure',
      { column: 't', unit: 'iso', interval: '1h', aggregate: { t: 'max' } },
      /time column 't' as a measure/,
    ],
  ])('refuses %s, by name', (_what, value, message) => {
    const issues = timeAxisIssues(value);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toMatch(message);
  });
});

describe('describeTimeAxis — the one wording for a title', () => {
  it.each<[DatasetTimeAxis, string | undefined]>([
    [HOURLY, 'hourly avg and max'],
    [{ column: 't', unit: 'iso', interval: '5m', aggregate: 'max' }, '5-minute max'],
    [{ column: 't', unit: 'iso', interval: '1d', aggregate: { a: 'sum', b: 'sum' } }, 'daily sum'],
    [
      { column: 't', unit: 'iso', interval: '1m', aggregate: { a: 'min', b: 'avg', c: 'max' } },
      'per-minute min, avg and max',
    ],
    [{ column: 't', unit: 'iso', interval: '5m', aggregate: 'raw' }, 'raw samples every 5 minutes'],
    [{ column: 't', unit: 'iso', aggregate: 'raw' }, 'raw samples'],
    [{ column: 't', unit: 'iso' }, undefined],
  ])('%j → %s', (axis, words) => {
    expect(describeTimeAxis(axis)).toBe(words);
  });
});

describe('readTimeAxis — what a consumer finds on a ticket', () => {
  it('absent, declared and malformed are three different answers', () => {
    expect(readTimeAxis({ kind: 'dataset/rows' })).toEqual({ status: 'absent' });
    expect(readTimeAxis({ timeAxis: HOURLY })).toEqual({ status: 'declared', axis: HOURLY });
    const foreign = readTimeAxis({ timeAxis: { column: 'ts' } });
    expect(foreign.status).toBe('malformed');
  });
});

describe('the mint', () => {
  it('keeps its own copy — mutating the declaration after put rewrites nothing', async () => {
    const store = inMemoryArtifacts();
    const aggregate: Record<string, 'avg' | 'max'> = { read_iops: 'avg' };
    const { meta } = await store.put(SCOPE, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: [],
      timeAxis: { column: 'hour', unit: 'iso', interval: '1h', aggregate },
    });
    aggregate.read_iops = 'max';
    expect((await store.head(SCOPE, meta.ref))?.timeAxis?.aggregate).toEqual({ read_iops: 'avg' });
  });

  it('the minted event carries the declaration, so a screen that listens sees it', async () => {
    const facts: ArtifactEventFact[] = [];
    const artifacts = bindArtifacts(inMemoryArtifacts(), SCOPE, { onEvent: (f) => facts.push(f) });
    await artifacts.put({
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: [],
      timeAxis: HOURLY,
    });
    const minted = facts.find((f) => f.type === 'minted');
    expect(minted?.type === 'minted' && minted.meta.timeAxis).toEqual(HOURLY);
  });
});

describe('stageDatasetArtifacts — refused before the first write', () => {
  it('a malformed declaration throws by dataset key and stores nothing', async () => {
    const store = inMemoryArtifacts();
    const artifacts = bindArtifacts(store, SCOPE);
    const staged = stageDatasetArtifacts(
      [
        {
          key: 'fine',
          artifact: { kind: 'dataset/rows', mediaType: 'application/json', data: [] },
        },
        {
          key: 'hourly',
          artifact: {
            kind: 'dataset/rows',
            mediaType: 'application/json',
            data: [],
            timeAxis: { column: 'hour', unit: 'iso', aggregate: 'avg' },
          },
        },
      ],
      artifacts,
    );
    await expect(staged).rejects.toThrow(InvalidArtifactError);
    await expect(staged).rejects.toThrow(/Dataset 'hourly': .*interval must say/);
    expect((await store.list(SCOPE)).artifacts).toHaveLength(0);
  });

  it('a well-formed declaration reaches the receipt', async () => {
    const [publication] = await stageDatasetArtifacts(
      [
        {
          key: 'rows',
          artifact: {
            kind: 'dataset/rows',
            mediaType: 'application/json',
            data: [],
            timeAxis: HOURLY,
          },
        },
      ],
      bindArtifacts(inMemoryArtifacts(), SCOPE),
    );
    expect(publication?.artifact.status === 'stored' && publication.artifact.meta.timeAxis).toEqual(
      HOURLY,
    );
  });
});

describe('sqliteArtifacts — the column is added in place', () => {
  it('a file written before the column existed opens, and carries a declaration afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-time-axis-'));
    try {
      const file = join(dir, 'artifacts.db');
      const first = sqliteArtifacts({ file });
      const { meta: old } = await first.put(SCOPE, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: [],
      });
      first.close();
      // Rewind the file to the shape the store had before the column shipped.
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
        DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void };
      };
      const raw = new DatabaseSync(file);
      raw.exec('ALTER TABLE af_artifacts DROP COLUMN time_axis');
      raw.close();

      const reopened = sqliteArtifacts({ file });
      expect((await reopened.head(SCOPE, old.ref))?.timeAxis).toBeUndefined();
      const { meta } = await reopened.put(SCOPE, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: [],
        timeAxis: HOURLY,
      });
      expect((await reopened.head(SCOPE, meta.ref))?.timeAxis).toEqual(HOURLY);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
