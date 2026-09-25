#!/usr/bin/env node
/**
 * The AI-assistant instruction files shipped for CONSUMERS (`npx agentfootprint-setup`)
 * are generated — edit the source, never a copy.
 *
 *   ai-instructions/_source.md          → copilot / cursor / kiro / windsurf / cline copies
 *                                          (identical but for the title line)
 *   ai-instructions/claude-code/SKILL.md → .claude/skills/agentfootprint/SKILL.md
 *                                          (the repo's own installed copy)
 *
 * `--check` writes nothing and exits 1 when any copy differs from what it would write.
 * Run through `npm run docs:regen`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AI = join(ROOT, 'ai-instructions');
const source = readFileSync(join(AI, '_source.md'), 'utf8');

const TARGETS = [
  ['ai-instructions/copilot-instructions.md', `# agentfootprint — GitHub Copilot Instructions\n${source}`],
  ['ai-instructions/cursor/agentfootprint.md', `# agentfootprint — Cursor Rules\n${source}`],
  ['ai-instructions/kiro/agentfootprint.md', `# agentfootprint — Kiro Rules\n${source}`],
  ['ai-instructions/windsurfrules', `# agentfootprint — Windsurf Rules\n${source}`],
  ['ai-instructions/clinerules', `# agentfootprint — Cline Rules\n${source}`],
  [
    '.claude/skills/agentfootprint/SKILL.md',
    readFileSync(join(AI, 'claude-code', 'SKILL.md'), 'utf8'),
  ],
];

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, want] of TARGETS) {
  const file = join(ROOT, rel);
  const have = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (have === want) continue;
  if (check) {
    console.error(`stale: ${rel} — edit ai-instructions/_source.md (or claude-code/SKILL.md), then npm run docs:regen`);
    stale++;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, want);
    console.log(`wrote ${rel}`);
  }
}
process.exitCode = stale ? 1 : 0;
