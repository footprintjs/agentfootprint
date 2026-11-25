/**
 * The `answer-account` op over a recording saved IN PARTS.
 *
 * The laws being pinned:
 *   • E6 through the hosted op: the account (and its shown values) from a
 *     parts recording deep-equals the one from the same recording filed whole,
 *     on both stores, plain and packed, for a real engine run and for the
 *     flagship fixture.
 *   • The op's own vocabulary: a base part that is missing or changed is the
 *     one `ERR_ARTIFACT_NOT_FOUND`; a base over `maxRecordingBytes` is the
 *     named 413 with no read past the index; a packed base whose plain form is
 *     over the ceiling is the same 413, refused before it expands.
 *   • One door fact on a miss (the base part's `get`), none on a hit; another
 *     session's ref is the one not-found.
 *   • `complete: false` is still answered: the account reads only the base.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts, recordingPutInput, sqliteArtifacts } from '../../src/index.js';
import type { ArtifactScope, ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { AnswerAccountWireBody, ArtifactWireResult } from '../../src/hosting/index.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { fileRecordingParts } from '../../src/recorders/observability/recordingParts/file.js';
import { realRecording } from '../recorders/observability/recordingParts/helpers.js';
import { fixtureA, FLAGSHIP_RUN_ID } from '../answer-account/helpers.js';
import {
  artifactEventsOf,
  harness,
  type Delivered,
  type FilingHost,
} from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
afterEach(closeAll);

const SESSION = 's-parts';
const SCOPE: ArtifactScope = { conversationId: SESSION };

const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

const STORES: readonly [string, () => { store: ArtifactStore; close(): void }][] = [
  ['inMemoryArtifacts', () => ({ store: inMemoryArtifacts(), close: () => {} })],
  ...(sqliteAvailable
    ? ([
        [
          'sqliteArtifacts',
          () => {
            const dir = mkdtempSync(join(tmpdir(), 'af-account-parts-'));
            const store = sqliteArtifacts({ file: join(dir, 'a.sqlite') });
            return {
              store,
              close: () => {
                store.close();
                rmSync(dir, { recursive: true, force: true });
              },
            };
          },
        ],
      ] as const)
    : []),
];

/** A store view that counts gets per ref and can alter what a ref's get answers. */
function watching(
  inner: ArtifactStore,
  alter?: (ref: string, data: unknown) => unknown,
): { store: ArtifactStore; gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    store: {
      put: (scope, input) => inner.put(scope, input),
      head: (scope, ref) => inner.head(scope, ref),
      async get(scope, ref) {
        gets.push(ref);
        const record = await inner.get(scope, ref);
        return record && alter ? { ...record, data: alter(ref, record.data) } : record;
      },
      delete: (scope, ref) => inner.delete(scope, ref),
      list: (scope, options) => inner.list(scope, options),
    },
  };
}

const storeAgent = (store: ArtifactStore) =>
  Agent.create({ provider: mock({ reply: 'ok' }), model: 'm', artifacts: store }).build();

function explain(host: FilingHost, ref: string, sessionId = SESSION): Promise<Delivered> {
  return host.deliver({ sessionId, artifact: { op: 'account', ref } });
}

function bodyOf(delivered: Delivered): AnswerAccountWireBody {
  const result = delivered.artifact as ArtifactWireResult | undefined;
  if (result?.op !== 'account' || result.answer === undefined) {
    throw new Error(`expected an account, got ${JSON.stringify(delivered).slice(0, 300)}`);
  }
  return result.answer;
}

/** File `recording` whole and in parts under the session's scope; both refs. */
async function fileBoth(
  store: ArtifactStore,
  recording: Recording,
  options: { packed?: boolean; runId?: string } = {},
): Promise<{ whole: string; index: string; base: string }> {
  const runId = options.runId ?? FLAGSHIP_RUN_ID;
  const whole = (await store.put(SCOPE, recordingPutInput(recording, { runId }))).meta.ref;
  const filed = await fileRecordingParts(store, SCOPE, recording, {
    runId,
    packed: options.packed === true,
  });
  if (filed.status !== 'filed') throw new Error(filed.detail);
  return { whole, index: filed.index.ref, base: filed.parts[0]!.ref };
}

