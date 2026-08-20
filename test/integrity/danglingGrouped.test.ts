/**
 * The dangling-reference check must be ALIVE in every chart shape — the
 * regression an adversarial review caught before release.
 *
 * The defect: `compactions` (the window ledger the check reads to learn
 * which grounds were evicted) was threaded into the injection-engine
 * subflow's mapper instead of the `sf-llm-call` boundary the CallLLM stage
 * actually lives behind under `reactMode: 'dynamic-grouped'`. The check ran,
 * saw an empty ledger every pass, and filed `not-applicable` — so the run
 * reported a healthy checker while the defect it exists for went past it.
 * That is worse than not running the check at all, and it is the exact decay
 * the disposition ledger was written to make impossible.
 *
 * This file runs the SAME trap under both dynamic chart shapes and demands
 * the same verdict from each. A future mapper edit that drops the key again
 * fails here rather than in a consumer's run.
 *
 * Test types (Convention 3): regression (chart-shape parity) / contract (the
 * disposition row tells the truth about what was compared).
 */

import { describe, expect, it } from 'vitest';
import { Agent, slidingWindow, defineTool } from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

const TASK = 'Walk the whole floor and tell me which rack is hottest.';

const ground = () =>
  defineTool({
    name: 'whats_here',
    description: 'lists the valid ids on this screen',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `IDS ${'x'.repeat(600)}`,
  });

const firesAtIds = () =>
  defineTool({
    name: 'screen_fire',
    description: 'fires one of the ids whats_here listed',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'fired',
    argumentsFrom: ['whats_here'],
  });

/** One whats_here call, then filler rounds that age it out of the window. */
function scriptedProvider(rounds: number): LLMProvider {
  let call = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => {
      call++;
      if (call > rounds) {
        return {
          content: 'done',
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'end_turn',
        };
      }
      return {
        content: '',
        toolCalls: [
          call === 1
            ? { id: `h${call}`, name: 'whats_here', args: {} }
            : { id: `f${call}`, name: 'screen_fire', args: {} },
        ],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      };
    },
  };
}

function trap(reactMode: 'dynamic' | 'dynamic-grouped') {
  const findings: Array<Record<string, unknown>> = [];
  const rows: CheckReport[] = [];
  const agent = Agent.create({
    provider: scriptedProvider(8),
    model: 'm',
    maxIterations: 12,
    reactMode,
    // The pin is the shipped first line of defence; the check covers what it
    // cannot reach, so the trap runs with it off (see danglingReference.test).
    keepLastToolResults: false,
  })
    .tool(ground())
    .tool(firesAtIds())
    .window(slidingWindow({ keepRecentTurns: 2 }))
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    rows.push(...(e.payload as { rows: CheckReport[] }).rows);
  });
  return { agent, findings, rows };
}

describe('regression: the check is alive in BOTH dynamic chart shapes', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: the evicted ground files one dangling-reference`, async () => {
      const { agent, findings } = trap(reactMode);
      await agent.run({ message: TASK });
      const dangling = findings.filter((f) => f.kind === 'dangling-reference');
      expect(dangling).toHaveLength(1);
      expect(String(dangling[0]!.message)).toContain('whats_here');
    });

    it(`${reactMode}: the disposition row records a real comparison, not a hollow pass`, async () => {
      const { agent, rows } = trap(reactMode);
      await agent.run({ message: TASK });
      const row = rows.find((r) => r.check === 'dangling-reference');
      expect(row).toBeDefined();
      // The defect this pins: an empty ledger made every pass 'not-applicable',
      // so the row looked healthy while nothing had been compared.
      expect(row!.checked).toBeGreaterThan(0);
      expect(row!.findings).toBeGreaterThan(0);
    });
  }
});
