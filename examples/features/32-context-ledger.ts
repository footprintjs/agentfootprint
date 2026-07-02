/**
 * Context Ledger — which pieces earned their tokens, and what gating saves.
 *
 * THE loop this demonstrates (the reason the ledger exists):
 *
 *   run → ledger.recordRun → rows (earnRate, worst first)
 *       → gates (ledgerToolGate / ledgerGated) → leaner context
 *       → tokens-per-turn drops → lesser models become viable.
 *
 * The fixture is DELIBERATELY over-stuffed: five tools of which the model
 * only ever calls one, plus a legalese instruction nobody reads. Phase 1
 * runs ungated and records; phase 2 runs the SAME agent with ledger gates;
 * the script prints the approximate input tokens side by side.
 *
 * Honesty notes printed with the numbers: token figures are the provider's
 * own usage counts (mock: proportional to request size); the ledger's
 * earnRate is structural bookkeeping, not a causal claim.
 *
 * Run: npx tsx examples/features/32-context-ledger.ts
 */

import { Agent, defineTool, type Tool } from 'agentfootprint';
import { MockProvider } from 'agentfootprint/llm-providers';
import { defineInstruction } from 'agentfootprint/injection-engine';
import { gatedTools, staticTools } from 'agentfootprint/tool-providers';
import { contextLedger, ledgerGated, ledgerToolGate } from 'agentfootprint/observe';

// ── An over-stuffed toolbox: one earner, four passengers ──────────────────

function makeTools(): Tool[] {
  const lookup = defineTool<{ id: number }, string>({
    name: 'lookup',
    description: 'Look up a record by id',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    execute: ({ id }) => `record-${id}`,
  });
  const passengers = ['exporter', 'shredder', 'fax_gateway', 'legacy_sync'].map((name) =>
    defineTool<Record<string, never>, string>({
      name,
      description: `${name} — an elaborate tool with a big schema nobody calls. `.repeat(4),
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [`param_${i}`, { type: 'string', description: `parameter ${i} of ${name}` }]),
        ),
      },
      execute: () => 'unused',
    }),
  );
  return [lookup, ...passengers];
}

const LEGALESE = defineInstruction({
  id: 'legalese',
  prompt: 'Always remember clause 42b of the unread appendix, subsections i–xiv inclusive. '.repeat(3),
});

function scriptedProvider() {
  return new MockProvider({
    replies: [
      { toolCalls: [{ id: '1', name: 'lookup', args: { id: 42 } }] },
      'The record is record-42.',
    ],
  });
}

async function totalInputTokens(agent: ReturnType<typeof buildUngated>): Promise<number> {
  await agent.run({ message: 'find record 42' });
  const snapshot = agent.getLastSnapshot() as { sharedState?: Record<string, unknown> };
  return Number(snapshot?.sharedState?.totalInputTokens ?? 0);
}

function buildUngated() {
  return Agent.create({ provider: scriptedProvider(), model: 'mock', name: 'ungated' })
    .system('You are terse.')
    .tools(makeTools())
    .instruction(LEGALESE)
    .build();
}

(async () => {
  // ── Phase 1: run ungated, let the ledger watch ───────────────────────────
  const ledger = contextLedger();
  const ungatedAgent = buildUngated();
  const ungatedTokens = await totalInputTokens(ungatedAgent);
  ledger.recordRun(ungatedAgent);
  ledger.recordOutcome('good'); // the consumer's label (thumbs / eval / triage)

  console.log('LEDGER after 1 run (worst earnRate first):\n');
  for (const row of ledger.rows()) {
    console.log(
      `  ${row.kind.padEnd(9)} ${row.id.padEnd(12)} offered ${String(row.offered).padStart(2)}  ` +
        `used ${row.used}  earnRate ${row.earnRate.toFixed(2)}  ~${row.approxTokensSpent} tok  ` +
        Object.entries(row.usedVia).map(([via, n]) => `${via}×${n}`).join(' '),
    );
  }

  // In real use you would accumulate MANY runs (exportJSON/importJSON) before
  // gating. For the demo, lower minOffers so one run is enough to judge.
  const policy = { minOffers: 1, earnRateFloor: 0.05 };

  // ── Phase 2: the SAME agent, ledger-gated ────────────────────────────────
  const gatedAgent = Agent.create({ provider: scriptedProvider(), model: 'mock', name: 'gated' })
    .system('You are terse.')
    .toolProvider(gatedTools(staticTools(makeTools()), ledgerToolGate(ledger, policy)))
    .instruction(ledgerGated(LEGALESE, ledger, policy))
    .build();
  const gatedTokens = await totalInputTokens(gatedAgent);

  console.log('\nTOKENS PER TURN (provider-reported input tokens):');
  console.log(`  ungated: ${ungatedTokens}`);
  console.log(`  gated:   ${gatedTokens}  (${Math.round((1 - gatedTokens / ungatedTokens) * 100)}% less)`);
  console.log(
    '\nhonesty: earnRate is structural bookkeeping (offers/uses from the commit log), not a causal claim;',
  );
  console.log(
    'the gates demote-never-starve — parole re-offers demoted pieces periodically so they can still earn.',
  );
})().catch(console.error);
