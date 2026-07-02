/**
 * contextLedger — Convention 3 coverage.
 *
 * What is being pinned:
 * 1. THE story: on a real agent run (mock provider, scripted tool call),
 *    the called tool and the activated signals earn; a deliberately useless
 *    injection is offered every iteration and never earns — worst earnRate,
 *    tokens counted.
 * 2. Structural honesty: usedVia labels ride every count; slice credit is
 *    slot-granular; approxTokens is an estimate column, never zero-hidden.
 * 3. Outcomes credit every OFFERED piece of a run; export/import merges
 *    additively (cross-session accumulation).
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { MockProvider } from '../../../src/llm-providers.js';
import { defineTool } from '../../../src/index.js';
import { defineInstruction } from '../../../src/injection-engine.js';

import { contextLedger } from '../../../src/lib/context-ledger/index.js';

function buildAgent() {
  const lookup = defineTool<{ id: number }, string>({
    name: 'lookup',
    description: 'Look up a record',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    execute: ({ id }) => `record-${id}`,
  });
  const shredder = defineTool<Record<string, never>, string>({
    name: 'shredder',
    description: 'Never called by anyone',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'unused',
  });
  const provider = new MockProvider({
    replies: [
      { toolCalls: [{ id: '1', name: 'lookup', args: { id: 42 } }] },
      'The record is record-42.',
    ],
  });
  return Agent.create({ provider, model: 'mock', name: 'ledger-fixture' })
    .system('You are terse.')
    .tool(lookup)
    .tool(shredder)
    .instruction(defineInstruction({ id: 'useless-legalese', prompt: 'Always remember clause 42b of the unread appendix.' }))
    .build();
}

describe('contextLedger — real agent run (FUNCTIONAL + INTEGRATION)', () => {
  it('the called tool earns; the never-called tool and useless injection do not', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'find record 42' });

    const ledger = contextLedger();
    const recorded = ledger.recordRun(agent);
    expect(recorded).toBeDefined();

    const lookupRow = ledger.row('tool', 'lookup');
    expect(lookupRow).toBeDefined();
    expect(lookupRow!.offered).toBeGreaterThan(0);
    expect(lookupRow!.usedVia['tool-called']).toBe(1);
    expect(lookupRow!.earnRate).toBeGreaterThan(0);

    const shredderRow = ledger.row('tool', 'shredder')!;
    expect(shredderRow.offered).toBeGreaterThan(0);
    expect(shredderRow.used).toBe(0);
    expect(shredderRow.earnRate).toBe(0);
    expect(shredderRow.approxTokensSpent).toBeGreaterThan(0); // the silent cost, counted

    // Worst earnRate first — the review order that matters.
    const rows = ledger.rows();
    expect(rows[0].earnRate).toBeLessThanOrEqual(rows[rows.length - 1].earnRate);

    // The useless instruction was offered each iteration, tokens spent.
    const useless = ledger.row('injection', 'useless-legalese')!;
    expect(useless.offered).toBeGreaterThanOrEqual(2); // one per ReAct iteration
    expect(useless.approxTokensSpent).toBeGreaterThan(0);
  });

  it('offers accumulate per iteration (a 2-iteration run offers twice)', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const ledger = contextLedger();
    ledger.recordRun(agent);
    // 2 replies scripted → 2 LLM iterations → 2 offers for every piece.
    expect(ledger.row('tool', 'lookup')!.offered).toBe(2);
    expect(ledger.row('injection', 'useless-legalese')!.offered).toBe(2);
  });

  it('outcomes credit every OFFERED piece of the run', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const ledger = contextLedger();
    ledger.recordRun(agent);
    expect(ledger.recordOutcome('good')).toBe(true);
    expect(ledger.row('tool', 'shredder')!.outcomes['good']).toBe(1); // offered → credited
    expect(ledger.row('tool', 'lookup')!.outcomes['good']).toBe(1);
    expect(ledger.recordOutcome('bad', 'run-999')).toBe(false); // unknown ref → honest false
  });
});

describe('contextLedger — accumulation + persistence (UNIT)', () => {
  it('two runs accumulate; runsSeen counts runs, offered counts iterations', async () => {
    const ledger = contextLedger();
    for (let i = 0; i < 2; i++) {
      const agent = buildAgent();
      await agent.run({ message: 'go' });
      ledger.recordRun(agent);
    }
    const row = ledger.row('tool', 'lookup')!;
    expect(row.runsSeen).toBe(2);
    expect(row.offered).toBe(4); // 2 iterations × 2 runs
    expect(row.usedVia['tool-called']).toBe(2);
  });

  it('export → import merges additively (cross-session)', async () => {
    const a = contextLedger();
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    a.recordRun(agent);
    a.recordOutcome('good');

    const b = contextLedger();
    b.importJSON(JSON.parse(JSON.stringify(a.exportJSON()))); // full JSON round-trip
    b.importJSON(a.exportJSON()); // merge the same data again — counts double
    const row = b.row('tool', 'lookup')!;
    expect(row.offered).toBe(a.row('tool', 'lookup')!.offered * 2);
    expect(row.outcomes['good']).toBe(2);
    expect(b.exportJSON().runsRecorded).toBe(2);
  });

  it('empty/absent snapshots are a non-event (SECURITY/robustness)', () => {
    const ledger = contextLedger();
    expect(ledger.recordRun({})).toBeUndefined();
    expect(ledger.recordRun(undefined)).toBeUndefined();
    expect(ledger.recordRun({ getLastSnapshot: () => undefined })).toBeUndefined();
    expect(ledger.rows()).toHaveLength(0);
    expect(ledger.recordOutcome('good')).toBe(false); // nothing recorded yet
  });

  it('importJSON rejects unknown versions silently (no corruption)', () => {
    const ledger = contextLedger();
    ledger.importJSON({ version: 99, rows: [], runsRecorded: 5 } as never);
    expect(ledger.exportJSON().runsRecorded).toBe(0);
  });
});

describe('contextLedger — performance (PERF/LOAD)', () => {
  it('recording a run and reading rows stays fast', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const ledger = contextLedger();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) ledger.recordRun(agent); // same snapshot, 20 ingests
    ledger.rows();
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
