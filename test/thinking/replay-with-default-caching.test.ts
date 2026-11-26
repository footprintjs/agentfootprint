/**
 * Saved thinking is checked against what was sent, not against the cache
 * marks (finding r3-59-adapters-llm-1).
 *
 * WHY: with default caching, `anthropicCacheWire.ts · applyCacheMarkers` turns
 * a string turn into a one-block array to carry `cache_control`. The thinking
 * replay binding used to digest that MARKED body, while the check
 * (`anthropicThinkingReplay.ts · inconsistency`) re-projects the history with
 * no marks — so the two never matched on the models that bind thinking to the
 * prefix. An agent with thinking and a tool stopped before its second call
 * with `UnsafeThinkingReplayError: prefix-changed`, and a completed thinking
 * turn was dropped from the next request for that same false reason.
 *
 * What this exercises: a real `Agent` (default options, so caching is ON)
 * through the package's own `anthropic()` adapter, over a stub SDK client that
 * keeps every wire body and answers from a script — both the streaming path
 * (what an agent uses by default) and `complete`. The adapter, the cache
 * decision, the replay check and the binding are all the shipped code; only
 * the SDK client is scripted. What only a real model call would show: that
 * Anthropic's server accepts these replayed signatures (the stub signatures
 * are not real ones) — this test proves the library no longer refuses or
 * drops them on its own false reading.
 *
 * Records saved before the fix still pass: `fixtures/replay-records.main.json`
 * was made with main's code (the commit it names in `producedBy`) — each
 * saved assistant turn, the request it answered and the request that replays
 * it, for every shape that passed the check there (no marks; system and tools
 * marked; the tail mark on a tool result or an assistant turn), plus whole
 * caching-off agent checkpoints. Only a turn whose binding digested a mark
 * that rewrote a string turn changes; none of those ever passed.
 *
 * Test type: integration (the real agent loop) / regression / compatibility.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent, checkInApproved, defineTool, isCheckInPause } from '../../src/index.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { prepareAnthropicReplay } from '../../src/adapters/llm/anthropicThinkingReplay.js';
import type { CacheMarker, CacheStrategy } from '../../src/cache/types.js';
import { RunCheckpointError, type AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';
import { recordRun } from '../../src/doors/observe.js';
import { defineFact } from '../../src/injection-engine.js';
import { receiptAt, servedAt } from '../../src/time-travel/servedView.js';

/** The models whose table row sets `thinkingPrefixBinding` (anthropicModels.ts). */
const BOUND = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];

type Block = Record<string, unknown> & { type: string };
type Body = {
  messages: { role: string; content: string | Block[] }[];
  tools?: readonly { readonly name: string }[];
};
type ScriptReply =
  | 'tool'
  | 'text'
  | 'outage'
  | {
      readonly text?: string;
      readonly toolUse?: true;
      readonly toolInput?: Readonly<Record<string, unknown>>;
      readonly stopReason?: 'max_tokens';
    };

/** A stub SDK client: keeps every body and can sign each scripted reply as `sig-<n>`. */
function scriptedClient(
  model: string,
  bodies: Body[],
  script: readonly ScriptReply[],
  signed = true,
) {
  let n = 0;
  const reply = (params: Body) => {
    bodies.push(JSON.parse(JSON.stringify(params)) as Body);
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    if (step === 'outage') throw new Error('offline fixture transport unavailable');
    const detail = typeof step === 'object' ? step : undefined;
    const useTool = step === 'tool' || detail?.toolUse === true || detail?.toolInput !== undefined;
    const text = step === 'text' ? `answer ${n}` : detail?.text;
    const content: Block[] = signed
      ? [{ type: 'thinking', thinking: `reasoning ${n}`, signature: `sig-${n}` }]
      : [];
    if (text !== undefined) content.push({ type: 'text', text });
    if (useTool)
      content.push({
        type: 'tool_use',
        id: `toolu_${n}`,
        name: 'lookup',
        input: detail?.toolInput ?? { key: `k${n}` },
      });
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: useTool ? 'tool_use' : detail?.stopReason ?? 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return {
    messages: {
      create: async (params: Body) => reply(params),
      stream: (params: Body) => {
        const message = reply(params);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'message_start',
              message: { ...message, content: [], stop_reason: null },
            };
            for (const [index, block] of message.content.entries()) {
              yield {
                type: 'content_block_start',
                index,
                content_block: block.type === 'tool_use' ? { ...block, input: {} } : block,
              };
              if (block.type === 'tool_use')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
                };
              if (block.type === 'text')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'text_delta', text: block.text },
                };
              yield { type: 'content_block_stop', index };
            }
            yield {
              type: 'message_delta',
              delta: { stop_reason: message.stop_reason },
              usage: message.usage,
            };
            yield { type: 'message_stop' };
          },
          finalMessage: async () => message,
        };
      },
    },
  };
}