const real = await realRecording();

describe.each(STORES)('answer-account over a recording in parts — %s', (_name, create) => {
  for (const packed of [false, true]) {
    for (const [label, recording] of [
      ['a real engine run', real],
      ['the flagship fixture', fixtureA() as Recording],
    ] as const) {
      it(`E6 · ${label}${
        packed ? ', packed' : ''
      }: the account equals the whole recording's`, async () => {
        const { store, close } = create();
        try {
          const refs = await fileBoth(store, recording, { packed });
          const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
          const fromWhole = bodyOf(await explain(host, refs.whole));
          const fromParts = bodyOf(await explain(host, refs.index));
          expect(fromParts).toEqual(fromWhole);
          expect(fromParts.account.kind).toBe('agentfootprint/answer-account');
        } finally {
          close();
        }
      });
    }
  }

  it('one door fact on a miss (the base part), none on a hit; another session is not-found', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const agent = storeAgent(store);
      const events = artifactEventsOf(agent);
      const { host } = await served(agent, { extra: { answerAccounts: {} } });
      bodyOf(await explain(host, refs.index));
      const resolved = () =>
        events().filter((event) => event.type === 'agentfootprint.artifacts.resolved');
      expect(resolved()).toHaveLength(1);
      expect((resolved()[0]!.payload as { ref: string; via: string }).ref).toBe(refs.base);
      expect((resolved()[0]!.payload as { via: string }).via).toBe('get');
      bodyOf(await explain(host, refs.index));
      expect(resolved()).toHaveLength(1);
      expect((await explain(host, refs.index, 'another-session')).code).toBe(
        'ERR_ARTIFACT_NOT_FOUND',
      );
    } finally {
      close();
    }
  });

  it('a missing or changed base part is the one not-found', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const changed = watching(store, (ref, data) =>
        ref === refs.base ? (data as string).replace('"events":[', '"events":[ ') : data,
      );
      const { host } = await served(storeAgent(changed.store), { extra: { answerAccounts: {} } });
      expect((await explain(host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
      await store.delete(SCOPE, refs.base);
      const again = await served(storeAgent(store), { extra: { answerAccounts: {} } });
      expect((await explain(again.host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    } finally {
      close();
    }
  });

  it('a base over maxRecordingBytes is the named 413, with no read past the index', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const view = watching(store);
      const { host } = await served(storeAgent(view.store), {
        extra: { answerAccounts: { maxRecordingBytes: 50_000 } },
      });
      const got = await explain(host, refs.index);
      expect(got.code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
      expect(view.gets).toEqual([refs.index]);
    } finally {
      close();
    }
  });

  it('a packed base whose plain form is over the ceiling is the same 413', async () => {
    const { store, close } = create();
    try {
      const heavy = {
        snapshot: {
          runId: 'snap',
          executionTree: { id: 'seed', name: 'seed' },
          sharedState: { rows: Array.from({ length: 400 }, () => `r${'w'.repeat(4096)}`) },
        },
        events: [],
        structure: { id: 'seed', name: 'seed' },
      } as unknown as Recording;
      const refs = await fileBoth(store, heavy, { packed: true });
      const { host } = await served(storeAgent(store), {
        extra: { answerAccounts: { maxRecordingBytes: 1024 * 1024 } },
      });
      expect((await explain(host, refs.index)).code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
    } finally {
      close();
    }
  });

  it('a recording that is not complete is still explained: the account reads only the base', async () => {
    const { store, close } = create();
    try {
      const parsed = JSON.parse(JSON.stringify(real)) as {
        snapshot: { subflowResults: Record<string, unknown> };
      };
      parsed.snapshot.subflowResults['orphan-mount#99999'] = { subflowId: 'orphan' };
      const refs = await fileBoth(store, parsed as unknown as Recording);
      const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
      expect(bodyOf(await explain(host, refs.index))).toEqual(
        bodyOf(await explain(host, refs.whole)),
      );
    } finally {
      close();
    }
  });
});
