/**
 * 40 — The schema teaches back (7.26): `.outputSchema(parser, { retries })`.
 *
 * `outputSchema` has always been able to say NO. Until 7.26 that was the
 * whole of it: the run finished, `runTyped()` judged the answer at the
 * caller's boundary, and a bad shape became an exception. Which is a fine
 * place to reject an answer and a useless place to FIX one — the loop has
 * stopped and the model is gone.
 *
 * `{ retries: N }` moves the judging one stage earlier, into the Route
 * decider, where the run still has a loop. A failed answer and an authored
 * correction join the conversation and the ReAct loop re-enters, so the next
 * attempt is a REAL turn: its own `llm_start` / `llm_end` bracket, its own
 * `cost.tick`, its own row in the ledger. Nothing is hidden inside a stage.
 *
 * Three scenarios run:
 *
 *   1. TEACHES  — the first answer is malformed; one correction fixes it.
 *                 Watch the events: two brackets, two cost ticks, and a
 *                 ledger that reads "attempt 1 failed on X, attempt 2 passed".
 *   2. GIVES UP — the model never gets it. The cap is spent, the last answer
 *                 stands, and `runTyped()` throws `OutputSchemaError` exactly
 *                 as it did before any of this existed. `.outputFallback()`
 *                 still composes on top.
 *   3. FORCED   — `strategy: 'tool-forced'` puts the schema on the wire as a
 *                 synthetic tool and forces the provider's tool choice, so
 *                 the shape is constrained at generation instead of asked
 *                 for in prose.
 *   4. SAYS SO  — 8.18.0. The same failure through `run()` instead of
 *                 `runTyped()`. `run()` returns a string by contract and
 *                 still does, so it cannot throw — but the run now files the
 *                 fact, fires `output_contract_unmet`, and warns. The
 *                 scenario also shows the case where one of YOUR OWN output
 *                 rules broke an answer the model got right: the run names
 *                 the rule and stops re-asking, because re-asking cannot fix
 *                 a rule.
 *
 * Run:  npx tsx examples/features/40-output-schema-retry.ts
 */

import { Agent, OutputSchemaError, SCHEMA_TOOL_NAME, allow } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMProvider } from '../../src/adapters/types.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/40-output-schema-retry',
  title: 'The schema teaches back — retries on outputSchema',
  group: 'features',
  description:
    '7.26 — `.outputSchema(parser, { retries })` turns a schema failure into a corrective turn: the failed answer and an authored frame quoting the validator go back to the model, the ReAct loop re-enters, and the next attempt is a real turn with its own LLM bracket and cost tick. Exhaustion throws OutputSchemaError exactly as before. `strategy: "tool-forced"` constrains the shape at generation on providers that declare the capability.',
  defaultInput: 'demo the corrective loop',
  providerSlots: ['feature'],
  tags: ['feature', 'output-schema', 'retry', 'structured-output', 'tool-choice'],
};

// ─── Fixtures ─────────────────────────────────────────────────────

// #region refund-parser
interface Refund {
  amount: number;
  reason: string;
}

/** Duck-typed parser — Zod, Valibot, ArkType or hand-written all work. The
 *  message it throws is what the model is shown, so it is worth writing. */
const refundParser = {
  description: 'a refund decision: { amount: number, reason: string }',
  parse: (raw: unknown): Refund => {
    const r = raw as { amount?: unknown; reason?: unknown } | null;
    if (typeof r !== 'object' || r === null) throw new Error('expected a JSON object');
    if (typeof r.amount !== 'number') {
      throw new Error(`amount must be a number, got ${JSON.stringify(r.amount)}`);
    }
    if (typeof r.reason !== 'string') throw new Error('reason must be a string');
    return { amount: r.amount, reason: r.reason };
  },
};
// #endregion refund-parser

const MALFORMED = JSON.stringify({ amount: 'USD 50', reason: 'package never arrived' });
const VALID = JSON.stringify({ amount: 50, reason: 'package never arrived' });

// ─── 1. TEACHES — one correction, and the model gets it ───────────

// #region teaches
async function scenarioTeaches(provider?: LLMProvider): Promise<void> {
  console.log('\n1. TEACHES — malformed first answer, one corrective turn\n');

  const agent = Agent.create({
    provider: provider ?? mock({ replies: [MALFORMED, VALID] }),
    model: 'mock',
    pricingTable: { name: 'demo-pricing', pricePerToken: () => 0.000_001 },
  })
    .system('You decide refund amounts.')
    .outputSchema(refundParser, { retries: 2 })
    .build();

  let calls = 0;
  agent.on('agentfootprint.stream.llm_start', () => (calls += 1));
  agent.on('agentfootprint.agent.output_schema_retry', (e) => {
    console.log(`   ↻ attempt ${e.payload.attempt} failed (${e.payload.stage})`);
    console.log(`     the model is shown: ${e.payload.error}`);
    console.log(`     retries left after this: ${e.payload.retriesRemaining}`);
  });

  const typed = await agent.runTyped<Refund>({ message: 'refund my order' });
  console.log(`   ✓ typed answer:`, typed);
  console.log(`   ${calls} real LLM calls — each retry is a turn, not a hidden inner loop`);

  // The committed record. Read it from a stored snapshot months later and it
  // still says why the run took two turns.
  const state = agent.getLastSnapshot()?.sharedState as { outputAttempts?: unknown[] };
  console.log('   ledger:', JSON.stringify(state.outputAttempts, null, 2));
}
// #endregion teaches

// ─── 2. GIVES UP — the cap is stated, and it is honoured ──────────

