/**
 * 09 — Skills authored as files: `skillsFromDir`.
 *
 * A Skill body is prose — a playbook, a policy, a checklist. Prose
 * belongs in a file that a non-programmer can edit and a reviewer can
 * read as a diff, not in a template literal three imports deep.
 *
 * `skillsFromDir('./skills')` reads a directory of SKILL.md files and
 * hands each to `defineSkill`. Nothing else changes: the frontmatter
 * `description` is still all the model sees until it calls
 * `read_skill(<id>)`, and the body still arrives only after it does.
 *
 * The skills this example loads live next to it, in
 * `examples/context-engineering/skills/`. Open them — that IS the API.
 *
 * Run:  npm run example examples/context-engineering/09-skills-from-dir.ts
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agent, type LLMProvider } from '../../src/index.js';
import { skillsFromDir } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/09-skills-from-dir',
  title: 'Skills from a directory of SKILL.md files',
  group: 'context-engineering',
  description:
    'Load Skills from SKILL.md files — frontmatter is the disclosure stub, the ' +
    'body arrives only after read_skill. Same mechanism, prose kept in files.',
  defaultInput: 'I want a refund for order 5512.',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skills', 'files', 'progressive-disclosure'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), 'skills');

  // #region load
  // One call. Every SKILL.md under the directory becomes a Skill.
  const skills = await skillsFromDir(skillsDir);
  // #endregion load

  console.log('Loaded skills (what the model can SEE before activating any):');
  for (const skill of skills) {
    console.log(`  - ${skill.id}: ${skill.description}`);
    console.log(`    body: ${skill.inject.systemPrompt?.length ?? 0} chars, not yet in context`);
  }

  // The mock plays a model that reads the catalog, opens `billing`, and
  // then answers using the body it just received.
  const agent = Agent.create({
    provider:
      provider ??
      mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }] },
          {
            content:
              'I can refund order 5512 in full. Refunds take at least three business days ' +
              'to appear — can you confirm the last four digits of the card on file?',
          },
        ],
      }),
    model: 'mock',
    maxIterations: 3,
  })
    .system('You are a support agent. Open a skill when one applies.')
    .skills({ list: () => skills })
    .build();

  const systemPromptsSeen: number[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => {
    systemPromptsSeen.push((event.payload as { systemPromptChars: number }).systemPromptChars);
  });

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  console.log('\nSystem-prompt size per call (chars):', systemPromptsSeen.join(' → '));
  console.log('The jump is the billing body arriving — after read_skill, not before.');

  // Refusals are loud and specific. Both of these name the thing you have
  // to go fix, which is the whole point of doing this work at load time.
  for (const bad of ['https://example.com/skills', join(skillsDir, 'nope')]) {
    try {
      await skillsFromDir(bad);
    } catch (error) {
      console.log(`\nRefused ${bad}:\n  ${(error as Error).message.split('\n')[0]}`);
    }
  }

  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
