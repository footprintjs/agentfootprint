/**
 * Scenario tests — end-to-end pause/resume via Agent tools.
 *
 * Demonstrates the complete round trip:
 *   1. Tool calls pauseHere()
 *   2. Agent.run() returns RunnerPauseOutcome with a serializable checkpoint
 *   3. Consumer serializes checkpoint (JSON-safe test)
 *   4. Agent.resume(checkpoint, humanAnswer) continues the ReAct loop
 *   5. Final answer returns
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { allow, deny } from '../../../src/core/agent/middleware/outcomes.js';
import type { MiddlewareDecision } from '../../../src/core/agent/middleware/types.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

describe('scenario — pause via tool + resume round trip', () => {
  it('pauseHere() produces RunnerPauseOutcome with checkpoint + pauseData', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { action: 'refund $500' } }]),
        resp('approved by user — proceeding'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: (args) => {
          pauseHere({
            question: `Approve ${(args as { action: string }).action}?`,
            risk: 'medium',
          });
          return ''; // unreachable
        },
      })
      .build();

    const result = await agent.run({ message: 'please refund me' });

    expect(isPaused(result)).toBe(true);
    if (!isPaused(result)) return;

    expect(result.pauseData).toMatchObject({
      toolCallId: 't1',
      toolName: 'approve',
      question: 'Approve refund $500?',
      risk: 'medium',
    });
    expect(result.checkpoint.pausedStageId).toBe('tool-calls');
    expect(result.checkpoint.pausedAt).toBeGreaterThan(0);
  });

  it('resume(checkpoint, humanAnswer) returns final answer', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { action: 'delete' } }]),
        resp('user said yes — action taken'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) {
      expect.fail('expected paused outcome');
      return;
    }

    const final = await agent.resume(paused.checkpoint, 'user approved');
    expect(isPaused(final)).toBe(false);
    expect(final).toBe('user said yes — action taken');
  });

  it('checkpoint is JSON-serializable and survives a roundtrip', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ prompt: 'continue?' });
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    // Serialize and deserialize — simulates Redis/Postgres persistence.
    const serialized = JSON.stringify(paused.checkpoint);
    const restored = JSON.parse(serialized);

    const final = await agent.resume(restored, 'yes');
    expect(final).toBe('done');
  });

  it('emits pause.request on pause and pause.resume on resume', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'ask', args: {} }]), resp('done')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'confirm?', reason: 'high-stakes action' });
          return '';
        },
      })
      .build();

    const pauseReqs = vi.fn();
    const pauseResumes = vi.fn();
    agent.on('agentfootprint.pause.request', pauseReqs);
    agent.on('agentfootprint.pause.resume', pauseResumes);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    expect(pauseReqs).toHaveBeenCalledTimes(1);
    expect(pauseReqs.mock.calls[0][0].payload.reason).toBe('high-stakes action');

    await agent.resume(paused.checkpoint, 'ok');
    expect(pauseResumes).toHaveBeenCalledTimes(1);
    expect(pauseResumes.mock.calls[0][0].payload.pausedDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('humanAnswer is surfaced to the LLM as the tool result on resume', async () => {
    const capture = vi.fn();
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async (req) => {
          capture(req.messages);
          const toolMsgs = req.messages.filter((m) => m.role === 'tool');
          if (toolMsgs.length === 0) {
            // First call: request a tool call.
            return resp('', [{ id: 't1', name: 'ask', args: {} }]);
          }
          // After tool result: echo what we saw.
          return resp(`LLM saw tool result: ${toolMsgs[0].content}`);
        },
      },
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({});
          return '';
        },
      })
      .build();

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');

    const final = await agent.resume(paused.checkpoint, 'custom-human-answer');
    expect(final).toBe('LLM saw tool result: custom-human-answer');
  });
});

/**
 * 8.13.0 — the after-tool moment on the RESUME side of a `pauseHere` pause.
 *
 * The tool ran (`pauseHere` throws from inside `execute`), its before-tool chain
 * already walked in the loop, and the value the consumer supplies IS that tool's
 * result — it lands as `role: 'tool'` under the same id and drives
 * `on-tool-return` triggers. Before this release the chain's second half was
 * skipped on that one path, so every `onToolResult` rule — redaction first among
 * them — sat unapplied on the one value a PERSON typed.
 *
 * 7-pattern coverage: integration (the hook fires, once) · security (a redaction
 * rule scrubs a pasted secret) · unit (`deny` withholds it) · property (the
 * ledger row matches the loop path's shape) · edge (no hook anywhere → byte-
 * identical) · regression (a checkpoint with no `pausedToolArgs`).
 */
