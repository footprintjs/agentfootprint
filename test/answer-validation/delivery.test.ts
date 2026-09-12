/** Public Agent delivery boundary: checked JSON is the value every consumer
 * receives; an enforced refusal reaches neither streaming nor conversation
 * memory. The provider really streams, so a missing listener cannot fake it.
 */
import { describe, expect, it } from 'vitest';
import { Agent, AnswerValidationError, allow, type OutputSchemaParser } from '../../src/index.js';
import type { LLMProvider, LLMRequest } from '../../src/adapters/types.js';
import { mock } from '../../src/llm-providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
} from '../../src/memory/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import { inProcessHost } from '../hosting/testHost.js';

interface Capacity {
  capacityGb: number;
  disks: { label: string; capacityGb: number }[];
}
const GOOD: Capacity = { capacityGb: 512, disks: [{ label: 'disk-1', capacityGb: 512 }] };
const BAD: Capacity = { ...GOOD, capacityGb: 999 };
const RAW = JSON.stringify(GOOD, null, 2);
const CANONICAL = JSON.stringify(GOOD);
const IDENTITY = { tenant: 'test-estate', principal: 'engineer-a', conversationId: 'capacity-a' };

const capacityParser: OutputSchemaParser<Capacity> = {
  parse(value: unknown): Capacity {
    const candidate = value as Partial<Capacity> | null;
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.capacityGb !== 'number' ||
      !Array.isArray(candidate.disks) ||
      candidate.disks.some(
        (disk) => typeof disk.label !== 'string' || typeof disk.capacityGb !== 'number',
      )
    ) {
      throw new Error('capacityGb and disks are required');
    }
    return { capacityGb: candidate.capacityGb, disks: candidate.disks };
  },
};

function checks(candidate: Capacity) {
  return {
    checks: [
      {
        id: 'capacity-total',
        disposition:
          candidate.capacityGb === 512 ? ('checked-pass' as const) : ('checked-fail' as const),
      },
    ],
  };
}

function streaming(...answers: string[]) {
  const requests: LLMRequest[] = [];
  const yielded: string[] = [];
  const provider: LLMProvider = {
    name: 'validation-stream-fixture',
    complete: async () => {
      throw new Error('the real stream path must be used');
    },
    stream: async function* (request) {
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      const content = answers[requests.length - 1];
      if (content === undefined) throw new Error('unexpected provider call');
      const at = Math.ceil(content.length / 2);
      for (const [tokenIndex, part] of [content.slice(0, at), content.slice(at)].entries()) {
        yielded.push(part);
        yield { tokenIndex, content: part, done: false };
      }
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: { content, toolCalls: [], usage: { input: 2, output: 3 }, stopReason: 'stop' },
      };
    },
  };
  return { provider, requests, yielded };
}

function deliveries(agent: Agent, order: string[] = []) {
  const tokens: string[] = [];
  const ends: string[] = [];
  agent.on('agentfootprint.stream.token', (event) => {
    tokens.push(event.payload.content);
    order.push('token');
  });
  agent.on('agentfootprint.agent.turn_end', (event) => {
    ends.push(event.payload.finalContent);
    order.push('turn_end');
  });
  return { tokens, ends };
}

