/**
 * 06 — toBacktrackTrace: feed the "why?" board straight off a localizer run.
 *
 * Takes the EXACT scenario from example 05 (the planted-fact hunt: a
 * misleading 'vip-override-fact' makes a refunds agent approve a
 * 47-day-old refund; `localizeContextBug` confirms it by ablation,
 * 3/3 seeded reruns flip) and serializes the report into agentThinkingUI's
 * `BacktrackTrace` contract — the shape `<BacktrackView>`/`<BacktrackOverlay>`
 * render as the scrubbable "why?" board:
 *
 *   the bug → who answered → what it was given → the scores → the test
 *   → the culprit (chain-of-custody rewind)
 *
 * What the mapper carries over for free: TRUE report ranks on every card
 * (cards are a subset — structural hops fold with full disclosure),
 * `upperBound` on path-only scores (hatched meters), verdicts ONLY where
 * ablation produced them, honesty flags verbatim + the claims-discipline
 * lines. What only the caller knows: the `answer` text (required) and the
 * recorded-state `custody` panes for the rewind player (optional callback —
 * here the assembled-prompt evidence for the confirmed culprit).
 *
 * Run:  npx tsx examples/observability/06-backtrack-trace.ts
 */

import { toBacktrackTrace, type BacktrackTrace } from '../../src/observe.js';
import { run as runContextBisect } from './05-context-bisect.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/06-backtrack-trace',
  title: 'toBacktrackTrace — serialize a localizer report for the why-board UI',
  group: 'observability',
  description:
    'Serializes the example-05 causal localizer report into the BacktrackTrace contract that ' +
    'agentThinkingUI renders: true ranks on subset cards, folded structural hops disclosed, ' +
    'upperBound on path-only scores, verdicts only where ablation produced them, honesty lines ' +
    'verbatim, plus a consumer-supplied custody pane for the rewind player.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'backtrack', 'visualization', 'rfc-003'],
};

export interface BacktrackTraceResult {
  trace: BacktrackTrace;
  transcript: string;
}

export async function run(_input?: string | null): Promise<BacktrackTraceResult> {
  const out: string[] = [];

  // 1 — the planted-fact hunt from example 05 (causal mode, ablation verdicts)
  const bisect = await runContextBisect();

  // 2 — serialize for the UI. `answer` is the one thing the report can't
  //     know; `custody` enriches the culprit's rewind with recorded state.
  const trace = toBacktrackTrace(bisect.part1Report, {
    claim: 'The agent approved a refund 47 days past the 30-day window — why?',
    answer: { text: bisect.buggyAnswer, label: 'the wrong answer' },
    agent: 'refunds-assistant',
    model: 'mock-1',
    custody: (suspect) =>
      suspect.verdict?.verdict === 'confirmed' && suspect.detail?.text
        ? [
            {
              step: 'born',
              detail: `defineFact('${suspect.detail.injectionId}') — trigger: always (who wrote it)`,
              at: 'defineFact()',
              content: `data: '${suspect.detail.text}'`,
              highlight: suspect.detail.text,
            },
            {
              step: 'landed',
              detail: `${suspect.source} wrote systemPromptInjections (who mutated state)`,
              at: suspect.source,
              variable: 'systemPromptInjections',
            },
            {
              step: 'read',
              detail: `${bisect.part1Report.step} assembled the system prompt from it`,
              at: bisect.part1Report.step,
              variable: 'systemPrompt',
            },
            { step: 'answer', detail: `"${bisect.buggyAnswer.slice(0, 60)}…" — the bug` },
          ]
        : undefined,
  });

  // 3 — what the board will show
  out.push('═══ BacktrackTrace (for <BacktrackView trace={...} />) ═══', '');
  out.push(`claim:     ${trace.claim}`);
  out.push(`mode:      ${trace.mode}`);
  out.push(`decidedAt: ${trace.decidedAt.id} "${trace.decidedAt.label}"`);
  out.push(`cards:     ${trace.suspects.length} (true ranks: ${trace.suspects.map((s) => '#' + s.rank).join(' ')})`);
  for (const s of trace.suspects) {
    out.push(
      `  #${s.rank} [${s.flavor ?? s.kind}] ${s.name} — influence ${s.score.toFixed(2)}${s.upperBound ? '*' : ''}` +
        (s.verdict ? ` — ${s.verdict.kind === 'confirmed' ? `CAUSAL ✓ ${s.verdict.flips}/${s.verdict.samples}` : `not confirmed ${s.verdict.flips}/${s.verdict.samples}`}` : ''),
    );
  }
  if (trace.folded) out.push(`folded:    ${trace.folded}`);
  if (trace.scoreNote) out.push(`scoreNote: ${trace.scoreNote}`);
  if (trace.baseline) out.push(`baseline:  ${trace.baseline}`);
  out.push('honesty:');
  for (const h of trace.honesty ?? []) out.push(`  ${h}`);

  // sanity — the planted fact survives serialization as the only causal card
  const confirmed = trace.suspects.filter((s) => s.verdict?.kind === 'confirmed');
  if (confirmed.length !== 1 || confirmed[0].name !== 'vip-override-fact') {
    throw new Error('expected exactly the planted fact to carry the causal verdict');
  }
  out.push('', `CONFIRMED CARD: #${confirmed[0].rank} '${confirmed[0].name}' — the board stamps exactly this one.`);

  const transcript = out.join('\n');
  console.log(transcript);
  return { trace, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
