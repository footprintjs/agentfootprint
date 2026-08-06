/**
 * 47 — Skills authored as FILES, routed by a graph.
 *
 * WHY THIS EXISTS (the rationale, for humans + coding agents):
 * `skillsFromDir` keeps skill bodies where prose belongs — in files, next to the code
 * they describe, reviewable in a diff. What was never written down is what a
 * `SKILL.md` can and cannot carry, so people reached for fields that do not exist and
 * then wondered why a loaded skill unlocked no tools.
 *
 * A `SKILL.md` carries exactly three things: `name`, `description`, and the body after
 * the closing `---`. A tool is code with an `execute`, and a markdown file has none —
 * so **every loaded skill is body-only**: no `tools`, no `autoActivate`, no per-file
 * `surfaceMode` (that one is settable for the whole directory, all of them or none).
 * Unknown frontmatter keys are ignored rather than rejected, so a file stays portable
 * to other tools.
 *
 * That limit is not a wall. This example shows the pattern it points at: load the
 * prose-shaped skills from disk, define the tool-carrying ones in code, and hand the
 * MIXED list to `skillGraph({ skills })` — the graph does not care which half a skill
 * came from.
 *
 * The directory is written to a temp folder here so the example runs anywhere with no
 * fixtures to keep in sync.
 *
 * Run:  npx tsx examples/features/47-skills-from-dir-graph.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { skillsFromDir, skillGraph, defineSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/47-skills-from-dir-graph',
  title: 'Skills authored as files — skillsFromDir into a skill graph',
  group: 'features',
  description:
    'What a SKILL.md can and cannot carry (name + description + body — no tools, no autoActivate, no per-file surfaceMode), and the pattern that limit points at: load the prose-shaped skills from disk, define the tool-carrying ones in code, hand the mixed list to skillGraph({ skills }).',
  defaultInput: 'my invoice looks wrong',
  providerSlots: [],
  tags: ['feature', 'skills', 'graph', 'skills-from-dir', 'authoring'],
};

const SKILL_FILE = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n# an unknown key another tool owns — ignored, not rejected\nowner: support-team\n---\n${body}\n`;

function writeSkillDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-skills-'));
  for (const [name, description, body] of [
    ['triage', 'Start here: work out what the customer is asking about.', 'Read the message. If it mentions an invoice, charge or refund, hand off to billing.'],
    ['billing', 'Use for invoices, charges and billing questions.', 'Confirm the customer identity first. Then call get_invoice(id) and explain each line.'],
  ] as const) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), SKILL_FILE(name, description, body), 'utf8');
  }
  return dir;
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const dir = writeSkillDirectory();
  try {
    // ── 1. What the loader gives you ─────────────────────────────────────────
    // Sorted by name, so a chart built from this is stable whatever order the
    // filesystem handed the files back.
    const loaded = await skillsFromDir(dir);
    const shape = loaded.map((s) => ({
      id: s.id,
      description: s.description,
      // Body-only: this is the limit, shown rather than asserted.
      tools: (s.inject.tools ?? []).length,
      autoActivate: (s.metadata as { autoActivate?: string }).autoActivate ?? '(none)',
      surfaceMode: (s.metadata as { surfaceMode?: string }).surfaceMode,
    }));

    // ── 2. The tool-carrying half, defined in code ───────────────────────────
    // `get_invoice` is what the billing BODY tells the model to call, and a markdown
    // file cannot carry it — so the skill that owns it is defined here.
    const invoiceLookup = defineSkill({
      id: 'invoice-lookup',
      description: 'Fetch an invoice by id.',
      body: 'Call get_invoice(id) and read the line items back to the customer.',
      tools: [
        defineTool({
          name: 'get_invoice',
          description: 'Fetch one invoice by id',
          execute: () => JSON.stringify({ id: 'INV-42', total: '119.00', lines: 3 }),
        }),
      ],
      autoActivate: 'currentSkill',
    });

    // ── 3. One graph over the MIXED list ─────────────────────────────────────
    // `knownTools` tells the check-up about the agent's baseline tools, so the
    // billing body's `get_invoice(id)` is not read as a typo. (It belongs to
    // `invoice-lookup`, so it is reported as a cross-skill handoff instead —
    // which is exactly what the body means it to be.)
    const graph = skillGraph({
      skills: [...loaded, invoiceLookup],
      start: 'triage',
      steps: [
        { from: 'triage', to: 'billing', onToolReturn: 'read_skill', label: 'billing intent' },
        { from: 'billing', to: 'invoice-lookup', onToolReturn: 'read_skill', label: 'needs the invoice' },
      ],
      check: 'throw',
    });

    // ── 4. Run it ────────────────────────────────────────────────────────────
    const agent = Agent.create({
      provider: provider ?? mock({ reply: 'Your invoice INV-42 totals 119.00 across 3 lines.' }),
      model: provider ? 'claude-sonnet-4-5' : 'mock',
      maxIterations: 4,
    })
      .system('You are a support agent. Follow the active skill.')
      .skillGraph(graph)
      .build();

    const result = await agent.run({ message: input });

    return {
      loadedFromDisk: shape,
      // The pattern the limit points at, stated as data.
      mixedGraph: graph.skills.map((s) => ({
        id: s.id,
        from: loaded.some((l) => l.id === s.id) ? 'SKILL.md' : 'defineSkill()',
        tools: (s.inject.tools ?? []).map((t) => t.schema.name),
      })),
      checkup: graph.checkup({ knownTools: ['get_invoice'] }),
      mermaid: graph.toMermaid(),
      answer: typeof result === 'string' ? result : '(paused)',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
