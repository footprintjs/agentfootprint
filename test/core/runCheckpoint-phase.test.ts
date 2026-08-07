/**
 * A crash checkpoint names WHERE it crashed (8.14.0).
 *
 * Field report from production: a WebKit `fetch` failure surfaced as
 *
 *     [agent run] failed at iteration 3 (unknown).
 *
 * WebKit's entire message for a failed fetch is `TypeError: Load failed` — no
 * code, no vendor name, nothing `classifyFailurePhase`'s regexes can match. So
 * the phase came back `'unknown'` while the run itself knew perfectly well
 * that the LLM call was open at the time. A shrug where a diagnosis was
 * available.
 *
 * The fix is observation, not better regexes. The checkpoint tracker already
 * listens to the agent's own dispatcher for `iteration_start` / `iteration_end`;
 * it now also follows the `stream.*` brackets, so a failure inside one is
 * attributed without asking the error to describe itself. The heuristic stays
 * as the fallback for failures between brackets, where the error's own text
 * really is the best evidence there is.
 *
 * ## The hard constraint
 *
 * `stage` carries the literal `'call-llm'` or a DECLARED TOOL NAME. Nothing
 * else. A checkpoint is persisted to Redis / Postgres / S3 and read by whoever
 * is on call; a URL, a header or a request body must never reach it. The last
 * test in this file asserts that, and it is not decoration — it is the reason
 * the field exists in this shape.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { defineTool } from '../../src/core/tools.js';
import { RunCheckpointError } from '../../src/core/runCheckpoint.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';

const SECRET_URL = 'https://api.example.com/v1/messages?api_key=sk-super-secret-value';

/** Fails on call N with an error that describes NOTHING about where it was. */
function opaqueFailure(failOnCall: number, message = 'Load failed'): LLMProvider {
  let call = 0;
  return {
    name: 'webkit-ish',
    complete: async (): Promise<LLMResponse> => {
      call++;
      if (call === failOnCall) {
        // Exactly WebKit's shape: a bare TypeError with a two-word message.
        throw new TypeError(message);
      }
      return {
        content: '',
        toolCalls: [{ id: `c${call}`, name: 'look', args: {} }],
        usage: { input: 10, output: 10 },
        stopReason: 'end_turn',
      };
    },
  };
}

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'RESULT',
} as never);

const exploding = defineTool({
  name: 'charge_card',
  description: 'charge a card',
  inputSchema: { type: 'object', properties: {} },
  execute: () => {
    throw new TypeError('Load failed');
  },
} as never);

async function crash(agent: Agent): Promise<RunCheckpointError> {
  try {
    await agent.run({ message: 'go' });
  } catch (e) {
    if (e instanceof RunCheckpointError) return e;
    throw e;
  }
  throw new Error('expected the run to fail');
}

describe('failure phase is OBSERVED, not guessed (8.14.0)', () => {
  it("an opaque LLM failure is 'llm' at stage 'call-llm' — not 'unknown'", async () => {
    const agent = Agent.create({ provider: opaqueFailure(3), model: 'm' })
      .tool(looker as never)
      .maxIterations(8)
      .build();

    const err = await crash(agent);
    // This is the exact production report, now answerable.
    expect(err.checkpoint.failurePoint?.phase).toBe('llm');
    expect(err.checkpoint.failurePoint?.stage).toBe('call-llm');
    expect(err.message).toContain('during the LLM call');
    expect(err.message).toContain('stage: call-llm');
    expect(err.message).not.toContain('(unknown)');
  });

  it('a tool that THROWS is not a crash at all — it is reported to the model', async () => {
    // Documented boundary (see runCheckpoint.ts): a throwing tool has its
    // error handed back as the tool RESULT and the loop carries on. So there
    // is no checkpoint to attribute, and the phase machinery must not invent
    // one. Worth pinning, because it is the first thing anyone assumes.
    let call = 0;
    const provider: LLMProvider = {
      name: 'p',
      complete: async () => {
        call++;
        return {
          content: call > 2 ? 'FINAL' : '',
          toolCalls: call > 2 ? [] : [{ id: `c${call}`, name: 'charge_card', args: {} }],
          usage: { input: 10, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider, model: 'm' })
      .tool(exploding as never)
      .maxIterations(8)
      .build();

    await expect(agent.run({ message: 'go' })).resolves.toBe('FINAL');
  });

  it('the bracket CLOSES — a later LLM failure is never blamed on the last tool', async () => {
    // The stale-attribution guard. `inFlightPhase` is set on tool_start and
    // must be cleared on tool_end, or every LLM failure after the first tool
    // call would name that tool — a confident wrong answer, which is worse
    // than the 'unknown' this whole change replaces.
    let call = 0;
    const provider: LLMProvider = {
      name: 'p',
      complete: async (): Promise<LLMResponse> => {
        call++;
        if (call === 3) throw new TypeError('Load failed');
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'look', args: {} }],
          usage: { input: 10, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider, model: 'm' })
      .tool(looker as never)
      .maxIterations(8)
      .build();

    const err = await crash(agent);
    expect(err.checkpoint.failurePoint?.phase).toBe('llm');
    expect(err.checkpoint.failurePoint?.stage).toBe('call-llm');
    expect(err.checkpoint.failurePoint?.stage).not.toBe('look');
  });

  it('the observation OVERRIDES the heuristic when the two disagree', async () => {
    // The message says "tool", loudly, while the failure is provably inside
    // the LLM bracket. `classifyFailurePhase` would answer 'tool'; the run
    // knows better, and the run wins.
    const agent = Agent.create({
      provider: opaqueFailure(2, 'Tool gateway refused the connection'),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();

    const err = await crash(agent);
    expect(err.checkpoint.failurePoint?.phase).toBe('llm');
    expect(err.checkpoint.failurePoint?.stage).toBe('call-llm');
  });

  it('a checkpoint is still JSON-serializable with the new field', async () => {
    const agent = Agent.create({ provider: opaqueFailure(3), model: 'm' })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    const err = await crash(agent);

    const round = JSON.parse(JSON.stringify(err.checkpoint)) as typeof err.checkpoint;
    expect(round.failurePoint?.stage).toBe('call-llm');
    // Still v1: an OPTIONAL field is not a format change, and bumping the
    // version would make an older deployment refuse a session it can serve.
    expect(round.version).toBe(1);
  });

  it('SECURITY — no URL, no key, nothing but the declared name reaches the checkpoint', async () => {
    // A provider whose failure message is stuffed with exactly the things a
    // persisted checkpoint must never carry.
    let call = 0;
    const leaky: LLMProvider = {
      name: 'leaky',
      complete: async (): Promise<LLMResponse> => {
        call++;
        if (call === 3) throw new TypeError(`fetch to ${SECRET_URL} failed`);
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'look', args: {} }],
          usage: { input: 10, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider: leaky, model: 'm' })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    const err = await crash(agent);

    const serialized = JSON.stringify(err.checkpoint);
    expect(serialized).not.toContain('sk-super-secret-value');
    expect(serialized).not.toContain('https://');
    expect(err.checkpoint.failurePoint?.stage).toBe('call-llm');

    // The cause still carries the vendor's own message — that is the caller's
    // to handle, and it is NOT what gets persisted.
    expect(err.cause.message).toContain(SECRET_URL);
  });
});
