import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  RunCheckpointError,
  isPaused,
  type AgentfootprintEvent,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../../../src/index.js';
import { recordRun } from '../../../../src/observe.js';
import { conversationRedaction } from '../../../../src/doors/security.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { stripFrameworkFields } from '../../../../src/core/agent/composeRequest.js';
import { readCallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';
import {
  mockAnthropicRaw,
  mockThinkingHandler,
} from '../../../../src/thinking/MockThinkingHandler.js';
import type { MessageReplay } from '../../../../src/thinking/replay.js';
import { TOOL, VM, QUESTION, jsonCopy } from './sourceCorrectionHarness.js';

const block = {
  type: 'thinking' as const,
  content: 'synthetic-replay-block',
  signature: 'opaque-exact-signature',
};
const replay: MessageReplay = {
  version: 1,
  protocol: 'anthropic-messages',
  id: 'synthetic-replay',
  layout: [
    { type: 'thinking', index: 0 },
    { type: 'tool', index: 0 },
    { type: 'tool', index: 1 },
  ],
  stopReason: 'tool_use',
  contentDigest: 'opaque-provider-digest',
};
const response = (content: string, extra: Partial<LLMResponse> = {}): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 0, output: 0 },
  stopReason: 'end_turn',
  ...extra,
});
const first = response('', {
  rawThinking: mockAnthropicRaw([block]),
  replay,
  toolCalls: [
    { id: 'held', name: TOOL, args: { vm: VM } },
    {
      id: 'private-sibling',
      name: TOOL,
      args: { vm: VM, _findings: { from: [{ argument: 'vm', source: 'user', quote: QUESTION }] } },
    },
  ],
});
function fixture(
  mode: 'dynamic' | 'dynamic-grouped',
  replies: readonly (LLMResponse | Error)[],
  callerPolicy = false,
) {
  const requests: LLMRequest[] = [],
    events: AgentfootprintEvent[] = [];
  let executions = 0;
  const provider: LLMProvider = {
    name: 'synthetic-serving',
    thinkingHandler: mockThinkingHandler,
    async complete(request) {
      requests.push(jsonCopy(request));
      const next = replies[requests.length - 1];
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('Synthetic replies exhausted');
      return next;
    },
  };
  const tool = defineTool({
    name: TOOL,
    description: 'Read one synthetic VM.',
    inputSchema: { type: 'object', required: ['vm'], properties: { vm: { type: 'string' } } },
    askOrAssume: { vm: { ask: 'Which VM?' } },
    execute: () => {
      executions++;
      return [];
    },
  });
  const hidden = {
    ...tool,
    [SHOWN_ARGS]: (args: Record<string, unknown>) => ({ ...args, vm: 'REDACTED' }),
  };
  const agent = Agent.create({
    provider,
    model: 'fixture',
    reactMode: mode,
    ...(callerPolicy && { redact: conversationRedaction() }),
  })
    .tool(hidden)
    .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
    .build();
  agent.on('*', (event) => events.push(jsonCopy(event)));
  const recorder = recordRun(agent);
  return { agent, requests, events, recorder, executions: () => executions };
}
function proposal(history: readonly LLMMessage[] | undefined) {
  return history?.find(
    (message) =>
      message.role === 'assistant' && message.toolCalls?.some((call) => call.id === 'held'),
  );
}

function proposalKeys(message: LLMMessage | undefined) {
  return message?.toolCalls?.map(readCallOccurrenceKey);
}

