/**
 * #9 — tool-args validation: dispatch integration + model-visible retry.
 *
 * The ReAct-loop behavior the validator exists for: a malformed call is
 * rejected BEFORE the tool runs, the model sees a structured retry message
 * as the tool result, and corrects its args on the next iteration.
 *
 * Covers (integration/e2e tiers — the pure validator is unit-tested in
 * tool-args-validation.test.ts):
 *   (a) enforce (default): bad args → tool NOT executed → retry message in
 *       history → corrected call executes → run completes; event emitted
 *       with enforced:true
 *   (b) 'warn': tool executes despite mismatch; event has enforced:false
 *   (c) 'off': no validation, no event
 *   (d) ordering: a permission-DENIED call is never validated (policy sees
 *       every attempt; validation only gates calls that would dispatch)
 *   (e) credentials: a rejected call must NOT resolve credentials
 *       (no credential.requested for it)
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, mock } from '../../../src/index.js';
import { staticTokens } from '../../../src/identity.js';

const echoSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    times: { type: 'integer' },
  },
  required: ['text'],
} as const;

/** Mock LLM: first sends BAD args, then — if it sees the retry message —
 *  corrected args, then finishes. */
function retryingProvider(badArgs: Record<string, unknown>) {
  let calls = 0;
  return mock({
    respond: (req: { messages: readonly { role: string; content: string }[] }) => {
      calls++;
      if (calls === 1) {
        return {
          content: 'calling echo',
          toolCalls: [{ id: 'c1', name: 'echo', args: badArgs }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use' as const,
        };
      }
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      if (calls === 2 && lastTool?.content.includes('Invalid arguments')) {
        return {
          content: 'retrying with fixed args',
          toolCalls: [{ id: 'c2', name: 'echo', args: { text: 'hello', times: 2 } }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use' as const,
        };
      }
      return {
        content: `done after ${calls} llm calls`,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn' as const,
      };
    },
  });
}

function buildEchoTool(executions: unknown[]) {
  return defineTool<{ text: string; times?: number }, string>({
    name: 'echo',
    description: 'Echo text',
    inputSchema: echoSchema,
    execute: ({ text, times }) => {
      executions.push({ text, times });
      return text.repeat(times ?? 1);
    },
  });
}

describe('#9 — enforce (default): model-visible retry loop', () => {
  it('rejects the bad call, the model retries with fixed args, run completes', async () => {
    const executions: unknown[] = [];
    const events: { enforced: boolean; toolName: string; issues: readonly unknown[] }[] = [];
    const agent = Agent.create({ provider: retryingProvider({ times: 'three' }), model: 'mock' })
      .tool(buildEchoTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, (event) => {
      events.push((event as { payload: (typeof events)[0] }).payload);
    });

    const answer = await agent.run({ message: 'echo hello' });

    // The bad call NEVER reached the tool; only the corrected one did.
    expect(executions).toEqual([{ text: 'hello', times: 2 }]);
    expect(String(answer)).toContain('done');

    // Event fired once, enforced, with both issues (missing text + bad times type).
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ toolName: 'echo', enforced: true });
    expect(events[0].issues).toContainEqual({ path: 'text', expected: 'required', got: 'missing' });
    expect(events[0].issues).toContainEqual({ path: 'times', expected: 'integer', got: 'string' });
  });
});

