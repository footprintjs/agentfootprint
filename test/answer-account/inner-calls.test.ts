/**
 * The account of a run and a tool called from inside another tool
 * (`ctx.tools.call`).
 *
 * An inner call files its gates' events under its own id
 * (`<outer>#inner-<n>`). The account names the calls the MODEL made — the ids
 * on `stream.tool_start` / `stream.tool_end` — so an inner call's
 * `permission.check` must not be read as a verdict about the outer call, even
 * when both calls name the same tool. It is not named by the account either:
 * its row lives on the state key `innerToolCalls`, which no sentence reads yet.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { recordRun } from '../../src/observe.js';
import type { PermissionChecker } from '../../src/provider-contract/types.js';
import { accountForAnswer } from '../../src/answer-account/account.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

/** `lookup` calls itself once through `ctx.tools`; the checker refuses only that inner call. */
async function selfComposingRun(): Promise<{ recording: Recording; inner: string[] }> {
  const inner: string[] = [];
  const lookup = defineTool<Record<string, unknown>, unknown>({
    name: 'lookup',
    description: 'looks up, and once asks itself for more',
    inputSchema: { type: 'object', properties: { deeper: { type: 'boolean' } } },
    execute: async (args, ctx) => {
      if (args.deeper === true) return { rows: 1 };
      try {
        await ctx.tools!.call('lookup', { deeper: true });
      } catch (err) {
        inner.push((err as Error).message);
      }
      return { rows: 3 };
    },
  });
  const checker: PermissionChecker = {
    name: 'no-deeper',
    check: (req) =>
      (req.context as { deeper?: unknown } | undefined)?.deeper === true
        ? { result: 'deny', policyRuleId: 'r-deeper' }
        : { result: 'allow' },
  };
  const agent = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    permissionChecker: checker,
  })
    .tool(lookup)
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'look it up' });
  recorder.stop();
  return { recording: JSON.parse(JSON.stringify(recorder.toRecording())), inner };
}

describe('the account and inner calls', () => {
  it("an inner call's refusal is not read as the outer call's, even under the same tool name", async () => {
    const { recording, inner } = await selfComposingRun();
    expect(inner).toHaveLength(1);
    const checks = (recording.events as unknown as { type: string; payload: any }[])
      .filter((e) => e.type === 'agentfootprint.permission.check')
      .map((e) => [e.payload.toolCallId, e.payload.target, e.payload.result]);
    // The record holds both verdicts, each under its own call.
    expect(checks).toEqual([
      ['c1', 'lookup', 'allow'],
      ['c1#inner-1', 'lookup', 'deny'],
    ]);

    const account = accountForAnswer(recording, {});
    // The model made one call, and it ran.
    expect(account.facts.calls.map((c) => [c.toolCallId, c.outcome])).toEqual([['c1', 'ran']]);
    expect(account.facts.errors.refused).toBe(0);
  });
});
