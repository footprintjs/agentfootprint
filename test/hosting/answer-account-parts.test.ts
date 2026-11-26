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
 *   • `complete: false` is still answered, from the whole recording read back.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mockClassifier } from '../../src/classify/mock.js';
import { defineOntology } from '../../src/ontology/index.js';
import { openSavedRecording, recordRun } from '../../src/observe.js';
import { bindArtifacts } from '../../src/artifacts/capability.js';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  RECORDING_INDEX_ARTIFACT_KIND,
  recordingPutInput,
  sqliteArtifacts,
} from '../../src/index.js';
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
): { store: ArtifactStore; gets: string[]; heads: string[] } {
  const gets: string[] = [];
  const heads: string[] = [];
  return {
    gets,
    heads,
    store: {
      put: (scope, input) => inner.put(scope, input),
      head: (scope, ref) => {
        heads.push(ref);
        return inner.head(scope, ref);
      },
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
  options: { packed?: boolean; runId?: string | null } = {},
): Promise<{ whole: string; index: string; base: string; parts: string[] }> {
  // `null`: no origin run id, so the account picks the run from the recording itself.
  const runId = options.runId === null ? undefined : options.runId ?? FLAGSHIP_RUN_ID;
  const facts = runId === undefined ? {} : { runId };
  const whole = (await store.put(SCOPE, recordingPutInput(recording, facts))).meta.ref;
  const filed = await fileRecordingParts(store, SCOPE, recording, {
    ...facts,
    packed: options.packed === true,
  });
  if (filed.status !== 'filed') throw new Error(filed.detail);
  return {
    whole,
    index: filed.index.ref,
    base: filed.parts[0]!.ref,
    parts: filed.parts.map((meta) => meta.ref),
  };
}

const real = await realRecording();

/**
 * A run whose tool selection left out the only tool that reaches a declared
 * source, with the answer layer's source check on: the account's standing
 * rests on an omission witnessed at each model call. Under
 * `reactMode: 'dynamic-grouped'` those calls are found only inside the
 * recording's subflow results.
 */
async function omittedSourceRun(reactMode: 'dynamic' | 'dynamic-grouped'): Promise<Recording> {
  const lookup = (name: string, displayName: string) =>
    defineTool({
      name,
      displayName,
      description: 'Read a measurement.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'Observed.',
    });
  const classifier = mockClassifier(() => ({
    model: 'fixture',
    latencyMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    answers: {
      tool: { type: 'choice', choice: 'status', confidence: 1, probabilities: { status: 1 } },
    },
  }));
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'first', name: 'status', args: {} }] },
        { content: 'Request complete.' },
      ],
    }),
    reactMode,
    model: 'mock',
    recordReceipt: true,
  })
    .tools([lookup('status', 'service status'), lookup('archive', 'the archive')])
    .toolChoice({ classifier, serve: { top: 1 } })
    .ontology(
      defineOntology({
        id: 'inventory',
        version: '1',
        nodes: {
          inventory: {
            meaning: 'Stored inventory',
            sources: [{ source: 'catalog', via: ['archive'] }],
          },
        },
        sources: { catalog: { meaning: 'Declared inventory source' } },
      }),
    )
    .answerLayer({ sourceNotConsulted: true, standingLine: { when: 'not-sure-or-ask' } })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Check inventory.' });
    return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

