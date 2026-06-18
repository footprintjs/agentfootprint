/**
 * gen-backtrack-board — GENERATE the backtrack-board demo data from a REAL
 * localizer run. Nothing here is hand-authored: every score, rank, verdict,
 * honesty line, and custody pane is produced by running the actual
 * `localizeContextBug` → `toBacktrackTrace` pipeline on the example-05 scenario
 * (deterministic scripted mock provider). Re-run to regenerate; the output is
 * `demo/backtrack-traces.generated.js`, which `demo/index.html` renders with
 * agentThinkingUI's <BacktrackView>.
 *
 * Four decision points, all from the SAME captured run:
 *   rank   — final call, ranking only (correlational — no ablation runner)
 *   answer — final call, + ablation (causal — the same case, proven)
 *   tool   — the first call's tool choice (correlational)
 *   rule   — the decide() loan chart (control-edge chain, correlational)
 *
 * Run:  TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx demo/gen-backtrack-board.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findLastWriter, commitValueAt } from 'footprintjs/trace';
import {
  embeddingCache,
  localizeContextBug,
  toBacktrackTrace,
  type ContextBugArtifacts,
  type ContextBugReport,
  type ToBacktrackTraceOptions,
} from '../src/observe.js';
import { mockEmbedder } from '../src/memory/embedding/mockEmbedder.js';
import { run as runBisect } from '../examples/observability/05-context-bisect.js';

const embedder = () => embeddingCache(mockEmbedder());

/** Pull the REAL recorded systemPromptInjections at the trigger call, and the
 *  assembled system prompt the model actually saw — from the snapshot's commit
 *  log, not a template. Used to fill the custody rewind with recorded state. */
function recordedSystemPrompt(artifacts: ContextBugArtifacts): {
  injections: { sourceId?: string; rawContent?: string; source?: string }[];
  prompt: string;
} {
  const log = (artifacts.snapshot as { commitLog?: unknown }).commitLog as
    | { idx: number }[]
    | undefined;
  if (!log) return { injections: [], prompt: '' };
  const writer = findLastWriter(log as never, 'systemPromptInjections');
  const injections = (writer
    ? (commitValueAt(log as never, writer.idx, 'systemPromptInjections') as unknown[])
    : []) as { sourceId?: string; rawContent?: string; source?: string }[];
  const prompt = injections
    .map((i) => i.rawContent)
    .filter((t): t is string => typeof t === 'string')
    .join('\n\n');
  return { injections, prompt };
}

/** A custody callback that replays RECORDED STATE (no hand-authored narrative):
 *  born (the fact's own definition), landed (the commit that wrote it), read
 *  (the exact assembled system prompt). Only enriches a content-bearing suspect. */
function custodyFrom(artifacts: ContextBugArtifacts, step: string): ToBacktrackTraceOptions['custody'] {
  const { injections, prompt } = recordedSystemPrompt(artifacts);
  return (suspect) => {
    const id = suspect.detail?.injectionId;
    const text = suspect.detail?.text;
    if (id === undefined || text === undefined) return undefined;
    const rec = injections.find((i) => i.sourceId === id);
    return [
      {
        step: 'born',
        detail: `defined as a ${suspect.detail?.flavor ?? suspect.kind} injection (who wrote it)`,
        at: suspect.source,
        content: `data: ${JSON.stringify(text)}`,
        highlight: text,
      },
      {
        step: 'landed',
        detail: `the Context stage WROTE it into systemPromptInjections (who mutated state)`,
        at: suspect.source,
        variable: 'systemPromptInjections',
        content: rec
          ? `{ source: ${JSON.stringify(rec.source)}, sourceId: ${JSON.stringify(rec.sourceId)},\n  rawContent: ${JSON.stringify(rec.rawContent)} }`
          : '(recorded injection record)',
        highlight: text,
      },
      {
        step: 'read',
        detail: `${step} READ it into the system prompt — exactly what the model saw`,
        at: step,
        variable: 'systemPrompt',
        content: prompt,
        highlight: text,
      },
      { step: 'answer', detail: 'the wrong decision came out of this call — the bug' },
    ];
  };
}

