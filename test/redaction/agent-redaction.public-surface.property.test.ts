/**
 * Property — over the Agent's WHOLE public surface: a value the policy selects
 * appears in no record the agent retains or serves, while the live model input
 * still holds it.
 *
 * Per seeded case: a random field name and a random secret, selected by a
 * random form footprintjs offers (a key, a pattern, a `fields` selector) and
 * joined with the conversation's names (`conversationRedaction` — a value the
 * person, the model or a tool writes travels as TEXT too, and text is kept out
 * only by naming the keys it travels under). The tool takes the secret as a
 * nested argument and returns it; the person's message carries it too.
 *
 * Every public member is classified by type
 * (`test/type-regressions/AgentRedactionSurface.completeness.test.ts`); every
 * `'record'` and `'structure'` member is exercised here — directly, or through
 * the surfaces it feeds (events for `on`/`once`, recorder rows for `attach`,
 * the strategies for `enable`, the trace toolpack for `bindSelfExplain`) — and
 * none may hold the secret. The `'callers-own'` members are the live control:
 * the provider's requests and `checkpoint()` DO hold it.
 *
 * Reproduce a failure with the seed printed in the test name.
 */
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import type { LLMProvider, LLMRequest } from '../../src/adapters/types.js';
import { ALL_EVENT_TYPES, type AgentfootprintEvent } from '../../src/events/registry.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { AGENT_PUBLIC_SURFACE } from '../type-regressions/AgentRedactionSurface.completeness.test.js';
import { eventPayloadFor, locationsOf, withoutAnswerBoundary } from './fixture.js';
import { everySurface, servedArtifacts } from './everySurface.js';

/** mulberry32 — the suite's seeded PRNG (`agent-redaction.property.test.ts`). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIELDS = ['pin', 'token', 'accountNo', 'dob', 'passport', 'iban', 'badge', 'vin'] as const;
const SCOPE = { conversationId: 'surface-case' };

interface Case {
  readonly seed: number;
  readonly field: string;
  readonly secret: string;
  readonly form: 'key' | 'pattern' | 'fields';
  readonly policy: RedactionPolicy;
}

function caseFor(seed: number): Case {
  const next = rng(seed);
  const field = FIELDS[Math.floor(next() * FIELDS.length)] as string;
  const secret = `SEC${seed}X${Math.floor(next() * 1e9)
    .toString(36)
    .toUpperCase()}`;
  const form = (['key', 'pattern', 'fields'] as const)[Math.floor(next() * 3)]!;
  const selector: RedactionPolicy =
    form === 'key'
      ? { keys: [field] }
      : form === 'pattern'
      ? { patterns: [new RegExp(`^${field}$`)] }
      : { fields: { customer: [field] } };
  return { seed, field, secret, form, policy: conversationRedaction(selector) };
}

/** The agent under test, with the live model input tapped. */
function agentFor(c: Case) {
  const requests: string[] = [];
  const inner = mock({
    chunkDelayMs: 0,
    replies: [
      {
        toolCalls: [
          { id: 'c1', name: 'lookup', args: { customer: { [c.field]: c.secret, name: 'Ada' } } },
        ],
      },
      { content: 'Done.' },
    ],
  });
  const provider: LLMProvider = {
    name: inner.name,
    complete: async (req: LLMRequest) => {
      requests.push(JSON.stringify(req));
      return inner.complete(req);
    },
  } as LLMProvider;
  const store = inMemoryArtifacts();
  const agent = Agent.create({
    provider,
    model: 'm',
    redact: c.policy,
    artifacts: { store, recordings: true },
  })
    .tool(
      defineTool<{ customer: Record<string, string> }, unknown>({
        name: 'lookup',
        description: 'Look a customer up.',
        inputSchema: {
          type: 'object',
          properties: { customer: { type: 'object' } },
          required: ['customer'],
        },
        execute: ({ customer }) => ({ customer: { [c.field]: customer[c.field] }, ok: true }),
      }),
    )
    .build();
  return { agent, requests, store };
}

