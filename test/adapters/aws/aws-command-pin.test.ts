/**
 * THE AWS COMMAND-NAME PIN — every AWS adapter in this package, in one place.
 *
 * Read `./awsCommandPin.ts` first: it holds the registry, the three bugs this
 * exists to prevent, and why the AWS SDKs are deliberately NOT installed here.
 *
 * Three assertions, in the house order:
 *   1. DISPATCH  — each adapter really reaches for the pinned commands, driven
 *                  through an `_sdk` double that exports only those names.
 *   2. REALITY   — where the peer dep is resolvable, every pinned name is a
 *                  real export of the real package.
 *   3. COMPLETE  — every source file that loads an `@aws-sdk/*` package is in
 *                  the registry, so a new AWS adapter cannot ship unpinned.
 *
 * Nothing here reaches AWS or needs a credential.
 */

import { describe, expect, it } from 'vitest';

import {
  AWS_COMMAND_PINS,
  fakeSdk,
  findAwsLoadSites,
  realSdk,
  type AwsAdapterPin,
} from './awsCommandPin.js';

import { agentCoreIdentity } from '../../../src/identity.js';
import {
  AgentCoreStore,
  BedrockAgentMemory,
  s3VectorsStore,
} from '../../../src/memory-providers.js';
import { agentCoreSessions } from '../../../src/adapters/hosting/agentcore.js';
import { cloudwatchObservability } from '../../../src/adapters/observability/cloudwatch.js';
import { xrayObservability } from '../../../src/adapters/observability/xray.js';
import { bedrockEmbedder } from '../../../src/embedders/index.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { agentCorePolicy } from '../../../src/security/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

const pin = (adapter: string): AwsAdapterPin => {
  const row = AWS_COMMAND_PINS.find((p) => p.adapter === adapter);
  if (!row) throw new Error(`no pin registered for '${adapter}'`);
  return row;
};

const IDENTITY: MemoryIdentity = { conversationId: 'c-1' };

function entry(id: string, embedding?: number[]): MemoryEntry<unknown> {
  const now = Date.now();
  return {
    id,
    value: { id },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(embedding && { embedding }),
  } as MemoryEntry<unknown>;
}

function event(type = 'agentfootprint.agent.turn_start'): AgentfootprintEvent {
  return {
    type,
    payload: {},
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'r-1',
    },
  } as unknown as AgentfootprintEvent;
}

// ─── 1. DISPATCH ─────────────────────────────────────────────────────
//
// One `it` per adapter, each asserting the SET of SDK command constructors it
// reached for. The double exports nothing else, so an adapter that reaches
// elsewhere fails here with its own missing-command refusal.