function memory(store: InMemoryStore) {
  return defineMemory({
    id: 'capacity-memory',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
    store,
  });
}

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`answer validation delivery — ${reactMode}`, () => {
    it('delivers canonical checked JSON to run, tokens, turn_end, checkpoint and memory', async () => {
      const source = streaming(RAW);
      const store = new InMemoryStore();
      const order: string[] = [];
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({
          id: 'disk-capacity',
          version: '1',
          validate(candidate) {
            order.push('validated');
            expect(Object.isFrozen(candidate)).toBe(true);
            expect(Object.isFrozen(candidate.disks)).toBe(true);
            expect(Object.isFrozen(candidate.disks[0])).toBe(true);
            expect(Reflect.set(candidate, 'capacityGb', 999)).toBe(false);
            return checks(candidate);
          },
        })
        .memory(memory(store))
        .build();
      const delivered = deliveries(agent, order);
      expect(agent.answerValidation()).toBeUndefined();

      expect(await agent.run({ message: 'total the disks', identity: IDENTITY })).toBe(CANONICAL);
      expect(source.yielded.join('')).toBe(RAW);
      expect(delivered.tokens).toEqual([CANONICAL]);
      expect(delivered.ends).toEqual([CANONICAL]);
      expect(order).toEqual(['validated', 'token', 'turn_end']);
      expect(agent.checkpoint()?.history.at(-1)?.content).toBe(CANONICAL);
      expect((await store.list(IDENTITY)).entries.length).toBeGreaterThan(0);
      expect(JSON.stringify((await store.list(IDENTITY)).entries)).toContain('capacityGb');
      expect(agent.answerValidation()).toMatchObject({
        status: 'passed',
        checked: 1,
        failed: 0,
        schemaAccepted: true,
        validatorId: 'disk-capacity',
        validatorVersion: '1',
        mode: 'enforce',
      });
      const report = agent.answerValidation()!;
      (report.checks as unknown as { disposition: string }[])[0]!.disposition = 'checked-fail';
      expect(agent.answerValidation()?.checks[0]?.disposition).toBe('checked-pass');
    });

    it('an enforced failure rejects with its report before any consumer sees an answer', async () => {
      const source = streaming(JSON.stringify(BAD));
      const store = new InMemoryStore();
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({ id: 'disk-capacity', version: '1', validate: checks })
        .memory(memory(store))
        .build();
      const delivered = deliveries(agent);
      const error = await agent
        .run({ message: 'total the disks', identity: IDENTITY })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(AnswerValidationError);
      expect((error as AnswerValidationError).report).toEqual(agent.answerValidation());
      expect(agent.answerValidation()).toMatchObject({ status: 'failed', checked: 1, failed: 1 });
      expect(source.yielded.join('')).toContain('999');
      expect(delivered).toEqual({ tokens: [], ends: [] });
      expect((await store.list(IDENTITY)).entries).toEqual([]);
      expect(agent.checkpoint()?.history.some((message) => message.role === 'assistant')).toBe(
        false,
      );
      const state = agent.getLastSnapshot()?.sharedState as { newMessages?: unknown[] };
      expect(state.newMessages ?? []).toEqual([]);
    });

    it('observe mode delivers the checked candidate while retaining the failed report', async () => {
      const source = streaming(JSON.stringify(BAD, null, 2));
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({
          id: 'disk-capacity',
          version: '1',
          mode: 'observe',
          validate: checks,
        })
        .build();
      const delivered = deliveries(agent);
      expect(await agent.runTyped<Capacity>({ message: 'observe only' })).toEqual(BAD);
      expect(agent.answerValidation()).toMatchObject({
        status: 'failed',
        mode: 'observe',
        failed: 1,
      });
      expect(delivered).toEqual({ tokens: [JSON.stringify(BAD)], ends: [JSON.stringify(BAD)] });
    });

    it('validates the output middleware replacement and delivers that exact canonical value', async () => {
      const source = streaming(JSON.stringify(BAD));
      const seen: Capacity[] = [];
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .messageMiddleware({
          name: 'replace-from-reviewed-result',
          onMessage: (message) =>
            message.phase === 'output'
              ? allow(RAW, 'host replaced the draft from its reviewed result')
              : allow(),
        })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({
          id: 'disk-capacity',
          version: '1',
          validate(candidate) {
            seen.push(JSON.parse(JSON.stringify(candidate)) as Capacity);
            return checks(candidate);
          },
        })
        .build();
      const delivered = deliveries(agent);
      expect(await agent.run({ message: 'total the disks' })).toBe(CANONICAL);
      expect(seen).toEqual([GOOD]);
      expect(delivered).toEqual({ tokens: [CANONICAL], ends: [CANONICAL] });
    });

    it('runTyped does not reparse a transforming schema after validation', async () => {
      let parses = 0;
      let parsesAtValidation = 0;
      const seen: unknown[] = [];
      const source = streaming('{ "capacityMiB": 524288 }');
      const parser: OutputSchemaParser<{ capacityGb: number }> = {
        parse(raw: unknown) {
          parses++;
          const value = raw as { capacityMiB?: unknown };
          if (typeof value.capacityMiB !== 'number')
            throw new Error('capacityMiB is required before transformation');
          return { capacityGb: value.capacityMiB / 1024 };
        },
      };
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .outputSchema(parser)
        .answerValidation<{ capacityGb: number }>({
          id: 'units',
          version: '1',
          validate(candidate) {
            parsesAtValidation = parses;
            seen.push(candidate);
            return {
              checks: [
                {
                  id: 'unit-conversion',
                  disposition: candidate.capacityGb === 512 ? 'checked-pass' : 'checked-fail',
                },
              ],
            };
          },
        })
        .build();
      const delivered = deliveries(agent);
      expect(await agent.runTyped({ message: 'convert units' })).toEqual({ capacityGb: 512 });
      expect(seen).toEqual([{ capacityGb: 512 }]);
      expect(parses).toBe(parsesAtValidation);
      expect(delivered).toEqual({ tokens: ['{"capacityGb":512}'], ends: ['{"capacityGb":512}'] });
    });

    it('a follow-up is checked again and a fresh identity cannot inherit its failed report or answer', async () => {
      const source = streaming(RAW, JSON.stringify(BAD), RAW);
      const agent = Agent.create({ provider: source.provider, model: 'mock', reactMode })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({ id: 'disk-capacity', version: '1', validate: checks })
        .build();
      await agent.runTyped({ message: 'first identity request', identity: IDENTITY });
      await expect(agent.followUp('recheck the capacity')).rejects.toBeInstanceOf(
        AnswerValidationError,
      );
      expect(agent.answerValidation()?.status).toBe('failed');
      expect(
        source.requests[1]?.messages.some(
          (message) => message.role === 'assistant' && message.content === CANONICAL,
        ),
      ).toBe(true);
      await expect(
        agent.runTyped({
          message: 'second identity request',
          identity: {
            ...IDENTITY,
            principal: 'engineer-b',
            conversationId: 'capacity-b',
          },
        }),
      ).resolves.toEqual(GOOD);
      expect(agent.answerValidation()?.status).toBe('passed');
      expect(
        source.requests[2]?.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content),
      ).toEqual(['second identity request']);
      expect(source.requests[2]?.messages.some((message) => message.role === 'assistant')).toBe(
        false,
      );
    });
  });
}

