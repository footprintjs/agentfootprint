#!/usr/bin/env node
/**
 * The AI-assistant instruction files shipped for CONSUMERS (`npx agentfootprint-setup`)
 * are generated — edit the source, never a copy.
 *
 *   ai-instructions/_source.md          → copilot / cursor / kiro / windsurf / cline copies
 *                                          (identical but for the title line)
 *   ai-instructions/claude-code/SKILL.md → .claude/skills/agentfootprint/SKILL.md
 *                                          (the repo's own installed copy)
 *                                        → AGENTS.md (the Codex copy: the skill's body
 *                                          under a Codex title; `setup.sh` installs it)
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

const skill = readFileSync(join(AI, 'claude-code', 'SKILL.md'), 'utf8');
const skillBody = skill.replace(/^---\n[\s\S]*?\n---\n+/, '').replace(/^# [^\n]*\n+/, '');
const AGENTS_HEADER = `# agentfootprint — Agent Instructions (OpenAI Codex)

> GENERATED from \`ai-instructions/claude-code/SKILL.md\` by \`npm run docs:regen\` — edit that file.
> Search [CAPABILITIES.md](https://github.com/footprintjs/agentfootprint/blob/main/CAPABILITIES.md) before building
> anything — it may already ship. Contributing to agentfootprint itself? Read its
> [CLAUDE.md](https://github.com/footprintjs/agentfootprint/blob/main/CLAUDE.md) (the definition of done).

`;

const TARGETS = [
  ['AGENTS.md', AGENTS_HEADER + skillBody],
  ['ai-instructions/copilot-instructions.md', `# agentfootprint — GitHub Copilot Instructions\n${source}`],
  ['ai-instructions/cursor/agentfootprint.md', `# agentfootprint — Cursor Rules\n${source}`],
  ['ai-instructions/kiro/agentfootprint.md', `# agentfootprint — Kiro Rules\n${source}`],
  ['ai-instructions/windsurfrules', `# agentfootprint — Windsurf Rules\n${source}`],
  ['ai-instructions/clinerules', `# agentfootprint — Cline Rules\n${source}`],
  ['.claude/skills/agentfootprint/SKILL.md', skill],
];

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, want] of TARGETS) {
  const file = join(ROOT, rel);
  const have = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (have === want) continue;
  if (check) {
    console.error(`stale: ${rel} — edit ai-instructions/_source.md or ai-instructions/claude-code/SKILL.md, then npm run docs:regen`);
    stale++;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, want);
    console.log(`wrote ${rel}`);
  }
}
process.exitCode = stale ? 1 : 0;
