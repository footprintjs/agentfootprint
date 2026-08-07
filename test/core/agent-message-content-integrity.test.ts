/**
 * A turn with no text never enters the conversation (8.18.0).
 *
 * One crash line, six ways in. `buildMessagesSlot` composes every message in
 * the window through `truncate(m.content, 80)`, so ANY message that reached
 * the window without text killed the next turn with
 * `TypeError: Cannot read properties of undefined (reading 'length')` — from
 * inside a subflow, naming no message, no role and no origin.
 *
 * The fix is at the sources, never at the crash line. Each entry point either
 * NORMALIZES (there is one sane reading) or REFUSES TEACHINGLY (there is more
 * than one), and this file pins one case per source:
 *
 *   B1  a tool that returns nothing            → normalized, self-describing
 *   B2  a human-answer pause resumed with none → refused (two readings)
 *   B3  the run input                          → refused (see agent-run-input)
 *   B4  a middleware that rewrites to non-text → denied (chain law)
 *   B5  a declared injection with no content   → refused at the declaration
 *   B6  a restored checkpoint carrying a hole  → refused at the door
 *   B7  the slot itself                        → NAMES what got through
 *
 * B7 is the net, and it does not coerce: substituting `''` there would put
 * words nobody said into the conversation and hide which source leaked.
 */

import { describe, expect, it } from 'vitest';

import { Agent, askHuman, defineTool, PauseAnswerRequiredError } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { safeStringify, NO_TOOL_VALUE } from '../../src/core/agent/validators.js';
import { validateCheckpoint } from '../../src/core/runCheckpoint.js';
import { buildMessagesSlot } from '../../src/core/slots/buildMessagesSlot.js';
import { FlowChartExecutor } from 'footprintjs';
import type { LLMMessage } from '../../src/adapters/types.js';

const CALL = (name: string): { toolCalls: { id: string; name: string; args: object }[] } => ({
  toolCalls: [{ id: 'c0', name, args: {} }],
});

function toolReturning(value: unknown): ReturnType<typeof defineTool> {
  return defineTool({
    name: 't',
    description: 'does something',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => value,
  });
}

async function historyAfterToolReturning(value: unknown): Promise<readonly LLMMessage[]> {
  const agent = Agent.create({
    provider: mock({ replies: [CALL('t'), { content: 'FINAL' }] }),
    model: 'm',
  })
    .tool(toolReturning(value))
    .build();
  await agent.run('go');
  const state = agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] };
  return state.history ?? [];
}

// ─── 1. UNIT — B1, at the function that lied ──────────────────────

describe('message content — unit (safeStringify is total)', () => {
  it('reports a value-less return instead of returning undefined', () => {
    // `JSON.stringify(undefined)` is `undefined`, not a string — the old body
    // promised `: string` and could not keep it.
    expect(safeStringify(undefined)).toBe(NO_TOOL_VALUE);
    expect(typeof safeStringify(undefined)).toBe('string');
  });

  it('describes the other two values JSON.stringify drops', () => {
    expect(safeStringify(() => 1)).toBe('[unserializable: function]');
    expect(safeStringify(Symbol('s'))).toBe('[unserializable: symbol]');
  });

  it('is unchanged for everything that was already fine', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeStringify(null)).toBe('null');
    expect(safeStringify(42)).toBe('42');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(safeStringify(cyclic)).toMatch(/^\[unstringifiable: /);
  });
});

// ─── 2. BOUNDARY — B1 end to end, B7 the net ──────────────────────

describe('message content — boundary', () => {
  it('a tool that returns nothing lands a self-describing marker, and the run finishes', async () => {
    const history = await historyAfterToolReturning(undefined);
    const toolTurn = history.find((m) => m.role === 'tool');
    expect(toolTurn?.content).toBe(NO_TOOL_VALUE);
    // Not the empty string: the model has to be able to tell "no value" from
    // "the empty answer".
    expect(toolTurn?.content).not.toBe('');
  });

  it('every other return shape still round-trips the way it always did', async () => {
    expect(
      (await historyAfterToolReturning({ a: 1 })).find((m) => m.role === 'tool')?.content,
    ).toBe('{"a":1}');
    expect((await historyAfterToolReturning(null)).find((m) => m.role === 'tool')?.content).toBe(
      'null',
    );
    expect((await historyAfterToolReturning('text')).find((m) => m.role === 'tool')?.content).toBe(
      'text',
    );
  });

  it('B7 — the slot NAMES a message that got through, with role, position and origin', async () => {
    const executor = new FlowChartExecutor(buildMessagesSlot());
    await expect(
      executor.run({
        input: {
          messages: [
            { role: 'user', content: 'fine' },
            { role: 'tool', toolCallId: 'call-9', toolName: 'lookup' },
          ],
          iteration: 1,
        },
      }),
    ).rejects.toThrow(/message 2 of 2 \(role 'tool'\).*result of tool call 'call-9'/s);
  });

  it('B7 does NOT compose an empty turn in its place', async () => {
    const executor = new FlowChartExecutor(buildMessagesSlot());
    await expect(
      executor.run({ input: { messages: [{ role: 'user' }], iteration: 1 } }),
    ).rejects.toThrow(/it is not composed as an empty one/);
  });
});

