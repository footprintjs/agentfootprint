/**
 * `maxToolResultChars` — the opt-in ceiling on ONE tool result (9.11.0).
 *
 *   P1 Unit         — the marker's shape, and that it fits inside the cap
 *   P2 Boundary     — exactly-at-cap passes; one char over is replaced; a
 *                     result under the cap comes back BY REFERENCE
 *   P3 Scenario     — the model reads a lesson it can act on, and the loop
 *                     carries on; `tool_end` carries the marker, not the payload
 *   P4 Property     — over any cap, the serialized result never exceeds it
 *                     (except where the cap cannot afford its own explanation)
 *   P5 Security     — the marker never carries the tool's args, and the omitted
 *                     tail never reaches history or the event stream
 *   P6 Performance  — n/a (one length check per result); the ABSENT-option path
 *                     is proven byte-identical instead, which is the real cost
 *   P7 ROI          — the refusal teaches; the option composes with middleware
 *
 * Why this file exists: a production request of 879,073 tokens was one tool
 * result pasted into a prompt. The framework could not have prevented it — and
 * a DEFAULT that silently replaced tool results would have been the wrong fix,
 * because a tool returning 200KB is doing what somebody wrote it to do. So the
 * ceiling is opt-in, and when it fires it TEACHES rather than trims: the model
 * is told the size, the cap, and that narrowing the request is the move.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isTruncatedToolResult } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  assertMaxToolResultChars,
  capToolResult,
  type TruncatedToolResult,
} from '../../src/core/agent/toolResultCap.js';
import type { LLMMessage } from '../../src/adapters/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

/** An agent that calls `dump` once, then answers. */
function agentReturning(value: unknown, maxToolResultChars?: number) {
  const dump = defineTool<Record<string, never>, unknown>({
    name: 'dump',
    description: 'returns whatever it was built with',
    inputSchema: { type: 'object', properties: {} },
    execute: () => value,
  });
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'c1', name: 'dump', args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    ...(maxToolResultChars !== undefined && { maxToolResultChars }),
  })
    .tool(dump)
    .build();
}

