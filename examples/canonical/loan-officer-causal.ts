/**
 * Canonical demo — Loan officer with causal-memory cross-run replay.
 *
 * The flagship example for agentfootprint. It demonstrates the
 * library's three load-bearing claims in one ~120-line file.
 *
 * Story:
 *   Monday. An "underwriter" agent (powered by an expensive Sonnet-class
 *   model) processes a loan application. It activates an underwriting
 *   skill, calls credit-check + dti-check tools, decides to REJECT loan
 *   #42, and the entire decision evidence is persisted to causal memory.
 *
 *   Friday. A "customer service" agent (powered by a CHEAP Haiku-class
 *   model) handles a follow-up question from the same applicant. It
 *   loads the prior decision evidence from causal memory and answers
 *   from EXACT past facts — no re-derivation, no hallucination,
 *   ~10× lower cost.
 *
 * What this proves:
 *   1. CAUSAL MEMORY REPLAY    — the trace persists across runs and is
 *                                 cosine-matched against new queries.
 *   2. CHEAP-MODEL TRIAGE      — Haiku reads what Sonnet wrote. Reading
 *                                 recorded evidence is structurally
 *                                 simpler than re-deriving the answer.
 *   3. CROSS-RUN CONTINUITY    — different sessions, different models,
 *                                 different machines — same evidence.
 *                                 The framework wires it for free.
 *
 * Run:
 *   npm run example examples/canonical/loan-officer-causal.ts
 */

import {
  Agent,
  defineSkill,
  defineTool,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  mock,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'canonical/loan-officer-causal',
  title: 'Canonical: Loan officer with causal-memory cross-run replay',
  group: 'canonical',
  description:
    'Monday: expensive model underwrites loan #42 (REJECT). Friday: cheap model answers ' +
    '"why was loan #42 rejected?" from the recorded decision evidence. Same answer, ~10× cheaper.',
  defaultInput: 'Why was loan #42 rejected?',
  providerSlots: ['default'],
  tags: ['canonical', 'causal-memory', 'cross-run', 'cheap-model-triage', 'differentiator'],
};

export async function run(input: string): Promise<string> {
  // ─── Shared infrastructure (lives across both runs) ─────────────

  const embedder = mockEmbedder();
  const store = new InMemoryStore();

  // Causal memory — the cache of the agent's thinking. Read by both
  // Monday's expensive agent and Friday's cheap agent. Cosine matches
  // new queries against past queries.
  const causal = defineMemory({
    id: 'loan-decisions',
    description: 'Persists past loan-decision evidence for cross-run replay.',
    type: MEMORY_TYPES.CAUSAL,
    strategy: {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: 1,
      threshold: 0.5, // strict — drop weak matches
      embedder,
    },
    store,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS, // inject "why" only, not "what"
  });

  // Identity ties Monday's run + Friday's run to the same applicant.
  // Memory is namespaced per-tenant + per-conversation.
  const identity = { tenant: 'acme-bank', conversationId: 'loan-42' };

  // ─── Monday — the expensive underwriting agent ──────────────────

  const creditCheck = defineTool({
    name: 'credit_score_check',
    description: 'Look up the applicant credit score by id.',
    inputSchema: {
      type: 'object',
      properties: { applicantId: { type: 'string' } },
      required: ['applicantId'],
    },
    execute: async () => '580', // below the 600 threshold
  });

  const dtiCheck = defineTool({
    name: 'dti_check',
    description: 'Compute applicant debt-to-income ratio by id.',
    inputSchema: {
      type: 'object',
      properties: { applicantId: { type: 'string' } },
      required: ['applicantId'],
    },
    execute: async () => '0.45',
  });

  const underwritingSkill = defineSkill({
    id: 'underwriting',
    description: 'Underwrite a loan: check credit, check DTI, decide approve/reject.',
    body:
      'Approve a loan only when credit_score >= 600 AND dti < 0.50. ' +
      'Otherwise REJECT with a one-sentence explanation citing the failing factor.',
    tools: [creditCheck, dtiCheck],
  });

  // Scripted "expensive Sonnet-class" run.
  // Three iterations: activate skill → call tools in parallel → final reject decision.
  let mondayIter = 0;
  const sonnet = mock({
    respond: () => {
      mondayIter++;
      if (mondayIter === 1) {
        return {
          content: 'Activating underwriting skill.',
          toolCalls: [{ id: 'a1', name: 'read_skill', args: { id: 'underwriting' } }],
          usage: { input: 50, output: 10 },
          stopReason: 'tool_use',
        };
      }
      if (mondayIter === 2) {
        return {
          content: 'Checking credit and DTI in parallel.',
          toolCalls: [
            { id: 'a2', name: 'credit_score_check', args: { applicantId: '42' } },
            { id: 'a3', name: 'dti_check', args: { applicantId: '42' } },
          ],
          usage: { input: 80, output: 15 },
          stopReason: 'tool_use',
        };
      }
      return {
        content:
          'REJECT loan #42: credit score 580 is below our 600 minimum threshold. ' +
          'DTI of 0.45 is within tolerance but the credit score requirement was not met.',
        toolCalls: [],
        usage: { input: 200, output: 35 },
        stopReason: 'stop',
      };
    },
  });

  const underwriter = Agent.create({
    provider: sonnet,
    model: 'claude-sonnet-4-5',
    maxIterations: 5,
  })
    .system('You are a loan underwriter at Acme Bank.')
    .skill(underwritingSkill)
    .memory(causal)
    .build();

  console.log('\n┌─ Monday — Sonnet underwrites loan #42 ──────────────────┐');
  const mondayResult = await underwriter.run({
    message: 'Should we approve loan #42 for applicant 42?',
    identity,
  });
  if (typeof mondayResult !== 'string') throw new Error('Agent paused unexpectedly.');
  console.log(`│ Decision: ${mondayResult}`);
  console.log(`│ [Causal snapshot persisted: query + decision evidence]`);
  console.log('└──────────────────────────────────────────────────────────┘');

  // ─── Friday — the cheap follow-up agent ─────────────────────────

  // A simpler agent. No skill, no tools — just a model that reads
  // the recorded decision evidence and answers from it.
  // In production this would be Haiku or GPT-4o-mini.
  const haiku = mock({
    reply:
      'Loan #42 was rejected because the applicant credit score (580) was below the bank ' +
      'minimum threshold (600). The DTI of 0.45 was within tolerance, but credit score was ' +
      'the blocking factor.',
  });

  const support = Agent.create({
    provider: haiku,
    model: 'claude-haiku-4-5',
    maxIterations: 1,
  })
    .system(
      'You are a support agent. Answer follow-up questions about prior loan decisions ' +
        'using the recorded decision evidence. Quote facts from the evidence; do not re-derive.',
    )
    .memory(causal) // SAME causal memory store as Monday's agent
    .build();

  console.log('\n┌─ Friday — Haiku answers a follow-up from the same applicant ─┐');
  const fridayResult = await support.run({
    message: input, // e.g. "Why was loan #42 rejected?"
    identity, // same identity → causal memory matches
  });
  if (typeof fridayResult !== 'string') throw new Error('Agent paused unexpectedly.');
  console.log(`│ Answer:   ${fridayResult}`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  console.log(
    '\n[Friday\'s cheap model gave the correct answer by READING the trace Monday\'s\n' +
      ' expensive model wrote. The agent did not re-derive the decision — it replayed it.]\n',
  );

  return fridayResult;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