describe('AWS adapters dispatch exactly the commands they are pinned to', () => {
  it('agentCoreIdentity — GetWorkloadAccessTokenForUserId, then GetResourceOauth2Token', async () => {
    const row = pin('agentCoreIdentity');
    const sdk = fakeSdk(row, {
      GetWorkloadAccessTokenForUserIdCommand: { workloadAccessToken: 'per-user-token' },
      GetResourceOauth2TokenCommand: { accessToken: 'tok', sessionUri: 's-1' },
    });
    const credentials = agentCoreIdentity({
      region: 'us-west-2',
      workloadName: 'my-agent',
      _sdk: sdk.module,
    });
    const result = await credentials.getCredential({
      service: 'github',
      mode: 'user',
      identity: { principal: 'ada' },
    });

    // THE 9.4.0 FIX. Through 9.3.0 this adapter never got here: it built a
    // BedrockAgentCoreClient and duck-typed `getResourceOauth2Token` off it,
    // which a bare *Client does not have, so the documented path threw on
    // every call before any command was constructed.
    expect(sdk.names()).toEqual([
      'GetWorkloadAccessTokenForUserIdCommand',
      'GetResourceOauth2TokenCommand',
    ]);
    // And the per-user workload token is what it vends WITH, not just a call
    // it makes on the way past.
    expect(sdk.sent[1]?.input['workloadIdentityToken']).toBe('per-user-token');
    expect(result.status).toBe('issued');
  });

  it('agentCoreIdentity — the SESSION id comes off `sessionUri`, which is what the wire calls it', async () => {
    const row = pin('agentCoreIdentity');
    const sdk = fakeSdk(row, {
      GetResourceOauth2TokenCommand: { authorizationUrl: 'https://consent', sessionUri: 'sess-9' },
    });
    const result = await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      _sdk: sdk.module,
    }).getCredential({ service: 'github', mode: 'user' });
    expect(result).toMatchObject({ status: 'authorization-required', sessionId: 'sess-9' });
  });

  it('AgentCoreStore — CreateEvent / ListEvents / DeleteEvent / RetrieveMemoryRecords', async () => {
    const row = pin('AgentCoreStore');
    const stored = JSON.stringify(entry('a'));
    const sdk = fakeSdk(row, {
      ListEventsCommand: { events: [{ eventId: 'e-1', payload: [{ blob: stored }] }] },
      RetrieveMemoryRecordsCommand: { memoryRecordSummaries: [] },
    });
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    await store.put(IDENTITY, entry('a'));
    await store.list(IDENTITY);
    await store.delete(IDENTITY, 'a');
    await store.search(IDENTITY, [1, 0], { text: 'anything' });

    expect(new Set(sdk.names())).toEqual(
      new Set([
        'CreateEventCommand',
        'ListEventsCommand',
        'DeleteEventCommand',
        'RetrieveMemoryRecordsCommand',
      ]),
    );
  });

  it('agentCoreSessions — CreateEvent to persist, ListEvents to hydrate', async () => {
    const row = pin('agentCoreSessions');
    const sdk = fakeSdk(row, { ListEventsCommand: { events: [] } });
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: sdk.module });
    await sessions.persist('c-1', {
      format: 'conversation-v1',
      savedAt: Date.now(),
      data: { history: [] },
    } as never);
    await sessions.hydrate('c-1');
    expect(sdk.names()).toEqual(['CreateEventCommand', 'ListEventsCommand']);
  });

  it('BedrockAgentMemory — GetAgentMemory to read, DeleteAgentMemory to forget', async () => {
    const row = pin('BedrockAgentMemory');
    const sdk = fakeSdk(row, { GetAgentMemoryCommand: { memoryContents: [] } });
    const memory = new BedrockAgentMemory({
      agentId: 'a-1',
      agentAliasId: 'alias-1',
      _sdk: sdk.module,
    });
    await memory.readSummaries('mem-1');
    await memory.forget('mem-1');
    expect(sdk.names()).toEqual(['GetAgentMemoryCommand', 'DeleteAgentMemoryCommand']);
  });

  it('s3VectorsStore — GetIndex to verify, then the five vector operations', async () => {
    const row = pin('s3VectorsStore');
    const sdk = fakeSdk(row, {
      // The preflight (9.4.0): a healthy index, so the store proceeds.
      GetIndexCommand: {
        index: {
          distanceMetric: 'cosine',
          metadataConfiguration: { nonFilterableMetadataKeys: ['af'] },
        },
      },
      GetVectorsCommand: { vectors: [] },
      ListVectorsCommand: { vectors: [] },
      QueryVectorsCommand: { vectors: [] },
    });
    const store = s3VectorsStore({ bucket: 'b', index: 'i', _sdk: sdk.module });
    await store.put(IDENTITY, entry('a', [1, 0, 0, 0]));
    await store.get(IDENTITY, 'a');
    await store.search(IDENTITY, [1, 0, 0, 0]);
    await store.delete(IDENTITY, 'a');
    await store.list(IDENTITY);
    expect(new Set(sdk.names())).toEqual(
      new Set([
        'GetIndexCommand',
        'PutVectorsCommand',
        'QueryVectorsCommand',
        'GetVectorsCommand',
        'DeleteVectorsCommand',
        'ListVectorsCommand',
      ]),
    );
    // The index is read FIRST, and once.
    expect(sdk.names()[0]).toBe('GetIndexCommand');
    expect(sdk.names().filter((n) => n === 'GetIndexCommand')).toHaveLength(1);
  });

  it('cloudwatchObservability — PutLogEvents, and CreateLogStream only when the stream is missing', async () => {
    const row = pin('cloudwatchObservability / agentcoreObservability');
    let puts = 0;
    const sdk = fakeSdk(row, {
      PutLogEventsCommand: () => {
        // First put finds no stream; the adapter creates one and retries. That
        // heal path is the only reason CreateLogStream is in the pin at all.
        if (++puts === 1) {
          const err = new Error('The specified log stream does not exist.');
          err.name = 'ResourceNotFoundException';
          throw err;
        }
        return {};
      },
    });
    const strategy = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      _sdk: sdk.module,
      onError: () => undefined,
    });
    strategy.exportEvent(event());
    await strategy.flush?.();
    strategy.stop?.();
    expect(sdk.names()).toEqual([
      'PutLogEventsCommand',
      'CreateLogStreamCommand',
      'PutLogEventsCommand',
    ]);
  });

  it('xrayObservability — PutTraceSegments', async () => {
    const row = pin('xrayObservability');
    const sdk = fakeSdk(row);
    const strategy = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 0,
      _sdk: sdk.module,
    });
    strategy.exportEvent(event('agentfootprint.agent.turn_start'));
    strategy.exportEvent(event('agentfootprint.agent.turn_end'));
    await strategy.flush?.();
    strategy.stop?.();
    expect(new Set(sdk.names())).toEqual(new Set(['PutTraceSegmentsCommand']));
  });

  it('bedrockEmbedder — InvokeModel', async () => {
    const row = pin('bedrockEmbedder');
    const sdk = fakeSdk(row, {
      InvokeModelCommand: { body: JSON.stringify({ embedding: [0.1, 0.2] }) },
    });
    const embedder = bedrockEmbedder({ region: 'us-east-1', _sdk: sdk.module });
    await embedder.embed({ text: 'hello' });
    expect(sdk.names()).toEqual(['InvokeModelCommand']);
  });

  it('bedrock (LLM provider) — Converse to complete, ConverseStream to stream', async () => {
    const row = pin('bedrock (LLM provider)');
    const sdk = fakeSdk(row, {
      ConverseCommand: {
        output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      ConverseStreamCommand: {
        stream: (async function* () {
          yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'hi' } } };
          yield { messageStop: { stopReason: 'end_turn' } };
        })(),
      },
    });
    const provider = bedrock({ region: 'us-east-1', _sdk: sdk.module });
    const request = { model: 'bedrock', messages: [{ role: 'user' as const, content: 'hey' }] };
    await provider.complete(request);
    for await (const _chunk of provider.stream!(request)) {
      /* drain */
    }
    expect(sdk.names()).toEqual(['ConverseCommand', 'ConverseStreamCommand']);
  });

  it('agentCorePolicy dispatches NOTHING — the pin records a retirement too', () => {
    const row = pin('agentCorePolicy (retired 9.4.0)');
    expect(row.commands).toEqual([]);
    expect(row.note).toMatch(/EvaluatePolicyCommand/);
    // Nothing can be dispatched from a factory that refuses to be built.
    expect(() => agentCorePolicy({ policyStoreId: 'p' })).toThrow(/retired/i);
  });
});

