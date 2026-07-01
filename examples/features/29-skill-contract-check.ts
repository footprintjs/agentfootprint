/**
 * 29 — Skill-body ↔ tool-contract check (proposal 009, Tier 1).
 *
 * A skill's `body` (prose injected into the system prompt) can quietly contradict
 * the tools it actually unlocks — and the model then refuses a tool that's right
 * there, or is told about one it can't call. `graph.checkup()` now also runs a
 * DETERMINISTIC (no-LLM) body↔tool consistency pass and surfaces:
 *
 *   • body-foreign-tool  — the body names a tool that belongs to ANOTHER skill
 *                          (the model is told about a tool it can't call here —
 *                          usually an intentional read_skill handoff; confirm it).
 *   • body-unknown-tool  — the body has a `tool_name(` call to a tool that exists
 *                          nowhere (a typo or a renamed/removed tool).
 *
 * Both are WARNINGS (never errors) — they never fail `.build()`. Use the standalone
 * `checkSkillContract(skill, knownTools?)` to check a skill outside a graph.
 *
 * Run:  npx tsx examples/features/29-skill-contract-check.ts
 */

import { defineTool, type LLMProvider } from '../../src/index.js'
import { defineSkill, skillGraph, checkSkillContract } from '../../src/injection-engine.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/29-skill-contract-check',
  title: 'Skill graph — body ↔ tool-contract check (catch "told about an uncallable tool")',
  group: 'features',
  description:
    'graph.checkup() runs a deterministic body↔tool consistency pass: body-foreign-tool (body names a tool from another skill) and body-unknown-tool (a tool_name( reference to a tool that exists nowhere). Both are warnings; checkSkillContract checks a skill standalone.',
  defaultInput: '(no input — static analysis of the declared graph)',
  providerSlots: [],
  tags: ['feature', 'skills', 'graph', 'checkup', 'contract'],
};

const t = (name: string) =>
  defineTool({
    name,
    description: `do ${name}`,
    inputSchema: { type: 'object' },
    execute: () => 'ok',
  });

export async function run(_input?: string, _provider?: LLMProvider): Promise<unknown> {
  // esxi-inventory hands off to volume-lookup (a real cross-skill pattern): its body
  // names volume_lookup_by_wwn, which lives in the OTHER skill — and it also has a
  // typo, get_vm_storag( (missing 'e').
  const esxi = defineSkill({
    id: 'esxi-inventory',
    description: 'List VMs and their storage',
    body: 'List VMs with get_vm_storag(site). Feed each array_wwn to volume_lookup_by_wwn to resolve the array.',
    tools: [t('get_vm_storage')],
    autoActivate: 'currentSkill',
  });
  const volumeLookup = defineSkill({
    id: 'volume-lookup',
    description: 'Resolve a volume by WWN',
    body: 'Resolve the array with volume_lookup_by_wwn(wwn).',
    tools: [t('volume_lookup_by_wwn')],
    autoActivate: 'currentSkill',
  });

  const graph = skillGraph()
    .entry(esxi)
    .route(esxi, volumeLookup, { onToolReturn: 'get_vm_storage' })
    .build({ check: 'off' }); // don't print during the demo — we inspect explicitly

  const checkup = graph.checkup();

  // Standalone: check just the esxi skill, telling it which tools the graph knows.
  const standalone = checkSkillContract(esxi, new Set(['get_vm_storage', 'volume_lookup_by_wwn']));

  return {
    ok: checkup.ok, // true — both findings are warnings
    contractWarnings: checkup.problems
      .filter((p) => p.code.startsWith('body-'))
      .map((p) => ({ code: p.code, skill: p.skill, message: p.message })),
    standaloneOnEsxi: standalone.map((p) => p.code), // ['body-foreign-tool', 'body-unknown-tool']
  };
}

if (isCliEntry(import.meta.url)) {
  void run().then(printResult);
}
