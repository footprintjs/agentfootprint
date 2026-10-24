/** Independent regressions for the PR 4 review: real dispatches, synthetic providers,
 * and observable verdicts. No model or checker is used as an assertion oracle. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  absent,
  defineTool,
  fromIdentity,
  hostFilled,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../src/observe.js';
import { streamHandler } from '../../../src/hosting/streamHandler.js';
import { agUi } from '../../../src/ag-ui/adapter.js';

const IDENTITY = { tenant: 'review-tenant', principal: 'reviewer', conversationId: 'review-turn' };
const INPUT = { message: 'Check incidents for payments.', identity: IDENTITY };
const OVERCLAIM = 'Payments has never had a single incident, anywhere, ever.';
const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
type Reply = Record<string, unknown> & {
  negatives: { kind: string; about: string; restsOn: string[]; statement?: string }[];
};
const schema = {
  type: 'object',
  properties: {
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: 'string' },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'about', 'restsOn'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
    details: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  required: ['negatives'],
  additionalProperties: false,
} as const;
const answer = (handle = 'r1', extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...extra, negatives: [{ kind: 'none', about: 'payments', restsOn: [handle] }] });
const call = (name: string, args: Record<string, unknown> = {}, id = `provider-${name}`) => ({
  id,
  name,
  args,
});
const READ = call('read_incidents', { service: 'payments' });
const WRITE = call('create_incident');

function setup(
  replies: readonly (string | Partial<LLMResponse>)[],
  options: {
    mode?: (typeof MODES)[number];
    unestablished?: 'withhold' | 'state-searched';
    read?: () => unknown;
    write?: () => unknown;
    bound?: boolean;
    paging?: boolean;
    provider?: LLMProvider;
  } = {},
) {
  const requests: LLMRequest[] = [];
  const provider =
    options.provider ??
    mock({
      chunkDelayMs: 0,
      respond(request) {
        requests.push(request);
        const response = replies[requests.length - 1];
        if (response === undefined) throw new Error('Unexpected extra provider request.');
        return response;
      },
    });
  const read = vi.fn(options.read ?? (() => absent({ what: 'incidents', checked: 'declared' })));
  const write = vi.fn(options.write ?? (() => ({ created: true })));
  const tool = defineTool({
    name: 'read_incidents',
    description: 'Read incidents within one service and caller tenant.',
    effects: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        tenantId: { type: 'string' },
        ...(options.paging && { page: { type: 'number' } }),
      },
      required: options.bound === false ? ['service'] : ['service', 'tenantId'],
    },
    search: {
      source: { what: 'the incident store', said: ['incident store'] },
      subject: { what: 'incidents', said: ['incident', 'incidents'] },
      arguments: [
        { name: 'service', role: 'population' },
        { name: 'tenantId', role: 'filter' },
        ...(options.paging ? [{ name: 'page', role: 'page' as const }] : []),
      ],
      complete: 'within-arguments',
    },
    execute: read,
  });
  const agent = Agent.create({ provider, model: 'mock', reactMode: options.mode ?? 'dynamic' })
    .tool(options.bound === false ? tool : hostFilled(tool, { tenantId: fromIdentity('tenant') }))
    .tool(
      defineTool({
        name: 'create_incident',
        description: 'Create an incident; the write can take effect before a timeout.',
        inputSchema: { type: 'object', properties: {} },
        execute: write,
      }),
    )
    .outputSchema({ parse: (value) => value as Reply }, { jsonSchema: schema })
    .negativeClaims({
      field: 'negatives',
      tools: ['read_incidents'],
      unestablished: options.unestablished ?? 'withhold',
    })
    .answerLayer()
    .build();
  const tokens: string[] = [];
  const ends: unknown[] = [];
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload));
  return { agent, read, write, requests, tokens, ends };
}

async function expectWithheld(f: ReturnType<typeof setup>, code: string) {
  await expect(f.agent.run(INPUT)).rejects.toBeInstanceOf(AnswerValidationError);
  expect(f.agent.answerNegatives()?.checks.map((row) => row.code)).toContain(code);
  expect(f.agent.answerValidation()?.status).not.toBe('passed');
  expect(f.tokens).toEqual([]);
  expect(f.ends).toEqual([]);
}

function negativeRows(agent: Agent): Record<string, unknown>[] {
  return (agent.findings() ?? []).filter((row): row is typeof row & Record<string, unknown> =>
    ['negative-claim', 'negative-claim-note'].includes(row.kind),
  );
}

describe('negative claims review — dispatch codes', () => {
  for (const mode of MODES) {
    for (const order of ['after', 'same-batch', 'timed-out'] as const) {
      it(`${mode}: a ${order} write pins superseded-by-write`, async () => {
        const f = setup(
          order === 'same-batch'
            ? [{ toolCalls: [READ, WRITE] }, answer()]
            : [{ toolCalls: [READ] }, { toolCalls: [WRITE] }, answer()],
          {
            mode,
            ...(order === 'timed-out' && {
              write: async () => {
                // The service has accepted the write, then its client deadline fires.
                // A timeout says nothing about whether the side effect completed.
                throw new DOMException('Synthetic service deadline exceeded.', 'TimeoutError');
              },
            }),
          },
        );
        await expectWithheld(f, 'superseded-by-write');
        expect(f.read).toHaveBeenCalledTimes(1);
        expect(f.write).toHaveBeenCalledTimes(1);
        expect(f.agent.answerNegatives()?.actions).toContainEqual({
          tool: 'create_incident',
          outcome: order === 'timed-out' ? 'error' : 'ok',
        });
      });
    }

    it(`${mode}: a write before the read does not invalidate a fresh observation`, async () => {
      const f = setup([{ toolCalls: [WRITE] }, { toolCalls: [READ] }, answer('r2')], { mode });
      const output = await f.agent.runTyped<Reply>(INPUT);
      expect(output.negatives[0]?.statement).toContain('found none');
      expect(f.agent.answerNegatives()?.checks.map((row) => row.code)).toEqual(['established']);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(f.read).toHaveBeenCalledTimes(1);
    });
  }

  it('a later failed lookup pins later-read-failed for the earlier empty result', async () => {
    let attempts = 0;
    const f = setup([{ toolCalls: [READ] }, { toolCalls: [READ] }, answer()], {
      read: () => {
        if (++attempts === 2) throw new Error('Synthetic incident store unavailable.');
        return absent({ what: 'incidents', checked: 'declared' });
      },
    });
    await expectWithheld(f, 'later-read-failed');
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it('page two pins search-incomplete even when that page is empty', async () => {
    const f = setup(
      [{ toolCalls: [call('read_incidents', { service: 'payments', page: 2 })] }, answer()],
      { paging: true },
    );
    await expectWithheld(f, 'search-incomplete');
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it('a provider call id is unresolved, with exactly one tools-off correction', async () => {
    const f = setup([{ toolCalls: [READ] }, answer(READ.id), answer(READ.id)]);
    await expectWithheld(f, 'citation-unresolved');
    expect(f.requests).toHaveLength(3);
    expect(f.requests[2]?.tools ?? []).toEqual([]);
    expect(f.requests[2]?.systemPrompt).toContain('internal citation correction');
    expect(f.read).toHaveBeenCalledTimes(1);
  });
});

describe('negative claims review — optional identity and unchecked prose', () => {
  for (const extra of [undefined, 'A search result is attached.']) {
    it(`typed citation discriminators are not prose claims (${
      extra === undefined ? 'only citations' : 'benign summary'
    })`, async () => {
      const f = setup([
        { toolCalls: [READ] },
        answer('r1', extra === undefined ? {} : { summary: extra }),
      ]);
      const output = await f.agent.runTyped<Reply>(INPUT);
      expect(output.negatives[0]?.statement).toContain('found none');
      expect(negativeRows(f.agent)).toEqual([]);
      // Legacy about remains unchecked display text, even without a summary.
      expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
    });
  }

  for (const mode of MODES) {
    it(`${mode}: missing identity starts safely and never verifies an unbound read`, async () => {
      const f = setup([{ toolCalls: [READ] }, answer()], {
        mode,
        bound: false,
        unestablished: 'state-searched',
      });
      const output = await f.agent.runTyped<Reply>({ message: INPUT.message });
      expect(output.negatives[0]?.statement).toContain("I don't know");
      expect(f.agent.answerNegatives()?.checks.map((row) => row.code)).toEqual([
        'outside-trusted-context',
      ]);
      expect(f.agent.answerValidation()?.status).toBe('unverified');
      expect(f.read).toHaveBeenCalledTimes(1);
    });
  }

  for (const placement of ['summary', 'nested'] as const) {
    it(`a broad negative in ${placement} prose files a finding without being presented as checked`, async () => {
      const extra =
        placement === 'summary' ? { summary: OVERCLAIM } : { details: [{ note: OVERCLAIM }] };
      const f = setup([{ toolCalls: [READ] }, answer('r1', extra)]);
      const recording = recordRun(f.agent);
      const output = await f.agent.runTyped<Reply>(INPUT);
      expect(JSON.stringify(output)).toContain(OVERCLAIM);
      expect(f.agent.findings()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'negative-claim',
            field: placement === 'summary' ? '/summary' : '/details/0/note',
          }),
        ]),
      );
      expect(JSON.stringify(negativeRows(f.agent))).not.toContain(OVERCLAIM);
      expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
      expect((await f.agent.assessment())?.standing).toBe('not-sure');
      expect(assessAnswer(recording.toRecording()).standing).toBe('not-sure');
      expect(f.tokens).toEqual([JSON.stringify(output)]);
      expect(f.agent.checkpoint()?.history.at(-1)?.content).toBe(JSON.stringify(output));
      recording.stop();
    });
  }

  it('free model text in about is observed even when it matches the searched population', async () => {
    const raw = JSON.stringify({
      negatives: [{ kind: 'none', about: OVERCLAIM, restsOn: ['r1'] }],
    });
    const f = setup([{ toolCalls: [call('read_incidents', { service: OVERCLAIM })] }, raw]);
    const output = await f.agent.runTyped<Reply>(INPUT);
    expect(output.negatives[0]?.statement).toContain('found none');
    expect(f.agent.answerNegatives()?.checks[0]?.code).toBe('established');
    expect(negativeRows(f.agent)).toEqual([
      expect.objectContaining({ kind: 'negative-claim', field: '/negatives/0/about' }),
    ]);
    expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
    const assessment = await f.agent.assessment();
    expect(assessment?.standing).toBe('not-sure');
    expect(assessment?.reasons.map((row) => row.reason)).toContain('negative-prose-unverified');
  });

  it('a negative phrase in a code block is noted, never silently treated as checked prose', async () => {
    const summary = `\`\`\`text\n${OVERCLAIM}\n\`\`\``;
    const f = setup([{ toolCalls: [READ] }, answer('r1', { summary })]);
    await f.agent.run(INPUT);
    expect(negativeRows(f.agent)).toEqual([
      expect.objectContaining({
        kind: 'negative-claim-note',
        field: '/summary',
        code: 'in-code-block',
      }),
    ]);
    expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
    expect((await f.agent.assessment())?.standing).toBe('not-sure');
  });

  for (const limit of ['text-bytes', 'string-fields', 'claims'] as const) {
    it(`the ${limit} scan limit files one bounded note and no partial prose judgments`, async () => {
      const extra =
        limit === 'text-bytes'
          ? { summary: OVERCLAIM + ' x'.repeat(33_000) }
          : limit === 'string-fields'
          ? { details: Array.from({ length: 257 }, () => ({ note: OVERCLAIM })) }
          : { details: Array.from({ length: 33 }, () => ({ note: OVERCLAIM })) };
      const f = setup([{ toolCalls: [READ] }, answer('r1', extra)]);
      const output = await f.agent.runTyped<Reply>(INPUT);
      expect(output.negatives[0]?.statement).toContain('found none');
      expect(negativeRows(f.agent)).toEqual([
        expect.objectContaining({
          kind: 'negative-claim-note',
          code: limit === 'claims' ? 'too-many-claims' : 'input-limit',
          field: '/',
        }),
      ]);
      expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
      expect((await f.agent.assessment())?.standing).toBe('not-sure');
      expect(f.read).toHaveBeenCalledTimes(1);
    });
  }

  it('32 prose claims across separate fields remain within the whole-answer detection budget', async () => {
    const f = setup([
      { toolCalls: [READ] },
      answer('r1', { details: Array.from({ length: 32 }, () => ({ note: OVERCLAIM })) }),
    ]);
    await f.agent.run(INPUT);
    const rows = negativeRows(f.agent);
    expect(rows).toHaveLength(32);
    expect(rows.every((row) => row.kind === 'negative-claim')).toBe(true);
    expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
  });

  it('a retained earlier-turn prose warning does not become a warning about the current answer', async () => {
    const f = setup([
      { toolCalls: [READ] },
      answer('r1', { summary: OVERCLAIM }),
      { toolCalls: [READ] },
      answer('r2'),
    ]);
    await f.agent.run(INPUT);
    expect(negativeRows(f.agent).some((row) => row.turn === 1)).toBe(true);
    const checkpoint = f.agent.checkpoint();
    expect(checkpoint).toBeDefined();
    await f.agent.runTyped<Reply>({
      ...INPUT,
      message: 'Read the incident store again.',
      continueFrom: checkpoint,
    });
    expect(negativeRows(f.agent).some((row) => row.turn === 1)).toBe(true);
    expect(negativeRows(f.agent).some((row) => row.turn === 2)).toBe(false);
    expect((await f.agent.assessment())?.reasons.map((row) => row.reason)).not.toContain(
      'negative-prose-unverified',
    );
  });
});

describe('negative claims review — buffered cancellation', () => {
  for (const mode of MODES) {
    it(`${mode}: aborting a partial provider draft cannot release it now or after completion`, async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached!: () => void;
      const partialSeen = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let calls = 0;
      let signal: AbortSignal | undefined;
      const provider: LLMProvider = {
        name: 'buffered-cancellation-review',
        complete: async () => {
          throw new Error('Expected streaming provider path.');
        },
        async *stream(request) {
          const first = ++calls === 1;
          if (!first) {
            signal = request.signal;
            yield { tokenIndex: 0, content: 'REJECTED-PARTIAL-DRAFT', done: false };
            reached();
            await held;
          }
          yield {
            tokenIndex: first ? 0 : 1,
            content: '',
            done: true,
            response: {
              content: first ? '' : answer(),
              toolCalls: first ? [READ] : [],
              usage: { input: 1, output: 1 },
              stopReason: first ? 'tool_use' : 'stop',
            },
          };
        },
      };
      const f = setup([], { mode, provider });
      const controller = new AbortController();
      const reason = new Error('Synthetic caller cancellation.');
      const running = f.agent.run(INPUT, { signal: controller.signal });
      running.catch(() => undefined);
      await partialSeen;
      controller.abort(reason);
      try {
        // After a real read, the runner may wrap cancellation with its recovery checkpoint.
        await expect(running).rejects.toThrow(reason.message);
        expect(signal?.aborted).toBe(true);
      } finally {
        release();
      }
      for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.tokens).toEqual([]);
      expect(f.ends).toEqual([]);
      expect(JSON.stringify(f.agent.checkpoint()?.history ?? [])).not.toContain(
        'REJECTED-PARTIAL-DRAFT',
      );
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
    });
  }

  it('a hosted slow consumer receives only the final canonical answer once it drains', async () => {
    const canary = 'UNDELIVERED-SLOW-CONSUMER-DRAFT';
    const f = setup([
      { toolCalls: [READ] },
      answer('r999', { summary: canary }),
      answer('r1', { summary: 'Search completed.' }),
    ]);
    const handler = streamHandler({
      agent: () => f.agent,
      adapter: agUi(),
      threads: {
        bind: ({ conversation }) => ({ sessionId: conversation, identity: IDENTITY }),
      },
      heartbeatMs: 0,
    });
    const response = await handler(
      new Request('http://localhost/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: 'slow-review',
          runId: 'synthetic',
          messages: [{ id: 'person', role: 'user', content: INPUT.message }],
          tools: [],
          context: [],
        }),
      }),
    );
    // Deliberately let the full turn settle before pulling any transport bytes.
    await vi.waitFor(() => expect(f.ends).toHaveLength(1));
    const wire = await response.text();
    const events = wire
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice(6)) as { type: string; delta?: string });
    const deltas = events
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => event.delta);
    expect(wire).not.toContain(canary);
    expect(deltas).toEqual(f.tokens);
    expect(deltas).toHaveLength(1);
    expect(JSON.parse(deltas[0]!).negatives[0].statement).toContain('found none');
    expect(events.at(-1)?.type).toBe('RUN_FINISHED');
    expect(f.read).toHaveBeenCalledTimes(1);
  });
});