/** The `role: 'tool'` message the model actually read. */
async function toolMessageFrom(agent: ReturnType<typeof agentReturning>): Promise<string> {
  const ends: LLMMessage[] = [];
  agent.on('agentfootprint.agent.iteration_end', (e) => {
    // The final iteration_end carries no history (nothing was dispatched).
    const h = (e.payload as { history?: readonly LLMMessage[] }).history;
    if (h) ends.push(...h);
  });
  await agent.run({ message: 'go' });
  const toolMsg = ends.filter((m) => m.role === 'tool').at(-1);
  return toolMsg?.content ?? '';
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('capToolResult — the marker', () => {
  it('names the tool, the size and the cap, and tells the model what to do', () => {
    const { value, truncated } = capToolResult('x'.repeat(500), {
      toolName: 'orders_export',
      maxChars: 200,
    });
    expect(truncated).toBe(true);
    expect(isTruncatedToolResult(value)).toBe(true);
    const marker = value as TruncatedToolResult;
    expect(marker.truncated).toBe(true);
    expect(marker.reason).toContain('orders_export');
    expect(marker.reason).toContain('500 chars');
    expect(marker.reason).toContain('200-char cap');
    expect(marker.reason).toContain('Narrow the request and call again.');
  });

  it('carries a verbatim head, and the whole marker fits inside the cap', () => {
    const body = 'abcdefghij'.repeat(60); // 600 chars
    const { value } = capToolResult(body, { toolName: 't', maxChars: 300 });
    const marker = value as TruncatedToolResult;
    expect(marker.head).toBeDefined();
    // Verbatim: the head is a PREFIX of the real answer, never a paraphrase.
    expect(body.startsWith(marker.head as string)).toBe(true);
    expect(JSON.stringify(marker).length).toBeLessThanOrEqual(300);
  });

  it('drops the head rather than truncating the explanation', () => {
    // 40 chars cannot hold the sentence that explains the cap. The marker is
    // allowed to exceed it — an explanation cut in half teaches nothing, which
    // is the exact failure this feature exists to prevent.
    const { value } = capToolResult('y'.repeat(1000), { toolName: 't', maxChars: 40 });
    const marker = value as TruncatedToolResult;
    expect(marker.head).toBeUndefined();
    expect(marker.reason).toContain('Narrow the request');
  });

  it('measures an object by the JSON the model would have read', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row-${i}` }));
    const { value, truncated } = capToolResult(rows, { toolName: 'rows', maxChars: 500 });
    expect(truncated).toBe(true);
    expect((value as TruncatedToolResult).reason).toContain(`${JSON.stringify(rows).length} chars`);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('capToolResult — boundaries', () => {
  it('passes a result of exactly the cap, and replaces one char more', () => {
    expect(capToolResult('a'.repeat(100), { toolName: 't', maxChars: 100 }).truncated).toBe(false);
    expect(capToolResult('a'.repeat(101), { toolName: 't', maxChars: 100 }).truncated).toBe(true);
  });

  it('returns the ORIGINAL value by reference when it fits', () => {
    const original = { rows: [1, 2, 3] };
    const { value } = capToolResult(original, { toolName: 't', maxChars: 10_000 });
    // Not a JSON round-trip: an under-cap dispatch must not quietly re-shape
    // the value (Date → string, undefined dropped, …).
    expect(value).toBe(original);
  });

  it('is inert with no cap configured', () => {
    const original = 'z'.repeat(1_000_000);
    const { value, truncated } = capToolResult(original, { toolName: 't' });
    expect(truncated).toBe(false);
    expect(value).toBe(original);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('the dispatch loop', () => {
  it('hands the model the marker, and the run carries on', async () => {
    const agent = agentReturning('R'.repeat(50_000), 500);
    const content = await toolMessageFrom(agent);
    const parsed = JSON.parse(content) as TruncatedToolResult;
    expect(parsed.truncated).toBe(true);
    expect(parsed.reason).toContain('dump returned 50000 chars, over the 500-char cap');
    expect(parsed.reason).toContain('Narrow the request and call again.');
    expect(parsed.head).toBe('R'.repeat((parsed.head ?? '').length));
  });

  it('makes the truncation visible on `stream.tool_end` — the marker IS the result', async () => {
    const agent = agentReturning('R'.repeat(50_000), 500);
    const results: unknown[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push((e.payload as { result: unknown }).result);
    });
    await agent.run({ message: 'go' });
    expect(results).toHaveLength(1);
    expect(isTruncatedToolResult(results[0])).toBe(true);
    // The whole point at enterprise scale: a capped run does not then ship the
    // payload it capped to a CloudWatch / file / OTel sink.
    expect(JSON.stringify(results[0]).length).toBeLessThanOrEqual(500);
  });

  it('leaves a small result byte-identical on both channels', async () => {
    const agent = agentReturning('all good', 500);
    const results: unknown[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push((e.payload as { result: unknown }).result);
    });
    const content = await toolMessageFrom(agent);
    expect(content).toBe('all good');
    expect(results[0]).toBe('all good');
  });

  it('with the option ABSENT, a huge result is delivered whole — today exactly', async () => {
    const agent = agentReturning('R'.repeat(50_000));
    const content = await toolMessageFrom(agent);
    expect(content).toBe('R'.repeat(50_000));
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('property — the cap holds', () => {
  it('never lets a marker with a head exceed its own cap', () => {
    for (const cap of [200, 321, 512, 1024, 4096]) {
      for (const body of [
        'a'.repeat(20_000),
        '"'.repeat(20_000), // every char escapes to two
        '\n\t'.repeat(10_000),
        JSON.stringify(Array.from({ length: 900 }, (_, i) => ({ i, s: `«${i}»` }))),
      ]) {
        const { value } = capToolResult(body, { toolName: 'tool', maxChars: cap });
        const marker = value as TruncatedToolResult;
        if (marker.head !== undefined) {
          expect(JSON.stringify(marker).length).toBeLessThanOrEqual(cap);
        }
      }
    }
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('what the marker does NOT carry', () => {
  it('never carries the tool arguments', () => {
    const { value } = capToolResult('q'.repeat(5000), { toolName: 'lookup', maxChars: 300 });
    expect(JSON.stringify(value)).not.toContain('apiKey');
  });

  it('drops the omitted tail from history AND from the event stream', async () => {
    const secretTail = `${'A'.repeat(3000)}SECRET-TAIL`;
    const agent = agentReturning(secretTail, 400);
    const results: unknown[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => {
      results.push((e.payload as { result: unknown }).result);
    });
    const content = await toolMessageFrom(agent);
    expect(content).not.toContain('SECRET-TAIL');
    expect(JSON.stringify(results[0])).not.toContain('SECRET-TAIL');
  });
});

// ─── P6/P7 The refusal, and composition ──────────────────────────────

describe('the refusal teaches', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (bad) => {
    expect(() => assertMaxToolResultChars('Agent', bad)).toThrow(/positive whole number/);
    expect(() => assertMaxToolResultChars('Agent', bad)).toThrow(/omit the option/);
  });

  it('accepts absence — that is how the ceiling is turned off', () => {
    expect(() => assertMaxToolResultChars('Agent', undefined)).not.toThrow();
  });

  it('refuses at construction, naming the door', () => {
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'x' }),
        model: 'mock',
        maxToolResultChars: 0,
      }).build(),
    ).toThrow(/Agent: maxToolResultChars/);
  });
});

describe('composition', () => {
  it('measures what an `onToolResult` rule produced, not what the tool returned', async () => {
    const dump = defineTool<Record<string, never>, string>({
      name: 'dump',
      description: 'big',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'R'.repeat(50_000),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'c1', name: 'dump', args: {} }] }, { content: 'done' }],
      }),
      model: 'mock',
      maxToolResultChars: 500,
    })
      .tool(dump)
      // A rule that already summarized the result is NOT then told it was
      // truncated — the cap is the last-resort net, not the first move.
      .toolMiddleware({
        name: 'summarize',
        onToolResult: () => ({ kind: 'allow', value: '50000 rows, 12 over budget' } as never),
      })
      .build();
    const content = await toolMessageFrom(agent as never);
    expect(content).toBe('50000 rows, 12 over budget');
  });
});