const omitted = {
  dynamic: await omittedSourceRun('dynamic'),
  'dynamic-grouped': await omittedSourceRun('dynamic-grouped'),
};

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

  for (const packed of [false, true]) {
    for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
      it(`E6 · a source left out of the tool selection, ${reactMode}${
        packed ? ', packed' : ''
      }: parts equal whole`, async () => {
        const { store, close } = create();
        try {
          const refs = await fileBoth(store, omitted[reactMode], { packed, runId: null });
          const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
          const fromWhole = bodyOf(await explain(host, refs.whole));
          // The whole recording's account witnesses the omission; the parts one must too.
          expect(JSON.stringify(fromWhole.account)).toContain('/omissions/0/callable');
          expect(bodyOf(await explain(host, refs.index))).toEqual(fromWhole);
        } finally {
          close();
        }
      });
    }
  }

  it('one door fact per part read on a miss, naming the part; none on a hit; another session is not-found', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const agent = storeAgent(store);
      const events = artifactEventsOf(agent);
      const { host } = await served(agent, { extra: { answerAccounts: {} } });
      bodyOf(await explain(host, refs.index));
      const resolved = () =>
        events().filter((event) => event.type === 'agentfootprint.artifacts.resolved');
      const named = resolved().map((event) => event.payload as { ref: string; via: string });
      expect(named.map((fact) => fact.ref)).toEqual(refs.parts);
      expect(named.every((fact) => fact.via === 'get')).toBe(true);
      expect(named.some((fact) => fact.ref === refs.index)).toBe(false);
      bodyOf(await explain(host, refs.index));
      expect(resolved()).toHaveLength(refs.parts.length);
      expect((await explain(host, refs.index, 'another-session')).code).toBe(
        'ERR_ARTIFACT_NOT_FOUND',
      );
    } finally {
      close();
    }
  });

  it('a cache hit costs heads only, and losing any one part ends it: the next request is not-found', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const view = watching(store);
      const { host } = await served(storeAgent(view.store), { extra: { answerAccounts: {} } });
      bodyOf(await explain(host, refs.index));
      view.gets.length = 0;
      view.heads.length = 0;
      bodyOf(await explain(host, refs.index));
      // The index is read and verified once (its head and get); every part is head-checked.
      expect(view.gets).toEqual([refs.index]);
      expect(view.heads.filter((ref) => ref === refs.index)).toHaveLength(2);
      expect(view.heads.filter((ref) => ref !== refs.index).sort()).toEqual([...refs.parts].sort());
      for (const gone of [refs.parts[refs.parts.length - 1]!, refs.base]) {
        await store.delete(SCOPE, gone);
        expect((await explain(host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
      }
    } finally {
      close();
    }
  });

  it('a missing invocation part is the one not-found, never a partial account', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      expect(refs.parts.length).toBeGreaterThan(1);
      await store.delete(SCOPE, refs.parts[1]!);
      const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
      expect((await explain(host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    } finally {
      close();
    }
  });

  it('an invocation part changed in place (its ticket unchanged) is the one not-found, never a partial account', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const target = refs.parts[1]!;
      const changed = watching(store, (ref, data) =>
        ref === target ? (data as string).replace('"subflowId":"sf-', '"subflowId":"SF-') : data,
      );
      const { host } = await served(storeAgent(changed.store), { extra: { answerAccounts: {} } });
      expect((await explain(host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    } finally {
      close();
    }
  });

  it('a part missing for one request drops the cached answer: the next request reads the whole again', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      let hide: string | undefined;
      const view = watching(store);
      const flaky: ArtifactStore = {
        ...view.store,
        head: (scope, ref) => (ref === hide ? Promise.resolve(null) : view.store.head(scope, ref)),
      };
      const { host } = await served(storeAgent(flaky), { extra: { answerAccounts: {} } });
      bodyOf(await explain(host, refs.index));
      hide = refs.parts[1];
      expect((await explain(host, refs.index)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
      hide = undefined;
      view.gets.length = 0;
      bodyOf(await explain(host, refs.index));
      // Not served from a cache that outlived the gap: every part was read again.
      expect(view.gets.filter((ref) => ref !== refs.index).sort()).toEqual([...refs.parts].sort());
    } finally {
      close();
    }
  });

  it('every packed part under the ceiling, the whole over it: the named 413, refused before it expands', async () => {
    const { store, close } = create();
    try {
      const unit = (id: string) => ({
        subflowId: id,
        subflowName: id,
        parentStageId: 'seed',
        treeContext: {
          globalContext: { rows: Array.from({ length: 1000 }, () => `${id}:${'v'.repeat(4096)}`) },
          stageContexts: {},
          history: [],
        },
      });
      const mount = (key: string, id: string, next?: object) => ({
        id,
        name: id,
        subflowId: id,
        runtimeStageId: key,
        ...(next && { next }),
      });
      const heavy = {
        snapshot: {
          runId: 'snap',
          executionTree: mount('a#1', 'a', mount('b#2', 'b', mount('c#3', 'c'))),
          subflowResults: { 'a#1': unit('a'), 'b#2': unit('b'), 'c#3': unit('c') },
        },
        events: [],
        structure: { id: 'seed', name: 'seed' },
      } as unknown as Recording;
      const refs = await fileBoth(store, heavy, { packed: true });
      const { host } = await served(storeAgent(store), {
        extra: { answerAccounts: { maxRecordingBytes: 8 * 1024 * 1024 } },
      });
      expect((await explain(host, refs.index)).code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
    } finally {
      close();
    }
  });

  it('an index past its own cap is the one not-found, not a ceiling the recording may not pass', async () => {
    const { store, close } = create();
    try {
      const view = watching(store);
      const ref = (
        await store.put(SCOPE, {
          kind: 'recording/run-index',
          mediaType: 'application/json',
          data: `{"format":"agentfootprint.recording.index.v1","pad":"${'x'.repeat(3_000_000)}"}`,
        })
      ).meta.ref;
      const { host } = await served(storeAgent(view.store), { extra: { answerAccounts: {} } });
      expect((await explain(host, ref)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
      expect(view.gets).toEqual([]);
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

  it('stored parts within the ceiling, the payloads a whole read restores past it: the same 413, from the index', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const saved = await openSavedRecording(bindArtifacts(store, SCOPE), refs.index);
      if (saved.status !== 'ready') throw new Error(saved.reason);
      const stored = saved.sizes.storedBytes - (saved.sizes.index ?? 0);
      // Index format 2: the `same` sub-flow payloads are stored once, in their results.
      expect(saved.sizes.restoredBytes).toBeGreaterThan(saved.sizes.storedBytes);
      const view = watching(store);
      const { host } = await served(storeAgent(view.store), {
        extra: { answerAccounts: { maxRecordingBytes: stored } },
      });
      expect((await explain(host, refs.index)).code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
      expect(view.gets).toEqual([refs.index]);
    } finally {
      close();
    }
  });

  it('an index that understates the restored bytes: measured, the ceiling holds (413); within it, not-found', async () => {
    const { store, close } = create();
    try {
      const refs = await fileBoth(store, real);
      const honest = await openSavedRecording(bindArtifacts(store, SCOPE), refs.index);
      if (honest.status !== 'ready') throw new Error(honest.reason);
      // The plain bytes the whole holds: every stored part, plus what it restores.
      const exact = honest.sizes.restoredBytes - (honest.sizes.index ?? 0);
      const index = JSON.parse((await store.get(SCOPE, refs.index))!.data as string) as {
        invocations: { restoredBytes?: number }[];
        subflowPayloads: { restoredBytes: number };
      };
      index.invocations.find((row) => row.restoredBytes !== undefined)!.restoredBytes! -= 1;
      index.subflowPayloads.restoredBytes -= 1;
      const forged = (
        await store.put(SCOPE, {
          kind: RECORDING_INDEX_ARTIFACT_KIND,
          mediaType: 'application/json',
          data: JSON.stringify(index),
          digest: 'sha-256',
          origin: { runId: FLAGSHIP_RUN_ID },
        })
      ).meta.ref;
      // The figure passes the up-front check at exact − 1; the measured bytes do not.
      const tight = await served(storeAgent(store), {
        extra: { answerAccounts: { maxRecordingBytes: exact - 1 } },
      });
      expect((await explain(tight.host, forged)).code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
      // Within the ceiling, the figure does not match what was measured: no account.
      const loose = await served(storeAgent(store), {
        extra: { answerAccounts: { maxRecordingBytes: 32 * 1024 * 1024 } },
      });
      expect((await explain(loose.host, forged)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
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

  it('a recording that is not complete is still explained, from the whole read back', async () => {
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
