import { describe, it, expect } from 'vitest';
import { attributeChoice } from '../../../src/lib/influence-core/attribute.js';
import { staticEmbedder } from '../../../src/embedders/index.js';
import type { AttributionUnit, Embedder } from '../../../src/lib/influence-core/types.js';

/** Deterministic embedder: fixed vectors per exact text (unknown → zero). */
function fakeEmbedder(map: Record<string, number[]>, dimensions = 2): Embedder {
  const vec = (t: string) => map[t] ?? new Array<number>(dimensions).fill(0);
  return {
    dimensions,
    async embed({ text }) {
      return vec(text);
    },
    async embedBatch({ texts }) {
      return texts.map(vec);
    },
  };
}

describe('attributeChoice — the math (deterministic embedder)', () => {
  it('ranks units by cosine to the tool and clamps negatives out of channel mass', async () => {
    const units: AttributionUnit[] = [
      { id: 'aligned', channel: 'system', text: 'A' }, // same direction as tool
      { id: 'against', channel: 'system', text: 'B' }, // opposite direction
      { id: 'orthogonal', channel: 'task', text: 'C' }, // perpendicular → 0
    ];
    const embedder = fakeEmbedder({ TOOL: [1, 0], A: [1, 0], B: [-1, 0], C: [0, 1] });

    const r = await attributeChoice({ tool: { name: 'tool', text: 'TOOL' }, units, embedder });

    expect(r.units.map((u) => u.id)).toEqual(['aligned', 'orthogonal', 'against']); // 1, 0, -1
    expect(r.top.id).toBe('aligned');
    expect(r.top.score).toBeCloseTo(1, 5);
    // only 'aligned' had positive mass → its channel owns 100%, negatives clamped
    expect(r.byChannel).toEqual({ system: 1 });
  });

  it('splits channel mass proportionally across positive units', async () => {
    const units: AttributionUnit[] = [
      { id: 'r1', channel: 'system', text: 'A' },
      { id: 'task', channel: 'task', text: 'C' },
    ];
    // tool at 45° → equal cosine (~0.707) to both axes → 50/50 split
    const embedder = fakeEmbedder({ TOOL: [1, 1], A: [1, 0], C: [0, 1] });
    const r = await attributeChoice({ tool: { name: 't', text: 'TOOL' }, units, embedder });
    expect(r.byChannel['system']).toBeCloseTo(0.5, 5);
    expect(r.byChannel['task']).toBeCloseTo(0.5, 5);
  });

  it('throws on empty units or duplicate ids (caller wiring bugs)', async () => {
    const embedder = fakeEmbedder({});
    await expect(
      attributeChoice({ tool: { name: 't', text: 'x' }, units: [], embedder }),
    ).rejects.toThrow(/non-empty/);
    await expect(
      attributeChoice({
        tool: { name: 't', text: 'x' },
        units: [
          { id: 'dup', channel: 'system', text: 'a' },
          { id: 'dup', channel: 'task', text: 'b' },
        ],
        embedder,
      }),
    ).rejects.toThrow(/duplicate unit id/);
  });
});

// The real proof, over the ACTUAL dress-shop system-prompt rules (potion
// embeddings): a PROCEDURAL pick attributes to the rule that names it, a
// TOPICAL pick attributes to the task. This is the exact whats_here→rule-1
// case the debugger shows.
describe('attributeChoice — real dress-shop rules (potion)', () => {
  const RULES: AttributionUnit[] = [
    {
      id: 'rule-1',
      channel: 'system',
      text: 'Call whats_here first — it tells you where the user is, what happened since your last look, and which actions and skills exist right now.',
    },
    {
      id: 'rule-2',
      channel: 'system',
      text: 'For a multi-step task, call its skill tool with no arguments to open it: the result lists readySteps.',
    },
    {
      id: 'rule-4',
      channel: 'system',
      text: 'High-effect steps come back as needs-confirm. You must then call request_confirmation and only after approval call the skill again with confirm: true.',
    },
    {
      id: 'rule-6',
      channel: 'system',
      text: 'If no action or skill can serve the request, call report_gap with the user’s ask before telling them you can’t help.',
    },
  ];
  const TASK: AttributionUnit = { id: 'task', channel: 'task', text: 'find me a red evening dress under $150' };

  // The headline proof: each PROCEDURAL pick attributes to the exact rule
  // that names it — and to a DIFFERENT rule per tool, so this is real
  // discrimination, not one lucky match. whats_here→rule-1 is the case the
  // debugger shows; the margin/semantic scorer can never surface it.
  it.each([
    ['whats_here', 'whats_here: describe the current position and what is fireable now', 'rule-1'],
    ['request_confirmation', 'request_confirmation: ask the user to approve a high-effect step', 'rule-4'],
    ['report_gap', 'report_gap: record that no skill can serve the request', 'rule-6'],
  ])('attributes procedural pick %s to %s (system-dominant)', async (name, text, expectedRule) => {
    const r = await attributeChoice({
      tool: { name, text },
      units: [TASK, ...RULES],
      embedder: staticEmbedder(),
    });
    expect(r.top.id).toBe(expectedRule);
    expect(r.top.channel).toBe('system');
    expect(r.byChannel['system'] ?? 0).toBeGreaterThan(r.byChannel['task'] ?? 0);
  }, 30_000);

  // HONEST Tier-1 limitation (pinned as a characterization test): a TOPICAL
  // pick does NOT cleanly attribute to the task. skill_find-dress's own
  // procedural vocabulary ("skill", "search", "catalog") pulls it toward
  // generic rules, so the task never wins on similarity alone. This is
  // exactly why the LLM-judge (Tier 2) and ablation (Tier 3) exist — Tier 1
  // nails rule-named procedural picks but is noisy on topical ones.
  it('does NOT lift the task to the top for the topical pick skill_find-dress (Tier-1 limit)', async () => {
    const r = await attributeChoice({
      tool: { name: 'skill_find-dress', text: 'skill_find-dress: search the dress catalog, filter by color, open one' },
      units: [TASK, ...RULES],
      embedder: staticEmbedder(),
    });
    expect(r.top.channel).not.toBe('task'); // similarity alone can't isolate the topical driver
    expect(r.top.id).not.toBe('rule-1'); // but it also does NOT misfire onto the orient rule
  }, 30_000);
});
