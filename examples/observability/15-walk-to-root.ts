/**
 * 15 — Walk to root (L4): the influence-guided backtracking debugger.
 *
 * A DECISION bug has a root ≠ proximate: a planted instruction (loop 1) makes the agent call the WRONG
 * tool; the wrong tool's OUTPUT (loop 2) resembles the final answer, so plain final-answer influence
 * blames the PROXIMATE and buries the root. `walkToRoot` walks backward: NARROW with per-loop influence
 * → HOP along `writerId` provenance to the loop that produced the culprit → ISOLATE with run-wide
 * ablation. `root` is the DEEPEST hop ablation convicts — the planted instruction, not the tool output.
 *
 * HONEST SCOPE (printed below): this demo uses a CONSTRUCTED trajectory that surfaces the proximate
 * tool output as a hoppable suspect, so the cross-loop descent fires. On a REAL flat agent today the
 * call-llm reads `history` (aggregate), not `lastToolResult`, so the trajectory surfaces only injection
 * suspects and the multi-hop descent does NOT yet fire — it convicts the injection root at the symptom.
 * Promoting the real-agent descent is gated on enriching the trajectory's tool-output provenance.
 *
 * Run: npx tsx examples/observability/15-walk-to-root.ts
 */
import { walkTrajectory, type AblationRerun } from '../../src/observe';
import type { Embedder } from '../../src/lib/influence-core';

export const meta = {
  id: '15',
  title: 'walk to root — narrow → hop → convict, symptom to root',
  description:
    'walkToRoot walks a decision bug backward (per-loop narrow → writerId provenance hop → run-wide ' +
    'ablation) to the ROOT instruction that plain final-answer influence buries behind the proximate ' +
    'tool output. The narrow is a proxy; only ablation convicts the root.',
};

// Controllable embedder: the plant matches the loop-1 DECISION; the tool output matches the ANSWER.
const TABLE: Record<string, number[]> = {
  DECISION: [0, 0, 1], ANSWER: [1, 0, 0], PLANT_TEXT: [0, 0, 1], PROMO_TEXT: [1, 0, 0],
};
const embedder: Embedder = { dimensions: 3, async embed({ text }) { return TABLE[text] ?? [0, 0, 0]; } };

const inj = (id: string, text: string, writerId: string) => ({
  key: 'systemPromptInjections', writerId, writerArrayIdx: 0,
  value: [{ source: 'instructions', sourceId: id, rawContent: text }],
  evidence: { id: `e:${id}`, text: '', ancestorTexts: [] },
});
const tool = (name: string, result: string, writerId: string) => ({
  key: 'lastToolResult', writerId, writerArrayIdx: 0,
  value: { toolName: name, result },
  evidence: { id: `e:${name}`, text: '', ancestorTexts: [] },
});
const frame = (loopIndex: number, anchor: string, bodyIds: string[], sources: unknown[]) => ({
  loopIndex, llmCallId: `call-llm#${loopIndex}`, llmCallArrayIdx: loopIndex, headArrayIdx: 0,
  bodyIds, intermediateText: anchor, contextSources: sources, untrackedReadsPresent: false,
});

// loop1 (wrong choice) reads the plant; loop2 (symptom) reads getPromo, written by loop1's tool-calls.
const trajectory = {
  frames: [
    frame(0, 'SETUP', ['ie#0'], [inj('plant', 'PLANT_TEXT', 'ie#0')]),
    frame(1, 'DECISION', ['ie#1', 'tc#1'], [inj('plant', 'PLANT_TEXT', 'ie#1')]),
    frame(2, 'ANSWER', ['ie#2', 'tc#2'], [inj('plant', 'PLANT_TEXT', 'ie#2'), tool('getPromo', 'PROMO_TEXT', 'tc#1')]),
  ],
  prelude: [], honestyFlags: [],
} as never;

// Ablation flips ONLY when the planted instruction is removed (the root); removing the proximate holds.
const rerun: AblationRerun = {
  originalOutput: 'ANSWER',
  runner: async (specs) =>
    specs.some((s) => s.kind === 'injection' && s.excludeInjectionIds.includes('plant')) ? 'FLIPPED' : 'ANSWER',
  samples: 2,
};

async function main(): Promise<void> {
  const path = await walkTrajectory(trajectory, { embedder, rerun, beamK: 1 });
  console.log('Walk (symptom → root):');
  path.hops.forEach((h, i) =>
    console.log(
      `  hop ${i}  loop ${h.loopIndex}  ${h.suspectId.padEnd(9)} ` +
        `${h.verdict?.verdict === 'confirmed' ? 'ABLATION FLIPPED ✓' : 'no flip'}` +
        `${h.cameFrom !== undefined ? `  → descends to loop ${h.cameFrom}` : ''}` +
        `${h.note ? `  [${h.note}]` : ''}`,
    ),
  );
  console.log(`\nROOT: ${path.root ? `${path.root.suspectId} at loop ${path.root.loopIndex} (ablation-convicted)` : '(none convicted)'}`);
  console.log(
    '\nTakeaway: plain influence blames getPromo (the proximate output resembles the answer). walkToRoot\n' +
      'hops along provenance from the tool output back to the loop that produced it, and ablation convicts\n' +
      'the planted instruction as the ROOT. Narrow (proxy) → hop (provenance) → convict (ablation).',
  );
}

void main();