describe.each(['dynamic', 'dynamic-grouped'] as const)(
  'raw and served correction history in %s',
  (mode) => {
    it.each(['pooled', 'recreated'] as const)(
      'an actual correction→crash→%s restore cannot replenish its allowance',
      async (hosting) => {
        const repeated = response('', {
          toolCalls: [{ id: 'repeat-after-crash', name: TOOL, args: { vm: VM } }],
        });
        const f = fixture(
          mode,
          [first, new Error('Synthetic provider disconnected'), repeated],
          true,
        );
        let recreated: ReturnType<typeof fixture> | undefined;
        try {
          const error = await f.agent.run(QUESTION).catch((value: unknown) => value);
          expect(error).toBeInstanceOf(RunCheckpointError);
          const checkpoint = jsonCopy((error as RunCheckpointError).checkpoint);
          expect(checkpoint.sourceDeclarationCorrection).toEqual({ spent: true });
          const target = hosting === 'pooled' ? f : (recreated = fixture(mode, [repeated], true));
          expect(isPaused(await target.agent.resumeOnError(checkpoint))).toBe(true);
          expect(target.executions()).toBe(0);
          expect(target.agent.findings()).toContainEqual(
            expect.objectContaining({
              kind: 'argument',
              toolCallId: 'repeat-after-crash',
              asked: 'unverified',
              claimed: 'none',
            }),
          );
          expect(target.requests).toHaveLength(hosting === 'pooled' ? 3 : 1);
        } finally {
          f.recorder.stop();
          await f.agent.shutdown();
          recreated?.recorder.stop();
          await recreated?.agent.shutdown();
        }
      },
    );
    it('masks only actual current call views and private framework quotes in the new public event', async () => {
      const f = fixture(mode, [first, response('Done.')]);
      try {
        expect(await f.agent.run(QUESTION)).toBe('Done.');
        expect(f.executions()).toBe(0);
        const ended = f.events.find((event) => event.type === 'agentfootprint.agent.iteration_end');
        const shown = proposal((ended?.payload as { history?: readonly LLMMessage[] }).history);
        expect(shown?.toolCalls?.map((call) => call.id)).toEqual(['held', 'private-sibling']);
        for (const call of shown?.toolCalls ?? []) {
          expect(call.args.vm).toBe('REDACTED');
          expect(call.args).not.toHaveProperty('_findings');
        }
        const raw = proposal(f.agent.checkpoint()?.history);
        expect(raw?.toolCalls?.[0]?.args.vm).toBe(VM);
        expect(raw?.toolCalls?.[1]?.args._findings).toEqual({
          from: [{ argument: 'vm', source: 'user', quote: QUESTION }],
        });
        expect(raw?.thinkingBlocks).toEqual([block]);
        expect(raw?.replay).toEqual(replay);
        if (raw === undefined) throw new Error('Expected a checkpoint proposal');
        const keys = proposalKeys(raw);
        expect(keys).toEqual([expect.any(String), expect.any(String)]);
        expect(new Set(keys).size).toBe(2);
        expect(proposalKeys(shown)).toEqual(keys);
        expect(proposal(f.requests[1]?.messages)).toEqual(stripFrameworkFields([raw])[0]);
        expect(proposalKeys(proposal(f.requests[1]?.messages))).toEqual([undefined, undefined]);
        expect(shown?.replay).toEqual(replay);
      } finally {
        f.recorder.stop();
        await f.agent.shutdown();
      }
    });

    it('keeps raw ordinary/crash checkpoints and fresh same-request replay while caller policy covers all public record channels', async () => {
      const f = fixture(mode, [first, new Error('Synthetic provider disconnected')], true);
      let restored: ReturnType<typeof fixture> | undefined;
      try {
        const error = await f.agent.run(QUESTION).catch((value: unknown) => value);
        expect(error).toBeInstanceOf(RunCheckpointError);
        const checkpoint = (error as RunCheckpointError).checkpoint;
        expect(checkpoint.sourceDeclarationCorrection).toEqual({ spent: true });
        const raw = proposal(checkpoint.history);
        expect(raw?.toolCalls?.[0]?.args.vm).toBe(VM);
        expect(raw?.thinkingBlocks).toEqual([block]);
        expect(raw?.replay).toEqual(replay);
        if (raw === undefined) throw new Error('Expected a crash checkpoint proposal');
        expect(proposalKeys(raw)).toEqual([expect.any(String), expect.any(String)]);
        const wire = stripFrameworkFields([raw])[0];
        expect(proposal(f.agent.checkpoint()?.history)).toEqual(raw);
        expect(proposal(f.requests[1]?.messages)).toEqual(wire);
        expect(proposalKeys(proposal(f.requests[1]?.messages))).toEqual([undefined, undefined]);
        for (const publicValue of [
          f.events,
          f.agent.getSnapshot(),
          f.agent.getLastNarrativeEntries(),
          f.recorder.toRecording(),
        ]) {
          expect(JSON.stringify(publicValue)).not.toContain(VM);
        }
        restored = fixture(mode, [response('Resumed.')], true);
        expect(await restored.agent.resumeOnError(jsonCopy(checkpoint))).toBe('Resumed.');
        expect(proposal(restored.requests[0]?.messages)).toEqual(wire);
        expect(proposal(restored.agent.checkpoint()?.history)).toEqual(raw);
        expect(restored.agent.checkpoint()?.sourceDeclarationCorrection).toEqual({ spent: true });
        expect(restored.executions()).toBe(0);
      } finally {
        f.recorder.stop();
        await f.agent.shutdown();
        restored?.recorder.stop();
        await restored?.agent.shutdown();
      }
    });
  },
);