describe('answer validation — unverified is not a pass', () => {
  for (const disposition of ['unreachable', 'not-applicable', 'zero-checks'] as const) {
    it(`refuses ${disposition} without claiming success`, async () => {
      const agent = Agent.create({ provider: mock({ reply: RAW }), model: 'mock' })
        .outputSchema(capacityParser)
        .answerValidation<Capacity>({
          id: 'evidence',
          version: '1',
          validate: () => ({
            checks: disposition === 'zero-checks' ? [] : [{ id: 'source', disposition }],
          }),
        })
        .build();
      await expect(
        agent.run({ message: 'verify with unavailable evidence' }),
      ).rejects.toBeInstanceOf(AnswerValidationError);
      expect(agent.answerValidation()).toMatchObject({ status: 'unverified', checked: 0 });
    });
  }

  it('requires the schema and refuses options that can alter the validated output later', () => {
    const builder = () => Agent.create({ provider: mock({ reply: RAW }), model: 'mock' });
    const options = { id: 'evidence', version: '1', validate: checks };
    expect(() => builder().answerValidation(options).build()).toThrow(/outputSchema/);
    expect(() =>
      builder()
        .outputSchema(capacityParser)
        .answerValidation(options)
        .outputFallback({ canned: GOOD })
        .build(),
    ).toThrow(/outputFallback/);
    expect(() =>
      builder()
        .outputSchema(capacityParser)
        .limitsTravelWithTheAnswer()
        .answerValidation(options)
        .build(),
    ).toThrow(/limitsTravelWithTheAnswer/);
  });

  it('without the option, existing streamed bytes and schema behavior stay unchanged', async () => {
    const source = streaming(RAW);
    const agent = Agent.create({ provider: source.provider, model: 'mock' })
      .outputSchema(capacityParser)
      .build();
    const delivered = deliveries(agent);
    expect(await agent.run({ message: 'ordinary schema run' })).toBe(RAW);
    expect(delivered.tokens.join('')).toBe(RAW);
    expect(delivered.tokens).toHaveLength(2);
    expect(delivered.ends).toEqual([RAW]);
    expect(agent.answerValidation()).toBeUndefined();
    expect(Object.hasOwn(agent.getLastSnapshot()?.sharedState ?? {}, 'answerValidation')).toBe(
      false,
    );
  });

  it('the standing-agent streaming host forwards only accepted content, never a refused draft', async () => {
    const host = inProcessHost({ streaming: true });
    const source = streaming(JSON.stringify(BAD), RAW);
    const agent = Agent.create({ provider: source.provider, model: 'mock' })
      .outputSchema(capacityParser)
      .answerValidation<Capacity>({ id: 'disk-capacity', version: '1', validate: checks })
      .build();
    const handle = await standingAgent({ agent, host, sessions: memorySessions() });
    try {
      const refused = await host.deliver({ input: 'wrong total', sessionId: 'rejected-session' });
      expect(refused.error).toBeTruthy();
      expect(refused.output).toBeUndefined();
      expect(refused.chunks).toEqual([]);
      const accepted = await host.deliver({
        input: 'correct total',
        sessionId: 'accepted-session',
      });
      expect(accepted.error).toBeUndefined();
      expect(accepted.output).toBe(CANONICAL);
      expect(accepted.chunks).toEqual([CANONICAL]);
    } finally {
      await handle.close();
    }
  });
});