// ─── 3. SCENARIO — B2, the pause a person did not answer ──────────

describe('message content — scenario (resume with no answer)', () => {
  const pausingAgent = (): Agent =>
    Agent.create({ provider: mock({ replies: [CALL('ask'), { content: 'FINAL' }] }), model: 'm' })
      .tool(
        defineTool({
          name: 'ask',
          description: 'asks a person',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            askHuman({ question: 'which one?' });
          },
        }),
      )
      .build();

  it('refuses, names the tool, and spells both meanings', async () => {
    const agent = pausingAgent();
    const paused = await agent.run('go');
    const checkpoint = (paused as { checkpoint: never }).checkpoint;

    const err = await agent.resume(checkpoint).catch((e: unknown) => e as PauseAnswerRequiredError);
    expect(err).toBeInstanceOf(PauseAnswerRequiredError);
    expect(err.code).toBe('ERR_PAUSE_ANSWER_REQUIRED');
    expect(err.toolName).toBe('ask');
    expect(err.message).toMatch(/resume\(checkpoint, 'the answer'\)/);
    expect(err.message).toMatch(/resume\(checkpoint, '\(no answer\)'\)/);
  });

  it('leaves the checkpoint good — answer it and the same one resumes', async () => {
    const agent = pausingAgent();
    const paused = await agent.run('go');
    const checkpoint = (paused as { checkpoint: never }).checkpoint;
    await expect(agent.resume(checkpoint)).rejects.toThrow(PauseAnswerRequiredError);

    expect(await agent.resume(checkpoint, 'the second one')).toBe('FINAL');
    const state = agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] };
    expect(state.history?.find((m) => m.role === 'tool')?.content).toBe('the second one');
  });
});

// ─── 4. PROPERTY ──────────────────────────────────────────────────

describe('message content — property', () => {
  it('whatever a tool returns, the turn it produces carries a string', async () => {
    for (const value of [undefined, null, 0, '', 'x', { a: 1 }, [1, 2], true]) {
      const history = await historyAfterToolReturning(value);
      expect(typeof history.find((m) => m.role === 'tool')?.content).toBe('string');
    }
  });
});

// ─── 5. SECURITY + 6. REFUSAL — B5, B6 ────────────────────────────

describe('message content — refusal (declared and restored messages)', () => {
  it('B5 — a declared messages injection with no content is refused, naming the injection', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .injection({
        id: 'no-text',
        flavor: 'fact',
        trigger: { kind: 'always' },
        inject: { messages: [{ role: 'user' }] },
      } as never)
      .build();
    await expect(agent.run('go')).rejects.toThrow(
      /Agent injection 'no-text'.*`content` is missing/s,
    );
  });

  it('B5 — an empty declared message is refused too (a blank turn is not a quieter one)', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .injection({
        id: 'blank',
        flavor: 'fact',
        trigger: { kind: 'always' },
        inject: { messages: [{ role: 'user', content: '   ' }] },
      } as never)
      .build();
    await expect(agent.run('go')).rejects.toThrow(/Agent injection 'blank'.*is empty/s);
  });

  it('B6 — a stored conversation is checked turn by turn, not just as an array', () => {
    const good = {
      version: 1 as const,
      runId: 'r1',
      lastCompletedIteration: 1,
      originalInput: { message: 'hi' },
      history: [{ role: 'user', content: 'hi' }],
    };
    expect(() => validateCheckpoint(good)).not.toThrow();

    expect(() =>
      validateCheckpoint({ ...good, history: [{ role: 'user', content: 'hi' }, { role: 'user' }] }),
    ).toThrow(/history\[1\] is missing text/);
    expect(() => validateCheckpoint({ ...good, history: ['just a string'] })).toThrow(
      /history\[0\] is not a message/,
    );
    expect(() => validateCheckpoint({ ...good, history: [{ content: 'no role' }] })).toThrow(
      /`role` is undefined/,
    );
  });
});

// ─── 7. INTEGRATION ───────────────────────────────────────────────

describe('message content — integration', () => {
  it('a void tool runs twice in a row without the second turn crashing', async () => {
    // The regression this whole file exists for: the marker has to survive
    // being composed back INTO the next request, not just being written once.
    const agent = Agent.create({
      provider: mock({ replies: [CALL('t'), CALL('t'), { content: 'DONE' }] }),
      model: 'm',
    })
      .tool(toolReturning(undefined))
      .maxIterations(5)
      .build();
    expect(await agent.run('go')).toBe('DONE');
    const state = agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] };
    expect(state.history?.filter((m) => m.role === 'tool')).toHaveLength(2);
  });
});