describe("#9 — 'warn' and 'off' modes", () => {
  it("'warn': executes anyway, event has enforced:false", async () => {
    const executions: unknown[] = [];
    const events: { enforced: boolean }[] = [];
    let llmCalls = 0;
    const provider = mock({
      respond: () => {
        llmCalls++;
        return llmCalls === 1
          ? {
              content: '',
              toolCalls: [{ id: 'c1', name: 'echo', args: { times: 'three' } as never }],
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use' as const,
            }
          : {
              content: 'done',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn' as const,
            };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', toolArgValidation: 'warn' })
      .tool(buildEchoTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, (event) => {
      events.push((event as { payload: (typeof events)[0] }).payload);
    });

    await agent.run({ message: 'go' });

    expect(executions).toHaveLength(1); // executed despite the mismatch
    expect(events).toHaveLength(1);
    expect(events[0].enforced).toBe(false);
  });

  it("'off': no validation, no event", async () => {
    const executions: unknown[] = [];
    let eventCount = 0;
    let llmCalls = 0;
    const provider = mock({
      respond: () => {
        llmCalls++;
        return llmCalls === 1
          ? {
              content: '',
              toolCalls: [{ id: 'c1', name: 'echo', args: { times: 'three' } as never }],
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use' as const,
            }
          : {
              content: 'done',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn' as const,
            };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', toolArgValidation: 'off' })
      .tool(buildEchoTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, () => {
      eventCount++;
    });

    await agent.run({ message: 'go' });

    expect(executions).toHaveLength(1);
    expect(eventCount).toBe(0);
  });
});

describe('#9 — parallel batch: invalid call must not poison valid siblings', () => {
  it('rejects only the bad call; the valid sibling in the same batch executes', async () => {
    const executions: unknown[] = [];
    const events: { toolCallId: string }[] = [];
    let llmCalls = 0;
    const provider = mock({
      respond: () => {
        llmCalls++;
        return llmCalls === 1
          ? {
              content: '',
              // One invalid + one valid call in a SINGLE batch.
              toolCalls: [
                { id: 'bad', name: 'echo', args: { times: 'three' } as never },
                { id: 'good', name: 'echo', args: { text: 'hi', times: 1 } },
              ],
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use' as const,
            }
          : {
              content: 'done',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn' as const,
            };
      },
    });
    const agent = Agent.create({ provider, model: 'mock' }).tool(buildEchoTool(executions)).build();
    agent.on('agentfootprint.validation.args_invalid' as never, (event) => {
      events.push((event as { payload: (typeof events)[0] }).payload);
    });

    await agent.run({ message: 'go' });

    // Only the valid sibling ran; the rejection is per-call, not per-batch.
    expect(executions).toEqual([{ text: 'hi', times: 1 }]);
    expect(events).toHaveLength(1);
    expect(events[0].toolCallId).toBe('bad');
  });
});

describe('#9 — ordering against permission + credentials', () => {
  it('a permission-DENIED call is never validated (no validation event)', async () => {
    let validationEvents = 0;
    let llmCalls = 0;
    const provider = mock({
      respond: () => {
        llmCalls++;
        return llmCalls === 1
          ? {
              content: '',
              // Args are ALSO invalid — but deny must short-circuit first.
              toolCalls: [{ id: 'c1', name: 'echo', args: {} as never }],
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use' as const,
            }
          : {
              content: 'done',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn' as const,
            };
      },
    });
    const executions: unknown[] = [];
    const agent = Agent.create({
      provider,
      model: 'mock',
      permissionChecker: {
        check: () => ({ result: 'deny' as const, rationale: 'test policy' }),
      },
    })
      .tool(buildEchoTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, () => {
      validationEvents++;
    });

    await agent.run({ message: 'go' });

    expect(executions).toHaveLength(0);
    expect(validationEvents).toBe(0); // deny precedes validation
  });

  it('a rejected call does NOT resolve credentials (no credential.requested)', async () => {
    let credentialRequests = 0;
    let llmCalls = 0;
    const provider = mock({
      respond: () => {
        llmCalls++;
        return llmCalls === 1
          ? {
              content: '',
              toolCalls: [{ id: 'c1', name: 'secure', args: {} as never }], // missing required
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use' as const,
            }
          : {
              content: 'done',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn' as const,
            };
      },
    });
    const executions: unknown[] = [];
    const secure = defineTool<{ query: string }, string>({
      name: 'secure',
      description: 'Needs a credential',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      needs: { credential: 'github' },
      execute: ({ query }) => {
        executions.push(query);
        return 'ok';
      },
    });
    const agent = Agent.create({
      provider,
      model: 'mock',
      credentials: staticTokens({ github: 'tok_test' }),
    })
      .tool(secure)
      .build();
    agent.on('agentfootprint.credential.requested' as never, () => {
      credentialRequests++;
    });

    await agent.run({ message: 'go' });

    expect(executions).toHaveLength(0);
    expect(credentialRequests).toBe(0); // never acquire for a call that won't run
  });
});