const sharedClaim = 'The agent approved a refund 47 days past the 30-day window — why?';

async function main() {
  const bisect = await runBisect();
  const { part1Artifacts, part2Artifacts, part1Report, part2Report, buggyAnswer } = bisect;
  const finalStep = part1Artifacts.llmIds[part1Artifacts.llmIds.length - 1];
  const firstStep = part1Artifacts.llmIds[0];

  // re-localize the SAME captured run at the points the board needs.
  const rankReport: ContextBugReport = await localizeContextBug({
    artifacts: part1Artifacts,
    embedder: embedder(),
    atStep: finalStep,
  }); // correlational (no rerun) — ranking only
  const toolReport: ContextBugReport = await localizeContextBug({
    artifacts: part1Artifacts,
    embedder: embedder(),
    atStep: firstStep,
  }); // the first call's tool choice

  const traces = {
    rank: {
      pick: '1 · backtrack — ranking only',
      order: 1,
      ...toBacktrackTrace(rankReport, {
        claim: sharedClaim,
        answer: { text: buggyAnswer, label: 'the wrong answer' },
        agent: 'refunds-assistant',
        model: 'mock-1',
        custody: custodyFrom(part1Artifacts, finalStep),
      }),
    },
    answer: {
      pick: '2 · + ablation — the proof',
      order: 2,
      ...toBacktrackTrace(part1Report, {
        claim: sharedClaim,
        answer: { text: buggyAnswer, label: 'the wrong answer' },
        agent: 'refunds-assistant',
        model: 'mock-1',
        custody: custodyFrom(part1Artifacts, finalStep),
      }),
    },
    tool: {
      pick: 'tool choice — first call',
      order: 3,
      ...toBacktrackTrace(toolReport, {
        claim: 'Iteration 1 — the agent chose lookup_order. What was it given?',
        answer: { text: 'tool call → lookup_order(...) — chosen before any tool result existed.', label: 'the decision under investigation', tone: 'question' },
        agent: 'refunds-assistant',
        model: 'mock-1',
        custody: custodyFrom(part1Artifacts, firstStep),
      }),
    },
    rule: {
      pick: 'rule decision — decide()',
      order: 4,
      ...toBacktrackTrace(part2Report, {
        claim: 'The pipeline approved an unaffordable loan — why?',
        answer: { text: 'decision = approve (DTI computed against ANNUAL income — should be DECLINE)', label: 'the rule decision', tone: 'question' },
        agent: 'loan-pipeline',
        model: 'decide()',
      }),
    },
  };

  const banner =
    '/* GENERATED — do not edit by hand. Produced by demo/gen-backtrack-board.ts from a REAL\n' +
    ' * localizeContextBug → toBacktrackTrace run (example-05 scenario, deterministic mock provider).\n' +
    ' * Every score, rank, verdict, honesty line, and custody pane is computed, not authored.\n' +
    ' * Regenerate: TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx demo/gen-backtrack-board.ts */\n';
  const body = `window.BACKTRACK_TRACES = ${JSON.stringify(traces, null, 2)};\n`;
  const outPath = fileURLToPath(new URL('./backtrack-traces.generated.js', import.meta.url));
  writeFileSync(outPath, banner + body);

  // sanity: the planted fact is the one causal card in the answer scenario.
  const confirmed = traces.answer.suspects.filter((s) => s.verdict?.kind === 'confirmed');
  if (confirmed.length !== 1 || confirmed[0].name !== 'vip-override-fact') {
    throw new Error('generator: expected exactly the planted fact to carry the causal verdict');
  }
  console.log(`✓ generated ${outPath}`);
  console.log(`  scenarios: ${Object.keys(traces).join(', ')}`);
  console.log(`  answer: ${traces.answer.suspects.length} cards, causal card = '${confirmed[0].name}' (${confirmed[0].verdict?.flips}/${confirmed[0].verdict?.samples})`);
  console.log(`  rank:   ${traces.rank.suspects.length} cards, mode ${traces.rank.mode} (no verdicts)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