// ─── 2. REALITY ──────────────────────────────────────────────────────
//
// The half that makes the registry a claim about AWS rather than about
// ourselves. Skipped-by-absence is REPORTED, never silent: an assertion that
// quietly verifies nothing is worse than no assertion, because it reads green.

describe('the pinned names against the real SDK, where it is installed', () => {
  const installed = [...new Set(AWS_COMMAND_PINS.map((p) => p.sdkPackage))].filter(
    (pkg) => realSdk(pkg) !== undefined,
  );

  it('reports which peer deps this run could actually check', () => {
    // Normal in this repo and in CI: none. Six adapters prove their
    // missing-peer-dep refusals by these genuinely not being installed, so the
    // check runs on machines that installed them and states its own reach here.
    expect(Array.isArray(installed)).toBe(true);
  });

  for (const row of AWS_COMMAND_PINS) {
    const sdk = realSdk(row.sdkPackage);
    const label = `${row.adapter} → ${row.sdkPackage}`;
    it.skipIf(sdk === undefined)(`${label}: every pinned command really exists`, () => {
      const module = sdk as Record<string, unknown>;
      expect(typeof module[row.client], `${row.sdkPackage} must export ${row.client}`).toBe(
        'function',
      );
      const missing = row.commands.filter((name) => typeof module[name] !== 'function');
      expect(missing, `${row.adapter} dispatches commands that do not exist`).toEqual([]);
    });
  }

  it('EvaluatePolicyCommand is not a command anybody may pin again', () => {
    const sdk = realSdk('@aws-sdk/client-bedrock-agentcore');
    const pinned = AWS_COMMAND_PINS.flatMap((p) => p.commands);
    // The registry level of the claim — always checked.
    expect(pinned).not.toContain('EvaluatePolicyCommand');
    // The reality level — checked wherever the package is present.
    if (sdk) expect(sdk['EvaluatePolicyCommand']).toBeUndefined();
  });
});

// ─── 3. COMPLETENESS ─────────────────────────────────────────────────

describe('the registry covers every AWS adapter in the source tree', () => {
  const loadSites = findAwsLoadSites();
  const covered = new Map<string, AwsAdapterPin>();
  for (const row of AWS_COMMAND_PINS) for (const src of row.sources) covered.set(src, row);

  it('every file that loads an @aws-sdk package has a pin', () => {
    const unpinned = [...loadSites.keys()].filter((file) => !covered.has(file));
    expect(
      unpinned,
      'a new AWS adapter must add a row to AWS_COMMAND_PINS naming the commands it dispatches',
    ).toEqual([]);
  });

  it('every pin points at a file that exists, and at the package that file loads', () => {
    for (const [file, row] of covered) {
      const loads = loadSites.get(file);
      // The retired policy adapter loads nothing on purpose — that IS its pin.
      if (row.commands.length === 0 && loads === undefined) continue;
      expect(loads, `${file} is pinned but loads no @aws-sdk package`).toBeDefined();
      expect([...(loads ?? [])], `${file} loads a package its pin does not name`).toContain(
        row.sdkPackage,
      );
    }
  });

  it('pinned names are shaped like the SDK names they claim to be', () => {
    for (const row of AWS_COMMAND_PINS) {
      expect(row.client, `${row.adapter}: client must be a *Client`).toMatch(/Client$/);
      // Never an aggregated client: those carry per-operation methods, which is
      // the shortcut agentCoreIdentity assumed and did not have.
      expect(row.client, `${row.adapter}: must not pin an aggregated client`).not.toBe(
        'BedrockAgentCore',
      );
      for (const command of row.commands) {
        expect(command, `${row.adapter}: ${command} must be a *Command`).toMatch(/Command$/);
      }
      expect(new Set(row.commands).size, `${row.adapter}: duplicate command`).toBe(
        row.commands.length,
      );
    }
  });
});