describe('property — the Agent public surface keeps a selected value out of every record', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    const c = caseFor(seed);
    it(`seed ${seed} (${c.form} ${c.field})`, async () => {
      const { agent, requests, store } = agentFor(c);
      const surfaced = await everySurface(agent, `Check my ${c.field}: ${c.secret}`, SCOPE);
      const artifacts = await servedArtifacts(surfaced);

      // A consumer's own emits are served too — by the selected name.
      const emitted: AgentfootprintEvent[] = [];
      agent.on('*', (e) => emitted.push(e));
      agent.emit('app.custom', { customer: { [c.field]: c.secret } });

      // Every 'record' and 'structure' member, exercised.
      const exercised: Record<string, unknown> = {
        getLastSnapshot: agent.getLastSnapshot(),
        getSnapshot: agent.getSnapshot(),
        getLastNarrativeEntries: agent.getLastNarrativeEntries(),
        on: surfaced.events,
        once: surfaced.events,
        attach: surfaced.attached,
        enable: [
          artifacts.trace,
          artifacts.stepGraph,
          artifacts.console,
          artifacts.file,
          artifacts.audit,
          artifacts.otel,
        ],
        emit: emitted,
        emitAttributed: emitted,
        // The agent's own minted recording, read back from its artifact store.
        getArtifactStore: await mintedRecordings(store),
        bindSelfExplain: artifacts.traceToolpack,
        id: agent.id,
        name: agent.name,
        appName: agent.appName,
        getCommitCount: agent.getCommitCount(),
        getSpec: safeJson(agent.getSpec()),
        getUIGroup: safeJson(agent.getUIGroup()),
        getUIGroupWith: safeJson(agent.getUIGroupWith((metadata) => metadata)),
        getSystemPromptCachePolicy: agent.getSystemPromptCachePolicy(),
        commentaryTemplates: agent.commentaryTemplates,
        thinkingTemplates: agent.thinkingTemplates,
        ownsEvent: surfaced.events.map((e) => agent.ownsEvent(e)),
        listenerCount: agent.listenerCount(),
        canExplain: agent.canExplain(),
      };
      for (const [member, kind] of Object.entries(AGENT_PUBLIC_SURFACE)) {
        if (kind === 'record' || kind === 'structure') {
          expect(Object.keys(exercised), `${member} is not exercised`).toContain(member);
        }
      }

      const holding = Object.entries({ ...exercised, ...artifacts })
        .filter(([, value]) => locationsOf(withoutAnswerBoundary(value), c.secret).length > 0)
        .map(([name]) => name);
      expect(holding).toEqual([]);

      // The live control: the model's input and the caller's own continuation hold it.
      expect(requests.join('\n')).toContain(c.secret);
      expect(JSON.stringify(agent.checkpoint())).toContain(c.secret);
    });
  }
});

/**
 * The route decider's own events — `route_decided` with its rationale, the
 * limit and budget it reports when a turn runs out, every cost tick — under
 * the same random policies: a turn whose model keeps asking for the tool with
 * the secret, cut short by `maxIterations`, priced. Each event leaves through
 * the served path (`emitServed`), and none may hold the secret; the provider's
 * requests do.
 */
