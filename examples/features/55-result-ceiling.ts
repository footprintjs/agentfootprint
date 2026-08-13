/**
 * 55 — The refusing result ceiling: refuse teachingly, never truncate.
 *
 * WHY THIS EXISTS (the failure mode, from the field):
 * A tool returned ~191k characters. Truncating it is the tempting fix and the
 * WRONG one — a truncated result reads as a complete one, the model cannot
 * tell the data ends where the cut happened, and it fabricates from the part
 * it saw. `defineTool({ resultCeiling })` is the tool AUTHOR's contract
 * instead: over `maxChars`, the model receives a teaching refusal — the true
 * size, the ceiling, the parameters to narrow by, and the sentence that
 * matters: "No data was returned." A clean retry follows, because the refusal
 * says exactly how to make it.
 *
 * What the framework guarantees:
 *   • the oversized payload never enters context, history, or ANY event —
 *     the RECORD keeps the truth as `agentfootprint.tools.result_refused`
 *     (true size, ceiling, suggestions);
 *   • the delivered result carries status `'invalid'`, so a skill-graph
 *     `onToolStatus: 'invalid'` edge can route the overflow;
 *   • an effects envelope whose CONTENT overflows keeps its DECLARED effects
 *     — a proposed transition does not die with an oversized payload;
 *   • no `resultCeiling` = byte-identical behavior (zero-cost-when-unused).
 *
 * (The agent-level `maxToolResultChars` remains the OTHER ceiling — truncate
 * with a verbatim head — for operators capping tools they did not write. Only
 * the author knows which parameters make a retry smaller, which is why
 * `narrowBy` lives on the tool.)
 *
 * Run:  npx tsx examples/features/55-result-ceiling.ts
 */

import { Agent, defineTool, type LLMProvider, type LLMResponse } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/55-result-ceiling',
  title: 'Result ceiling — refuse teachingly, never truncate',
  group: 'features',
  description:
    'A tool declares resultCeiling on its own result: an oversized return becomes a teaching ' +
    'refusal ("No data was returned — narrow by limit/fields"), the payload enters no channel, ' +
    'the typed tools.result_refused event keeps the true size, and the model retries narrower ' +
    'and succeeds. Truncation would have read as complete data — the fabrication trap.',
  defaultInput: 'Export all orders and summarize them',
  providerSlots: [],
  tags: ['feature', 'tools', 'safety', 'observability'],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function run(input: string, _provider?: LLMProvider): Promise<unknown> {
  // ── The tool, with its author's own contract ──────────────────────────
  // #region result-ceiling
  const exportOrders = defineTool<{ limit?: number }, string>({
    name: 'export_orders',
    description: 'Export orders as CSV rows. Pass limit to bound the export.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max rows to return' } },
    },
    // The author's contract: over 2 000 chars, REFUSE and teach — never let a
    // window-blowing export reach the model as "the data".
    resultCeiling: { maxChars: 2_000, narrowBy: ['limit'] },
    execute: ({ limit }) => {
      const rows = Array.from(
        { length: limit ?? 4_000 },
        (_, i) => `order-${i},$${(i * 7) % 90},2026-08-0${(i % 9) + 1}`,
      );
      return rows.join('\n');
    },
  });
  // #endregion result-ceiling

  // ── A scripted model: asks big, reads the refusal, retries narrow ─────
  const usage = { input: 100, output: 30 };
  const script: LLMResponse[] = [
    {
      content: '',
      toolCalls: [{ id: 't1', name: 'export_orders', args: {} }],
      stopReason: 'tool_use',
      usage,
    },
    {
      content: '',
      toolCalls: [{ id: 't2', name: 'export_orders', args: { limit: 25 } }],
      stopReason: 'tool_use',
      usage,
    },
    { content: 'Exported 25 orders — summary ready.', toolCalls: [], stopReason: 'stop', usage },
  ];
  let i = 0;
  const scripted: LLMProvider = {
    name: 'mock',
    complete: async () => script[Math.min(i++, script.length - 1)]!,
  };

  const record: string[] = [];
  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 5 })
    .system('You are an order-desk assistant.')
    .tool(exportOrders)
    .watch({
      id: 'ceiling-record',
      onEmit: (e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        if (e.name === 'agentfootprint.tools.result_refused') {
          record.push(
            `tools.result_refused  size=${String(p.sizeChars)} ceiling=${String(p.maxChars)} ` +
              `narrowBy=${JSON.stringify(p.narrowBy)}`,
          );
        }
        if (e.name === 'agentfootprint.stream.tool_end') {
          record.push(
            `stream.tool_end       call=${String(p.toolCallId)}${
              p.status !== undefined ? ` status=${String(p.status)}` : ''
            }`,
          );
        }
      },
    })
    .build();

  const answer = await agent.run({ message: input });

  const history = (
    agent.getLastSnapshot()?.sharedState as {
      history: Array<{ role: string; content: string; toolName?: string }>;
    }
  ).history;
  const toolMessages = history.filter((m) => m.role === 'tool');
  const refusalTheModelRead = toolMessages[0]!.content;
  // The guarantee, demonstrated: the oversized export is in NO channel.
  const payloadLeaked = JSON.stringify(history).includes('order-3999');

  return {
    answer,
    refusalTheModelRead, // size + ceiling + "pass 'limit'" + "No data was returned."
    retryResultChars: toolMessages[1]!.content.length, // the narrowed call fits
    payloadLeaked, // false — refused means refused, on every channel
    record,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