const lookup = defineTool<{ key: string }, string>({
  name: 'lookup',
  description: 'Look a key up in the reference table.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `value of ${key}`,
});

function setup(model: string, mode: 'stream' | 'complete', script: readonly ScriptReply[]) {
  const bodies: Body[] = [];
  const real = anthropic({ _client: scriptedClient(model, bodies, script) as never });
  // `complete` mode: the same adapter without `stream`, so the agent calls `complete`.
  const provider: LLMProvider =
    mode === 'stream' ? real : (({ stream: _stream, ...rest }) => rest)(real);
  // Default options: no `caching` key, so the cache strategy marks the wire.
  const agent = Agent.create({ provider, model, maxIterations: 5 })
    .system('You answer questions about the reference table. Use the lookup tool.')
    .tool(lookup)
    .thinking({ budget: 2048 })
    .build();
  return { agent, bodies };
}

function wireBlocks(body: Body): Block[] {
  return body.messages.flatMap((m) =>
    typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content,
  );
}

/** Every thinking signature the body replays, in wire order. */
function replayedSignatures(body: Body): string[] {
  return wireBlocks(body)
    .filter((block) => block.type === 'thinking')
    .map((block) => String(block.signature));
}

describe('signed tool turns with native context features', () => {
  const model = 'claude-sonnet-5-5';

  it.each([false, true])(
    'finishes the evidence guard revision after a signed tool call (findings: %s)',
    async (findings) => {
      const bodies: Body[] = [];
      const corrected = 'The lookup returned a value.';
      const provider = anthropic({
        _client: scriptedClient(model, bodies, [
          'tool',
          { text: 'The lookup found 98765 objects.' },
          { text: corrected },
        ]) as never,
      });
      const builder = Agent.create({ provider, model, maxIterations: 5 })
        .system('Answer from the lookup result.')
        .tool(lookup)
        .namesAndNumbersFromEvidence({ posture: 'guard' });
      if (findings)
        builder.inputsLayer().findings({ answerAsk: 'quote-facts', argumentSources: true });
      const agent = builder.build();
      const actions: string[] = [];
      agent.on('agentfootprint.agent.evidence_checked', (event) => {
        actions.push(event.payload.action);
      });

      try {
        expect(await agent.run({ message: 'What did the lookup return?' })).toBe(corrected);
        expect(actions).toEqual(['revision-asked', 'grounded']);
        expect(bodies).toHaveLength(3);
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each(['verified end', 'unknown end', 'protected end'] as const)(
    'keeps enforcing evidence revisions tools-off after a %s',
    async (end) => {
      const bodies: Body[] = [];
      const rejected = '{"count":98765}';
      const corrected = '{"count":12345}';
      const lookups: string[] = [];
      const provider = anthropic({
        _client: scriptedClient(model, bodies, [
          'tool',
          { text: rejected, ...(end === 'unknown end' && { stopReason: 'max_tokens' as const }) },
          { text: corrected, toolUse: true },
        ]) as never,
      });
      const agent = Agent.create({
        provider,
        model,
        maxIterations: 5,
        ...(end === 'protected end' && {
          redact: { keys: ['llmLatestContent', 'evidenceRecovery', 'systemPromptText'] },
        }),
      })
        .system('Use the lookup tool and answer from its result.')
        .thinking({ budget: 2048 })
        .tool({
          ...lookup,
          execute: async ({ key }) => {
            lookups.push(key);
            return 'The lookup found 12345 objects.';
          },
        })
        .outputSchema({
          parse(value: unknown): { count: number } {
            if (
              !value ||
              typeof value !== 'object' ||
              !('count' in value) ||
              typeof value.count !== 'number'
            )
              throw new Error('Expected a numeric count.');
            return { count: value.count };
          },
        })
        .namesAndNumbersFromEvidence({ posture: 'guard' })
        .answerValidation<{ count: number }>({
          id: 'lookup-count',
          version: '1',
          mode: 'enforce',
          agentChecks: ['names-and-numbers'],
          validate: () => ({ checks: [{ id: 'lookup-count', disposition: 'checked-pass' }] }),
        })
        .build();
      const actions: string[] = [];
      const recording = recordRun(agent);
      const capturedContext: unknown[] = [];
      agent.on('agentfootprint.context.recorded', (event) => capturedContext.push(event.payload));
      agent.on('agentfootprint.agent.evidence_checked', (event) => {
        actions.push(event.payload.action);
      });

      try {
        const run = agent.run({ message: 'How many objects did the lookup find?' });
        if (end === 'unknown end') {
          // The draft that stopped at max_tokens is kept off the wire, so the
          // newest signed reasoning on it is the first response's, still in its
          // open tool turn. Its own baseline names what the revision changed,
          // where the adapter's guard used to say only `prefix-changed`.
          await expect(run).rejects.toMatchObject({
            code: 'CONTEXT_CHANGED_IN_TURN',
            changes: [
              { slot: 'system-prompt', change: 'added', source: 'evidence-recovery' },
              { slot: 'tools', change: 'removed', tool: 'lookup' },
            ],
          });
          expect(bodies).toHaveLength(2);
          expect(lookups).toEqual(['k1']);
          return;
        }
        expect(await run).toBe(corrected);
        expect(actions).toEqual(['revision-asked', 'grounded']);
        expect(bodies).toHaveLength(3);
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        expect(bodies[0]!.tools?.map((tool) => tool.name)).toContain('lookup');
        expect(bodies[1]!.tools?.map((tool) => tool.name)).toContain('lookup');
        expect(bodies[2]!.tools ?? []).toEqual([]);
        expect(lookups).toEqual(['k1']);
        const assistantHistory = agent
          .checkpoint()!
          .history.filter((turn) => turn.role === 'assistant');
        expect(assistantHistory.map((turn) => turn.content)).not.toContain(rejected);
        expect(receiptAt(agent.getLastSnapshot(), 3)?.messages.requestOnly).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', reason: 'native-turn-end' }),
          ]),
        );
        const gap = servedAt(agent.getLastSnapshot(), 3)?.gaps.find(
          (entry) => entry.gap === 'thinking-replay',
        );
        expect(gap?.fields).toContain('messages.requestOnly');
        expect(gap?.why).toContain('cannot be reconstructed');
        if (end === 'protected end') {
          expect(JSON.stringify(recording.toRecording())).not.toContain(rejected);
          expect(JSON.stringify(capturedContext)).not.toContain(rejected);
        }
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each([false, true])('serves a later findings classification (signed: %s)', async (signed) => {
    const bodies: Body[] = [];
    const deliveredArgs: { key: string }[] = [];
    const resolvedModel = signed ? model : 'claude-3-5-haiku-20241022';
    const firstInput = { key: 'k1', _findings: { basis: 'direct' } };
    const secondInput = {
      key: 'k2',
      _findings: { basis: 'direct', previous: [{ toolCallId: 'toolu_1', standing: 'noise' }] },
    };
    const provider = anthropic({
      _client: scriptedClient(
        resolvedModel,
        bodies,
        [{ toolInput: firstInput }, { toolInput: secondInput }, 'text'],
        signed,
      ) as never,
    });
    const builder = Agent.create({ provider, model: resolvedModel, maxIterations: 5 })
      .system('Use the lookup tool to answer.')
      .tool({
        ...lookup,
        execute: async (args) => {
          deliveredArgs.push(args);
          return `value of ${args.key}`;
        },
      })
      .inputsLayer()
      .findings({ answerAsk: 'quote-facts', argumentSources: true });
    if (signed) builder.thinking({ budget: 2048 });
    const agent = builder.build();

    try {
      expect(await agent.run({ message: 'What are k1 and k2?' })).toBe('answer 3');
      expect(bodies).toHaveLength(3);
      expect(replayedSignatures(bodies[1]!)).toEqual(signed ? ['sig-1'] : []);
      expect(replayedSignatures(bodies[2]!)).toEqual(signed ? ['sig-1', 'sig-2'] : []);
      expect(deliveredArgs).toEqual([{ key: 'k1' }, { key: 'k2' }]);

      const second = wireBlocks(bodies[1]!);
      const third = wireBlocks(bodies[2]!);
      const rawInputs = (blocks: Block[]) =>
        blocks
          .filter((block) => block.type === 'tool_use')
          .map((block) => JSON.stringify(block.input));
      expect(rawInputs(second)).toEqual([JSON.stringify(firstInput)]);
      expect(rawInputs(third)).toEqual([JSON.stringify(firstInput), JSON.stringify(secondInput)]);
      const firstResult = (blocks: Block[]) =>
        blocks.find((block) => block.type === 'tool_result' && block.tool_use_id === 'toolu_1')
          ?.content;
      expect(firstResult(second)).toBe('value of k1');
      expect(firstResult(third)).toBe(
        signed ? 'value of k1' : '{"collapsed":true,"standing":"noise","toolCallId":"toolu_1"}',
      );

      const dataPrefix = '[AgentFootprint findings DATA v1]\n';
      const frame = third
        .map((block) => block.text)
        .filter((text) => typeof text === 'string' && text.startsWith(dataPrefix))
        .at(-1);
      if (typeof frame !== 'string')
        throw new Error('Expected findings DATA on the third request.');
      expect(JSON.parse(frame.slice(dataPrefix.length))).toMatchObject({
        data: { noise: ['toolu_1'] },
      });
      expect(
        agent.checkpoint()!.history.find((turn) => turn.toolCallId === 'toolu_1')?.content,
      ).toBe('value of k1');
    } finally {
      await agent.shutdown();
    }
  });

  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'remaps the cache marker after restoring request-only lines in %s',
    async (reactMode) => {
      const bodies: Body[] = [];
      const candidates: Array<{
        messages: readonly LLMMessage[];
        markers: readonly CacheMarker[];
      }> = [];
      const fact = 'A cacheable fixture delivery.';
      const provider = anthropic({
        _client: scriptedClient(model, bodies, [
          { toolInput: { key: 'k1', _findings: { basis: 'direct' } } },
          { toolInput: { key: 'k2', _findings: { basis: 'direct' } } },
          'text',
        ]) as never,
      });
      const cacheStrategy: CacheStrategy = {
        name: 'observe-fixture',
        async prepareRequest(request, markers) {
          candidates.push({ messages: request.messages, markers });
          return { request, markersApplied: [] };
        },
        extractMetrics: () => ({ kind: 'notApplicable', reason: 'fixture' }),
      };
      const agent = Agent.create({ provider, model, cacheStrategy, reactMode, maxIterations: 5 })
        .system('Use the lookup tool to answer.', { cache: 'always' })
        .tool(lookup)
        .fact(
          defineFact({
            id: 'cache-fixture',
            data: fact,
            slot: 'messages',
            role: 'assistant',
            activeWhen: ({ iteration }) => iteration >= 3,
          }),
        )
        .inputsLayer()
        .findings({ answerAsk: 'quote-facts', argumentSources: true })
        .thinking({ budget: 2048 })
        .build();
      const recorder = recordRun(agent, { boundaryDetail: 'full' });
      try {
        expect(await agent.run({ message: 'What are k1 and k2?' })).toBe('answer 3');
        expect(replayedSignatures(bodies[2]!)).toEqual(['sig-1', 'sig-2']);
        expect(candidates).toHaveLength(3);
        const cache = recorder.boundary
          .getBoundaries()
          .filter((event) => event.type === 'subflow.exit' && event.localSubflowId === 'sf-cache')
          .at(-1);
        const payload = cache?.payload as { cacheMarkers?: readonly CacheMarker[] } | undefined;
        const raw = payload?.cacheMarkers?.find(({ field }) => field === 'messages');
        const { messages, markers } = candidates[2]!;
        const wirePosition = messages.findIndex(({ content }) => content === fact);
        expect(wirePosition).toBeGreaterThan(0);
        expect(raw).toBeDefined();
        expect(wirePosition).toBeGreaterThan(raw!.boundaryIndex);
        expect(markers.find(({ field }) => field === 'messages')).toEqual({
          ...raw,
          boundaryIndex: wirePosition,
        });
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );

  it('refuses to reconstruct a signed prefix after a host changes request messages', async () => {
    const bodies: Body[] = [];
    const provider = anthropic({
      _client: scriptedClient(model, bodies, ['tool', 'text']) as never,
    });
    const rewritten = 'The cache strategy rewrote the request.';
    const cacheStrategy: CacheStrategy = {
      name: 'prefix-rewrite',
      prepareRequest: async (request) => ({
        request: {
          ...request,
          messages: request.messages.map((message, index) =>
            index === 0 ? { ...message, content: rewritten } : message,
          ),
        },
        markersApplied: [],
      }),
      extractMetrics: () => ({ kind: 'notApplicable', reason: 'fixture' }),
    };
    const agent = Agent.create({ provider, model, cacheStrategy, maxIterations: 5 })
      .system('Use the lookup tool to answer.')
      .tool(lookup)
      .inputsLayer()
      .findings({ answerAsk: 'quote-facts', argumentSources: true })
      .thinking({ budget: 2048 })
      .build();
    try {
      // The agent's own check names the edit before the adapter's guard: the
      // library's request-only line can no longer be restored ahead of the
      // signed turn, so the signed request's second message is not where it was.
      await expect(agent.run({ message: 'What is k1?' })).rejects.toMatchObject({
        code: 'CONTEXT_CHANGED_IN_TURN',
        changes: [{ slot: 'messages', change: 'changed', position: 1 }],
      });
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.messages[0]!.content).toBe(rewritten);
    } finally {
      await agent.shutdown();
    }
  });

  it.each([false, true])(
    'replays a signed tool call made during evidence revision (field redaction: %s)',
    async (protectedDraft) => {
      const bodies: Body[] = [];
      const lookups: string[] = [];
      const rejected = 'The lookup found 98765 objects.';
      const corrected = 'The lookup found 12345 objects.';
      const provider = anthropic({
        _client: scriptedClient(model, bodies, [
          'tool',
          { text: rejected },
          'tool',
          { text: corrected },
        ]) as never,
      });
      const agent = Agent.create({
        provider,
        model,
        maxIterations: 5,
        ...(protectedDraft && { redact: { fields: { evidenceRecovery: ['instruction'] } } }),
      })
        .system('Use the lookup tool to answer.')
        .tool({
          ...lookup,
          execute: async ({ key }) => {
            lookups.push(key);
            return key === 'k3' ? corrected : 'The count was not available yet.';
          },
        })
        .thinking({ budget: 2048 })
        .namesAndNumbersFromEvidence({ posture: 'guard' })
        .build();
      const actions: string[] = [];
      agent.on('agentfootprint.agent.evidence_checked', (event) => {
        actions.push(event.payload.action);
      });

      try {
        expect(await agent.run({ message: 'How many objects did the lookup find?' })).toBe(
          corrected,
        );
        expect(actions).toEqual(['revision-asked', 'grounded']);
        expect(lookups).toEqual(['k1', 'k3']);
        expect(bodies).toHaveLength(4);
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        expect(replayedSignatures(bodies[3]!)).toContain('sig-3');
        expect(JSON.stringify(bodies[3]!.messages)).toContain(rejected);
        if (protectedDraft) {
          const saved = agent.getLastSnapshot()?.sharedState;
          expect(JSON.stringify(saved?.requestReplay ?? null)).not.toContain(rejected);
        }
        const assistantHistory = agent
          .checkpoint()!
          .history.filter((turn) => turn.role === 'assistant');
        expect(assistantHistory.map((turn) => turn.content)).not.toContain(rejected);
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each([false, true])(
    'keeps findings across native pause and JSON reload (protected: %s)',
    async (protectedHistory) => {
      const bodies: Body[] = [];
      const provider = anthropic({
        _client: scriptedClient(model, bodies, ['tool', 'text']) as never,
      });
      const heldLookup = defineTool<{ key: string }, string>({
        name: 'lookup',
        description: 'Look a key up in the reference table.',
        inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
        checkIn: 'always',
        execute: async ({ key }) => `value of ${key}`,
      });
      const agent = Agent.create({
        provider,
        model,
        maxIterations: 5,
        ...(protectedHistory && { redact: { keys: ['history', 'findingsLedger'] } }),
      })
        .system('Use the lookup tool to answer.')
        .tool(heldLookup)
        .inputsLayer()
        .findings({ answerAsk: 'quote-facts', argumentSources: true })
        .build();
      try {
        const paused = await agent.run({ message: 'Look up the object.' });
        if (!isCheckInPause(paused)) throw new Error('Expected a native check-in');
        const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
        const answer = await agent.resume(
          checkpoint,
          checkInApproved({ request: paused.checkIn, by: 'fixture' }),
        );
        expect(answer).toBe('answer 2');
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each([false, true])(
    'restores signed findings after a transport failure and JSON checkpoint reload (protected: %s)',
    async (protectedHistory) => {
      const bodies: Body[] = [];
      const lookups: string[] = [];
      const provider = anthropic({
        _client: scriptedClient(model, bodies, ['tool', 'outage', 'text']) as never,
      });
      const buildAgent = () =>
        Agent.create({
          provider,
          model,
          maxIterations: 5,
          ...(protectedHistory && { redact: { keys: ['history', 'findingsLedger'] } }),
        })
          .system('Use the lookup result to answer.')
          .tool({
            ...lookup,
            execute: async ({ key }) => {
              lookups.push(key);
              return `value of ${key}`;
            },
          })
          .inputsLayer()
          .findings({ answerAsk: 'quote-facts', argumentSources: true })
          .build();
      const agent = buildAgent();
      let checkpoint: AgentRunCheckpoint;
      try {
        const failure = await agent
          .run({ message: 'Look up the object.' })
          .catch((error: unknown) => error);
        if (!(failure instanceof RunCheckpointError))
          throw new Error('Expected a recoverable provider error');
        checkpoint = JSON.parse(JSON.stringify(failure.checkpoint)) as AgentRunCheckpoint;
        expect(checkpoint.history.find((entry) => entry.toolCallId === 'toolu_1')?.content).toBe(
          'value of k1',
        );
        expect(lookups).toEqual(['k1']);
        expect(bodies).toHaveLength(2);
        if (protectedHistory) {
          const snapshot = agent.getLastSnapshot();
          expect(snapshot).toBeDefined();
          expect(JSON.stringify(snapshot)).not.toContain('[AgentFootprint findings DATA v1]');
        }
      } finally {
        await agent.shutdown();
      }

      const resumed = buildAgent();
      try {
        const frame = checkpoint.requestReplay?.[0];
        if (frame === undefined || !('id' in frame))
          throw new Error('Expected a signed replay frame.');
        await expect(
          resumed.resumeOnError({ ...checkpoint, requestReplay: { frames: [frame] } }),
        ).rejects.toThrow(TypeError);
        await expect(
          resumed.resumeOnError({
            ...checkpoint,
            requestReplay: [{ ...frame, id: 'a-different-provider-response' }],
          }),
        ).rejects.toThrow(TypeError);
        expect(lookups).toEqual(['k1']);
        expect(bodies).toHaveLength(2);

        expect(await resumed.resumeOnError(checkpoint)).toBe('answer 3');
        expect(lookups).toEqual(['k1']);
        expect(bodies).toHaveLength(3);
        expect(replayedSignatures(bodies[2]!)).toEqual(['sig-1']);
        const resultOnResume = wireBlocks(bodies[2]!).find(
          (block) => block.type === 'tool_result' && block.tool_use_id === 'toolu_1',
        );
        expect(resultOnResume?.content).toBe('value of k1');
      } finally {
        await resumed.shutdown();
      }
    },
  );

  it('appends guard feedback when the native provider did not report completion', async () => {
    const bodies: Body[] = [];
    const provider = anthropic({
      _client: scriptedClient(model, bodies, [
        'tool',
        { text: 'I found 98765 objects.', stopReason: 'max_tokens' },
        { text: 'I can report the lookup result.' },
      ]) as never,
    });
    const agent = Agent.create({ provider, model, maxIterations: 5 })
      .system('Use the lookup tool to answer.')
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    try {
      expect(await agent.run({ message: 'How many objects did the lookup find?' })).toBe(
        'I can report the lookup result.',
      );
      expect(bodies).toHaveLength(3);
      expect(replayedSignatures(bodies[2]!)).toEqual(['sig-1']);
      expect(JSON.stringify(bodies[2]!.messages.at(-1))).toContain(
        'AgentFootprint internal recovery feedback',
      );
    } finally {
      await agent.shutdown();
    }
  });
});

describe.each(['stream', 'complete'] as const)(
  'saved thinking under default caching — %s (r3-59-adapters-llm-1)',
  (mode) => {
    it.each(BOUND)(
      '%s: thinking and a tool complete a second and a third model call',
      async (model) => {
        const { agent, bodies } = setup(model, mode, ['tool', 'tool', 'text']);
        expect(await agent.run({ message: 'What are k1 and k2?' })).toBe('answer 3');
        expect(bodies).toHaveLength(3);
        // The precondition the finding needs: default caching marked the first
        // user turn, turning its string into a one-block array.
        const firstUser = bodies[0]!.messages[0]!.content as Block[];
        expect(Array.isArray(firstUser)).toBe(true);
        expect(firstUser.at(-1)).toHaveProperty('cache_control');
        // Each later call replays every earlier signed thinking block — none
        // was refused or dropped.
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        expect(replayedSignatures(bodies[2]!)).toEqual(['sig-1', 'sig-2']);
      },
    );

    it.each(BOUND)(
      '%s: a completed thinking turn is kept in the next request, not retired',
      async (model) => {
        const { agent, bodies } = setup(model, mode, ['text', 'text']);
        expect(await agent.run({ message: 'What is k1?' })).toBe('answer 1');
        expect(await agent.followUp('And k2?')).toBe('answer 2');
        expect(bodies).toHaveLength(2);
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        const first = agent.checkpoint()!.history.find((m) => m.role === 'assistant')!;
        expect(first.replay?.thinkingRetired).toBeUndefined();
        expect(first.thinkingBlocks?.map((b) => b.signature)).toEqual(['sig-1']);
      },
    );
  },
);

// ─── Records saved on main ──────────────────────────────────────────

interface MainRecord {
  readonly model: string;
  readonly scenario: string;
  readonly request: LLMRequest;
  readonly record: LLMMessage;
  readonly next: LLMRequest;
  readonly mainVerdict: string;
}
const MAIN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/replay-records.main.json'), 'utf8'),
) as {
  readonly records: readonly MainRecord[];
  readonly checkpoints: readonly {
    readonly model: string;
    readonly checkpoint: AgentRunCheckpoint;
  }[];
};

/** The SDK reply main's generator scripted for this record, rebuilt from the record itself. */
function replyFor(r: MainRecord) {
  const n = Number(/^msg_main_(\d+)$/.exec(r.record.replay!.id!)![1]);
  const tool = (r.record.toolCalls?.length ?? 0) > 0;
  return {
    id: `msg_main_${n}`,
    type: 'message',
    role: 'assistant',
    model: r.model,
    content: [
      { type: 'thinking', thinking: `reasoning ${n}`, signature: `main-sig-${n}` },
      tool
        ? { type: 'tool_use', id: `toolu_main_${n}`, name: 'lookup', input: { key: `k${n}` } }
        : { type: 'text', text: `answer ${n}` },
    ],
    stop_reason: tool ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('records saved on main still pass (r3-59-adapters-llm-1)', () => {
  it('the fixture covers every bound model and only records main passed', () => {
    expect(new Set(MAIN.records.map((r) => r.model))).toEqual(new Set(BOUND));
    expect(MAIN.records.every((r) => r.mainVerdict === 'passes')).toBe(true);
  });

  it.each(MAIN.records.map((r) => [r.model, r.scenario, r] as const))(
    '%s %s: the saved turn is replayed, not refused or retired',
    (model, _scenario, r) => {
      const prepared = prepareAnthropicReplay(r.next, model, 'anthropic');
      expect(prepared.omissions).toEqual([]);
      expect(prepared.request).toBe(r.next);
    },
  );

  it.each(MAIN.records.map((r) => [r.model, r.scenario, r] as const))(
    '%s %s: the same call today saves the same binding',
    async (_model, _scenario, r) => {
      const sdk = { messages: { create: async () => replyFor(r) } };
      const provider = anthropic({ _client: sdk as never });
      const answer = await provider.complete(JSON.parse(JSON.stringify(r.request)));
      expect(JSON.parse(JSON.stringify(answer.replay))).toEqual(r.record.replay);
    },
  );

  it.each(MAIN.checkpoints.map((c) => [c.model, c] as const))(
    '%s: a caching-off conversation saved on main continues under default caching',
    async (model, c) => {
      const { agent, bodies } = setup(model, 'stream', ['tool', 'text']);
      const answer = await agent.run({
        message: 'And k2?',
        continueFrom: JSON.parse(JSON.stringify(c.checkpoint)),
      });
      expect(answer).toBe('answer 2');
      expect(replayedSignatures(bodies[0]!)).toEqual(['agent-sig-1', 'agent-sig-2']);
      expect(replayedSignatures(bodies[1]!)).toEqual(['agent-sig-1', 'agent-sig-2', 'sig-1']);
    },
  );
});