// #region gives-up
async function scenarioGivesUp(): Promise<void> {
  console.log('\n2. GIVES UP — the model never gets it; the cap is spent\n');

  const strict = Agent.create({
    provider: mock({ replies: [MALFORMED, MALFORMED] }),
    model: 'mock',
  })
    .outputSchema(refundParser, { retries: 1 })
    .build();

  try {
    await strict.runTyped<Refund>({ message: 'refund my order' });
  } catch (e) {
    if (e instanceof OutputSchemaError) {
      console.log(`   ✓ threw OutputSchemaError (stage: ${e.stage}) — same as it always did`);
      console.log(`     the answer that stands: ${e.rawOutput}`);
    } else {
      throw e;
    }
  }

  // …and the degradation chain still composes on top of an exhausted loop.
  const forgiving = Agent.create({
    provider: mock({ replies: [MALFORMED, MALFORMED] }),
    model: 'mock',
  })
    .outputSchema(refundParser, { retries: 1 })
    .outputFallback({
      // Tier 2 runs first; the canned value is the guaranteed-valid net.
      fallback: (err) => ({ amount: 0, reason: `needs a human (${err.stage})` }),
      canned: { amount: 0, reason: 'manual review required' },
    })
    .build();

  const safe = await forgiving.runTyped<Refund>({ message: 'refund my order' });
  console.log(`   ✓ with .outputFallback({ canned }), the caller still gets a typed value:`, safe);
}
// #endregion gives-up

// ─── 3. FORCED — constrain the shape at generation ────────────────

// #region forced
async function scenarioForced(): Promise<void> {
  console.log('\n3. FORCED — the schema as a tool, the tool choice forced\n');

  // The mock declares `carriesForcedToolChoice`, so the strategy is
  // rehearsable with no key and no network. A provider that does NOT declare
  // it is refused BY NAME at run start — never silently downgraded to
  // 'instruct', because a strategy that quietly becomes the other one is
  // config that lies.
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            {
              id: '1',
              name: SCHEMA_TOOL_NAME,
              args: { amount: 50, reason: 'package never arrived' },
            },
          ],
        },
      ],
    }),
    model: 'mock',
  })
    .outputSchema(refundParser, {
      strategy: 'tool-forced',
      // The library will not infer a shape from a `parse()` function, so the
      // JSON Schema is passed explicitly (a parser with `toJsonSchema()` —
      // ArkType has one — is asked instead).
      jsonSchema: {
        type: 'object',
        properties: { amount: { type: 'number' }, reason: { type: 'string' } },
        required: ['amount', 'reason'],
      },
      retries: 1,
    })
    .build();

  agent.on('agentfootprint.stream.llm_start', (e) => {
    console.log(`   tools the model saw: ${(e.payload.tools ?? []).map((t) => t.name).join(', ')}`);
  });

  const typed = await agent.runTyped<Refund>({ message: 'refund my order' });
  console.log(`   ✓ typed answer:`, typed);
  console.log(`   the synthetic '${SCHEMA_TOOL_NAME}' tool is on the WIRE only —`);
  console.log(`   never in .tools(), never dispatched, never a middleware row.`);
}
// #endregion forced

// ─── 4. SAYS SO — the contract is loud on the run() path too (8.18.0) ──

// #region says-so
async function scenarioSaysSo(): Promise<void> {
  console.log('\n4. SAYS SO — the same failure, through run() instead of runTyped()\n');

  // `.outputSchema(parser)` with NO options. Through 8.17.0 this judged
  // nothing inside the run: the chart was byte-identical to an agent with no
  // contract, and a `run()` caller received the violating string with no
  // event, no warning and no ledger row. It now means "judge, do not re-ask".
  const agent = Agent.create({ provider: mock({ replies: [MALFORMED] }), model: 'mock' })
    .outputSchema(refundParser)
    .build();

  agent.on('agentfootprint.agent.output_contract_unmet', (e) => {
    console.log(
      `   event: stage=${e.payload.stage} attempts=${e.payload.attempts} ` +
        `retriesSpent=${e.payload.retriesSpent}`,
    );
  });

  const answer = await agent.run({ message: 'refund my order' });
  console.log(`   run() returned the raw answer, as it always has: ${answer}`);

  const unmet = agent.outputContractUnmet();
  console.log(`   agent.outputContractUnmet(): ${unmet?.stage} — ${unmet?.error}`);
  console.log('   …so a server route can decide what to ship instead of shipping this.');

  // The case worth a dashboard: the MODEL was right and a rule broke it.
  const rewritten = Agent.create({ provider: mock({ replies: [VALID] }), model: 'mock' })
    .outputSchema(refundParser, { retries: 3 })
    .act({
      output: [
        {
          name: 'redactor',
          onMessage: (msg) =>
            msg.phase === 'output' ? allow('[redacted by policy]', 'PII rule') : allow(),
        },
      ],
    })
    .maxIterations(9)
    .build();

  await rewritten.run({ message: 'refund my order' });
  const broken = rewritten.outputContractUnmet();
  console.log(`\n   with an output rule that rewrites the answer:`);
  console.log(`   brokenBy: ${broken?.brokenBy} — retriesSpent: ${broken?.retriesSpent}`);
  console.log('   the model answered correctly; three billed re-asks would have produced');
  console.log('   three more correct answers for the same rule to break identically.');
}
// #endregion says-so

// ─── Driver ──────────────────────────────────────────────────────

export async function run(_input?: string, provider?: LLMProvider): Promise<void> {
  await scenarioTeaches(provider);
  await scenarioGivesUp();
  await scenarioForced();
  await scenarioSaysSo();
  console.log('\nAll four scenarios complete.');
}

// Browser-safe auto-run guard (see helpers/cli.ts).
if (isCliEntry(import.meta.url)) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