describe('scenario — the after-tool moment runs on a pauseHere resume (8.13.0)', () => {
  /** An agent whose only tool pauses, plus whatever after-tool rules are given. */
  function pausingAgent(
    afterTool: readonly {
      name: string;
      onToolResult: (call: {
        result: unknown;
        args: Readonly<Record<string, unknown>>;
        toolName: string;
        toolCallId: string;
      }) => unknown;
    }[],
  ) {
    const builder = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'ask_person', args: { topic: 'refund', amount: 500 } }]),
        resp('all done'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'ask_person', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'what should I tell them?' });
          return '';
        },
      });
    return afterTool.length > 0
      ? builder.act({ afterTool: afterTool as never }).build()
      : builder.build();
  }

  it('integration — onToolResult fires exactly once, with the human answer as the result', async () => {
    const calls: { result: unknown; args: unknown; toolName: string; toolCallId: string }[] = [];
    const agent = pausingAgent([
      {
        name: 'watchful',
        onToolResult: (call) => {
          calls.push({
            result: call.result,
            args: call.args,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
          });
          return allow();
        },
      },
    ]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    await agent.resume(paused.checkpoint, 'tell them three business days');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.result).toBe('tell them three business days');
    expect(calls[0]?.toolName).toBe('ask_person');
    expect(calls[0]?.toolCallId).toBe('t1');
    // The args the tool was RUNNING with, carried across the checkpoint.
    expect(calls[0]?.args).toEqual({ topic: 'refund', amount: 500 });
  });

  it('security — a redaction rule scrubs a secret a PERSON pasted into the answer', async () => {
    const agent = pausingAgent([
      {
        name: 'scrub-ssn',
        onToolResult: (call) => {
          const clean = String(call.result).replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
          return clean === call.result ? allow() : allow(clean, 'masked a US SSN');
        },
      },
    ]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    await agent.resume(paused.checkpoint, 'their ssn is 123-45-6789');

    const state = agent.getLastSnapshot()?.sharedState as {
      history: readonly { role: string; content: string }[];
    };
    const toolMsg = state.history.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('their ssn is [ssn]');
    expect(JSON.stringify(state.history)).not.toContain('123-45-6789');
  });

  it('unit — deny() withholds the human answer from the model and says so', async () => {
    const agent = pausingAgent([
      {
        name: 'no-raw-notes',
        onToolResult: () => deny('the operator note is not for the model'),
      },
    ]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    await agent.resume(paused.checkpoint, 'internal: customer is a known fraudster');

    const state = agent.getLastSnapshot()?.sharedState as {
      history: readonly { role: string; content: string }[];
    };
    const toolMsg = state.history.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('the operator note is not for the model');
    expect(JSON.stringify(state.history)).not.toContain('known fraudster');
  });

  it('property — the ledger row has the same shape the loop path files', async () => {
    const agent = pausingAgent([
      { name: 'tagger', onToolResult: (call) => allow(`${String(call.result)} [seen]`, 'tagged') },
    ]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    await agent.resume(paused.checkpoint, 'ok');

    const state = agent.getLastSnapshot()?.sharedState as {
      middlewareDecisions?: readonly MiddlewareDecision[];
    };
    const row = state.middlewareDecisions?.find((d) => d.middleware === 'tagger');
    expect(row).toBeDefined();
    expect(row?.moment).toBe('after-tool');
    expect(row?.at).toBe('tool');
    expect(row?.toolName).toBe('ask_person');
    expect(row?.toolCallId).toBe('t1');
    expect(row?.outcome).toBe('allow');
    expect(row?.changed).toBe(true);
    expect(row?.before).toBe('ok');
    expect(row?.after).toBe('ok [seen]');
  });

  it('edge — no onToolResult anywhere: the resume is byte-identical to before', async () => {
    const agent = pausingAgent([]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    await agent.resume(paused.checkpoint, 'the plain answer');

    const state = agent.getLastSnapshot()?.sharedState as {
      history: readonly { role: string; content: string }[];
      middlewareDecisions?: readonly MiddlewareDecision[];
    };
    expect(state.history.find((m) => m.role === 'tool')?.content).toBe('the plain answer');
    expect(state.middlewareDecisions).toBeUndefined();
  });

  it('regression — a pre-8.13.0 checkpoint has no pausedToolArgs; args come from history', async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    const agent = pausingAgent([
      {
        name: 'reader',
        onToolResult: (call) => {
          calls.push(call.args);
          return allow();
        },
      },
    ]);

    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    // Simulate a checkpoint written by 8.12.0: the key did not exist then.
    const legacy = JSON.parse(JSON.stringify(paused.checkpoint)) as {
      sharedState: Record<string, unknown>;
    };
    delete legacy.sharedState.pausedToolArgs;
    await agent.resume(legacy as never, 'answered');

    // Recovered from the assistant turn — real values the model proposed, never
    // an invented empty object.
    expect(calls).toEqual([{ topic: 'refund', amount: 500 }]);
  });
});

describe('scenario — runners without pausable stages', () => {
  it('LLMCall run() returns a string (never pauses on its own)', async () => {
    const { LLMCall } = await import('../../../src/core/LLMCall.js');
    const { MockProvider } = await import('../../../src/adapters/llm/MockProvider.js');

    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const out = await llm.run({ message: 'hi' });
    expect(isPaused(out)).toBe(false);
    expect(out).toBe('ok');
  });
});
