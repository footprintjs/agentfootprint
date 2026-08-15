/**
 * The agent-facing SKILL.md SHIPS, says the true things, and exists once.
 *
 * `.claude/skills/agentfootprint/SKILL.md` is the reference a coding agent
 * reads before writing agentfootprint code — including the "what does NOT
 * exist" table, which is built from four hallucinations a capable author
 * actually produced (a `startRun` that is not a function, `RunStep` mistaken
 * for skill history, the LLM classifier filed as tier 3, skill tools assumed
 * scoped). It is the single highest-value paragraph in the repo for a machine
 * reader, and `.claude/` is gitignored, so for a long time it existed on one
 * laptop and shipped to nobody. A document a consumer's agent cannot read
 * cannot help a consumer's agent.
 *
 * The home is `ai-instructions/claude-code/SKILL.md`, which was already:
 *   • inside the published tarball (`package.json#files` carries
 *     `ai-instructions/**\/*` — proven for real by `npm pack`, and cheaply
 *     re-checked below);
 *   • the exact file `npx agentfootprint-setup` copies into a consumer's
 *     `.claude/skills/agentfootprint/SKILL.md` (`ai-instructions/setup.sh`).
 *
 * So there is ONE canonical copy and the local one is its INSTALL — the same
 * relationship a consumer gets, dogfooded. This file pins that: byte-identical
 * or a failing test. It skips (rather than passes) where the local install is
 * absent, which is CI, because a check that cannot look must not claim to have
 * looked.
 *
 * The last two tests do something a copy-check cannot: they pin the doc's
 * FACTS to the source of those facts. A union that gains a member and a doc
 * that lists the old members is exactly how a document starts lying while
 * every other test stays green.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = resolve(repoRoot, 'ai-instructions/claude-code/SKILL.md');
const INSTALLED = resolve(repoRoot, '.claude/skills/agentfootprint/SKILL.md');

const canonical = (): string => readFileSync(CANONICAL, 'utf8');

describe('the agent-facing SKILL.md', () => {
  it('is inside the published package', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      files: string[];
    };
    // The tarball is the real evidence (`npm pack` → the file is listed); this
    // is the daily guard that nobody deleted the entry that puts it there.
    expect(pkg.files.some((pattern) => pattern.startsWith('ai-instructions/'))).toBe(true);
    expect(existsSync(CANONICAL)).toBe(true);
  });

  it('carries the "what does NOT exist" section — the part worth shipping', () => {
    const text = canonical();
    expect(text).toContain('## Read this first — what does NOT exist');
    // The four measured hallucinations, each by the name the reader will type.
    expect(text).toContain('`startRun(...)`');
    expect(text).toContain('`RunStep` as skill/route history');
    expect(text).toContain('It is a tier-2 strategy');
    expect(text).toContain("a skill's tools being gated to that skill automatically");
  });

  it('reads as a consumer document, not a repo document', () => {
    const text = canonical();
    // A consumer has no docs-next/, no src/, and no repo scripts. Naming them
    // sends a reader's agent looking for files it does not have — the reason
    // this copy is edited for a general audience rather than mirrored blindly.
    expect(text).not.toContain('docs-next/');
    expect(text).not.toMatch(/\bnpm run \w/);
  });

  it('is the same bytes as the local install, or is honestly skipped', (ctx) => {
    // `.claude/` is gitignored: present on a developer machine, absent in CI.
    if (!existsSync(INSTALLED)) {
      ctx.skip(`no local install at ${INSTALLED} — nothing to drift against`);
      return;
    }
    const installed = readFileSync(INSTALLED, 'utf8');
    if (installed !== canonical()) {
      expect.unreachable(
        'the local .claude/skills copy has drifted from the shipped source. ' +
          'The shipped file is canonical (it is what `npx agentfootprint-setup` ' +
          'installs). Edit ai-instructions/claude-code/SKILL.md, then re-install: ' +
          'cp ai-instructions/claude-code/SKILL.md .claude/skills/agentfootprint/SKILL.md',
      );
    }
    expect(installed).toBe(canonical());
  });
});

describe('the facts in SKILL.md are pinned to the code that owns them', () => {
  /** Every string literal of a union declared in a source file. */
  function unionMembers(relativePath: string, typeName: string): string[] {
    const src = readFileSync(resolve(repoRoot, relativePath), 'utf8');
    const decl = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
    if (!decl) throw new Error(`no ${typeName} in ${relativePath}`);
    return [...decl[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  }

  it("names exactly RunStepKind's members — the row that says RunStep is not skill history", () => {
    const kinds = unionMembers('src/recorders/observability/RunStepRecorder.ts', 'RunStepKind');
    const row = canonical()
      .split('\n')
      .find((line) => line.includes('`RunStep` as skill/route history'));
    expect(row).toBeDefined();
    const quoted = [...row!.matchAll(/`?'([a-z-]+)'`?/g)].map((m) => m[1]!);
    expect(quoted).toEqual(kinds);
  });

  it('names every CursorMoveCause, and counts them the way the union does', () => {
    const causes = unionMembers('src/lib/injection-engine/skillGraph.ts', 'CursorMoveCause');
    const text = canonical();
    for (const cause of causes) expect(text).toContain(`\`'${cause}'\``);
    // The doc says "Nine causes move it"; the union is what makes that true.
    expect(causes).toHaveLength(9);
    expect(text).toContain('Nine causes move it');
  });
});