describe('property — the route, cost and budget events keep a selected value out', () => {
  for (const seed of [1, 3, 8, 21, 55]) {
    const c = caseFor(seed);
    it(`seed ${seed} (${c.form} ${c.field})`, async () => {
      const requests: string[] = [];
      const provider: LLMProvider = {
        name: 'never-finishes',
        complete: async (req: LLMRequest) => {
          requests.push(JSON.stringify(req));
          // The wrap-up call is the one offered no tools.
          if ((req.tools?.length ?? 0) === 0) {
            return {
              content: 'Out of steps.',
              toolCalls: [],
              usage: { input: 3, output: 2 },
              stopReason: 'stop',
            };
          }
          return {
            content: '',
            toolCalls: [
              {
                id: `c${requests.length}`,
                name: 'lookup',
                args: { customer: { [c.field]: c.secret } },
              },
            ],
            usage: { input: 3, output: 2 },
            stopReason: 'tool_use',
          };
        },
      };
      const agent = Agent.create({
        provider,
        model: 'm',
        redact: c.policy,
        pricingTable: { name: 'flat', pricePerToken: () => 0.001 },
      })
        .tool(
          defineTool<{ customer: Record<string, string> }, unknown>({
            name: 'lookup',
            description: 'Look a customer up.',
            inputSchema: { type: 'object', properties: { customer: { type: 'object' } } },
            execute: ({ customer }) => ({ customer, ok: true }),
          }),
        )
        .maxIterations(2)
        .build();
      const events: AgentfootprintEvent[] = [];
      agent.on('*', (e) => events.push(e));
      await agent.run({ message: `Check my ${c.field}: ${c.secret}` });

      const types = new Set(events.map((e) => e.type));
      for (const type of [
        'agentfootprint.agent.route_decided',
        'agentfootprint.cost.limit_hit',
        'agentfootprint.agent.budget_exhausted',
        'agentfootprint.cost.tick',
      ]) {
        expect(types.has(type as AgentfootprintEvent['type']), type).toBe(true);
      }
      const route = events.filter((e) => e.type === 'agentfootprint.agent.route_decided');
      expect(
        route.every((e) => typeof (e.payload as { rationale?: unknown }).rationale === 'string'),
      ).toBe(true);
      expect(locationsOf(withoutAnswerBoundary(events), c.secret)).toEqual([]);
      expect(locationsOf(withoutAnswerBoundary(agent.getLastSnapshot()), c.secret)).toEqual([]);
      // The live control: the model's input holds it.
      expect(requests.join('\n')).toContain(c.secret);
    });
  }
});

/**
 * EVERY event type in the registry, generated from it — the type list from
 * `events/registry.ts` · `ALL_EVENT_TYPES`, each payload from its
 * classification (`events/content.ts` · `EVENT_CONTENT`, built by
 * `fixture.ts` · `eventPayloadFor`), never a hand list. Each type is filed
 * through the agent's own dispatcher twice — the consumer door (`emit`) and the
 * hosting door for the agent's own last run (`emitAttributed`) — with the
 * secret in a field the type does not declare, at every words path it quotes,
 * and under the selected name inside every structure field. Every type is
 * delivered, and no listener receives the secret.
 */
describe('property — every event type in the registry keeps a selected value out', () => {
  for (const seed of [1, 2, 3, 5, 8]) {
    const c = caseFor(seed);
    it(`seed ${seed} (${c.form} ${c.field})`, async () => {
      const { agent } = agentFor(c);
      const ran: AgentfootprintEvent[] = [];
      const stop = agent.on('*', (e) => ran.push(e));
      await agent.run({ message: `Check my ${c.field}: ${c.secret}`, identity: SCOPE });
      stop();
      const runId = (ran[0]?.meta as { runId?: string } | undefined)?.runId;
      expect(typeof runId).toBe('string');

      const served: AgentfootprintEvent[] = [];
      agent.on('*', (e) => served.push(e));
      const payload = (type: string) =>
        eventPayloadFor(
          type,
          () => ({ customer: { [c.field]: c.secret, name: 'Ada' } }),
          `said ${c.secret}`,
        );
      for (const type of ALL_EVENT_TYPES) {
        agent.emit(type, payload(type));
        agent.emitAttributed(type, payload(type), { sessionId: 's', runId: runId as string });
      }
      expect(served).toHaveLength(ALL_EVENT_TYPES.length * 2);
      expect(new Set(served.map((e) => e.type))).toEqual(new Set(ALL_EVENT_TYPES));
      expect(locationsOf(served, c.secret)).toEqual([]);
    });
  }
});

/** Every artifact the run filed under its scope (its minted recording), read back. */
async function mintedRecordings(store: ReturnType<typeof inMemoryArtifacts>): Promise<unknown[]> {
  const page = await store.list(SCOPE);
  const out: unknown[] = [];
  for (const meta of page.artifacts) {
    const record = await store.get(SCOPE, meta.ref);
    out.push(record?.data);
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

/** A value as JSON, or its error, never a throw (a chart's spec can hold functions). */
function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown;
  } catch (e) {
    return String(e);
  }
}
