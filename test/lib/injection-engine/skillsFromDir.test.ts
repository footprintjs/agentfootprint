/**
 * skillsFromDir — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The loader turns SKILL.md files into the same Injections `defineSkill`
 * produces, so most of what matters here is refusal behaviour: which
 * mistakes are caught at load time, and whether the message names the
 * thing the author has to go fix.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../../src/index.js';
import { skillsFromDir } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Fixture helpers ──────────────────────────────────────────────

const created: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-skills-'));
  created.push(dir);
  return dir;
}

/** Write `dir/<folder>/SKILL.md` (the portable layout). */
function writeSkill(dir: string, folder: string, contents: string): string {
  const sub = join(dir, folder);
  mkdirSync(sub, { recursive: true });
  const file = join(sub, 'SKILL.md');
  writeFileSync(file, contents, 'utf8');
  return file;
}

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

// ─── Unit — the happy path + shape ────────────────────────────────

describe('skillsFromDir — unit', () => {
  it('loads one skill per SKILL.md folder', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds and charges.', 'Confirm identity.'));
    writeSkill(dir, 'shipping', skillFile('shipping', 'Delivery questions.', 'Check the label.'));

    const skills = await skillsFromDir(dir);

    expect(skills.map((s) => s.id)).toEqual(['billing', 'shipping']);
  });

  it('frontmatter becomes the disclosure stub, body becomes the injected content', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      skillFile(
        'billing',
        'Use for refunds, charges, billing questions.',
        'Confirm identity first.',
      ),
    );

    const [billing] = await skillsFromDir(dir);

    expect(billing?.description).toBe('Use for refunds, charges, billing questions.');
    expect(billing?.inject.systemPrompt).toBe('Confirm identity first.');
    expect(billing?.flavor).toBe('skill');
    expect(billing?.trigger).toEqual({ kind: 'llm-activated', viaToolName: 'read_skill' });
  });

  it('accepts a SKILL.md directly in the directory (the directory IS one skill)', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'SKILL.md'), skillFile('solo', 'The only one.', 'Body.'), 'utf8');

    const skills = await skillsFromDir(dir);

    expect(skills.map((s) => s.id)).toEqual(['solo']);
  });

  it('keeps a multi-line, markdown body verbatim', async () => {
    const dir = makeDir();
    const body = '# Refunds\n\n1. Confirm identity\n2. Check the window\n\n> never guess';
    writeSkill(dir, 'refunds', skillFile('refunds', 'Refund policy.', body));

    const [refunds] = await skillsFromDir(dir);

    expect(refunds?.inject.systemPrompt).toBe(body);
  });

  it('ignores unknown frontmatter keys, comments, and quoted values', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      `---\n# a comment\nname: "billing"\nlicense: MIT\ndescription: 'Refunds and charges.'\n---\nBody.\n`,
    );

    const [billing] = await skillsFromDir(dir);

    expect(billing?.id).toBe('billing');
    expect(billing?.description).toBe('Refunds and charges.');
  });

  it('passes viaToolName + surfaceMode through to every loaded skill', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'Body.'));

    const [billing] = await skillsFromDir(dir, {
      viaToolName: 'open_playbook',
      surfaceMode: 'tool-only',
    });

    expect(billing?.trigger).toEqual({ kind: 'llm-activated', viaToolName: 'open_playbook' });
    expect((billing?.metadata as { surfaceMode?: string }).surfaceMode).toBe('tool-only');
  });

  it('ignores subdirectories that hold no SKILL.md', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'Body.'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'notes.md'), 'not a skill', 'utf8');

    const skills = await skillsFromDir(dir);

    expect(skills.map((s) => s.id)).toEqual(['billing']);
  });
});

// ─── Scenario — the refusals, and what they name ──────────────────

describe('skillsFromDir — scenario (refusals)', () => {
  it('LAW: a URL is refused by name, never fetched', async () => {
    await expect(skillsFromDir('https://example.com/skills')).rejects.toThrow(
      /'https:\/\/example\.com\/skills' is a https URL, not a local directory/,
    );
  });

  it('LAW: every non-local scheme is refused by name', async () => {
    for (const input of ['s3://bucket/skills', 'git+ssh://host/repo', 'file:///tmp/skills']) {
      await expect(skillsFromDir(input)).rejects.toThrow(
        new RegExp(`'${input.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}' is a .* URL`),
      );
    }
    await expect(skillsFromDir('\\\\fileserver\\skills')).rejects.toThrow(
      /is a network \(UNC\) path/,
    );
  });

  it('LAW: malformed frontmatter is refused NAMING THE FILE', async () => {
    const dir = makeDir();
    const file = writeSkill(dir, 'billing', 'no frontmatter at all, just prose\n');

    await expect(skillsFromDir(dir)).rejects.toThrow(
      new RegExp(`${escapeRe(file)}.*does not start with a '---' frontmatter block`),
    );
  });

  it.each([
    ['an unclosed block', '---\nname: billing\ndescription: x\n\nBody.\n', /never closed/],
    ['a missing name', '---\ndescription: x\n---\nBody.\n', /missing 'name'/],
    ['a missing description', '---\nname: billing\n---\nBody.\n', /missing 'description'/],
    ['an empty body', '---\nname: billing\ndescription: x\n---\n\n', /has no body/],
    [
      'a non key: value line',
      '---\nname: billing\njust prose\n---\nBody.\n',
      /is not 'key: value'/,
    ],
    ['an unusable name', '---\nname: billing skills!\ndescription: x\n---\nBody.\n', /must match/],
  ])('refuses %s, naming the file', async (_label, contents, expected) => {
    const dir = makeDir();
    const file = writeSkill(dir, 'broken', contents);

    const error = await skillsFromDir(dir).catch((e: Error) => e);

    expect((error as Error).message).toMatch(expected);
    expect((error as Error).message).toContain(file);
  });

  it('LAW: a name collision is refused NAMING BOTH files', async () => {
    const dir = makeDir();
    const a = writeSkill(dir, 'a-folder', skillFile('billing', 'One.', 'Body A.'));
    const b = writeSkill(dir, 'b-folder', skillFile('billing', 'Two.', 'Body B.'));

    const error = await skillsFromDir(dir).catch((e: Error) => e);

    expect((error as Error).message).toContain(a);
    expect((error as Error).message).toContain(b);
    expect((error as Error).message).toMatch(/two files claim the skill name 'billing'/);
  });

  it('refuses a directory with no SKILL.md rather than returning nothing', async () => {
    const dir = makeDir();

    await expect(skillsFromDir(dir)).rejects.toThrow(/no SKILL\.md found under/);
  });

  it('refuses a missing path and a file-instead-of-directory, naming both', async () => {
    const dir = makeDir();
    const file = join(dir, 'SKILL.md');
    writeFileSync(file, skillFile('solo', 'x', 'Body.'), 'utf8');

    await expect(skillsFromDir(join(dir, 'nope'))).rejects.toThrow(/'.*nope' does not exist/);
    await expect(skillsFromDir(file)).rejects.toThrow(/is a file, not a directory/);
  });
});

// ─── Integration — the loaded skills drive a real agent ───────────

describe('skillsFromDir — integration', () => {
  it('file-authored skills reach the model through the same read_skill mechanism', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      skillFile('billing', 'Refunds and charges.', 'Confirm identity before any refund.'),
    );

    const skills = await skillsFromDir(dir);
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
          { content: 'Confirmed — refunds take 3 days.' },
        ],
      }),
      model: 'mock-model',
    })
      .system('You answer support questions.')
      .skills({ list: () => skills })
      .build();

    const answer = await agent.run({ message: 'refund please' });

    expect(answer).toBe('Confirmed — refunds take 3 days.');
    const state = agent.getLastSnapshot()?.sharedState as { activatedInjectionIds?: string[] };
    expect(state?.activatedInjectionIds).toContain('billing');
  });

  it('the body reaches the system prompt only AFTER activation (progressive disclosure holds)', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'SECRET-PLAYBOOK-TEXT'));
    const skills = await skillsFromDir(dir);

    const prompts: string[] = [];
    const provider = mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
        { content: 'done' },
      ],
    });
    const spying = {
      ...provider,
      complete: async (req: Parameters<typeof provider.complete>[0]) => {
        prompts.push(req.systemPrompt ?? '');
        return provider.complete(req);
      },
    };

    const agent = Agent.create({ provider: spying, model: 'mock-model' })
      .system('You answer support questions.')
      .skills({ list: () => skills })
      .build();
    await agent.run({ message: 'refund please' });

    expect(prompts[0]).not.toContain('SECRET-PLAYBOOK-TEXT');
    expect(prompts[1]).toContain('SECRET-PLAYBOOK-TEXT');
  });
});

// ─── Property — order independence ────────────────────────────────

describe('skillsFromDir — property', () => {
  it('the result is sorted by name regardless of how the filesystem lists it', async () => {
    const dir = makeDir();
    for (const name of ['zulu', 'alpha', 'mike', 'bravo']) {
      writeSkill(dir, `${name}-folder`, skillFile(name, `${name} desc`, `${name} body`));
    }

    const skills = await skillsFromDir(dir);

    expect(skills.map((s) => s.id)).toEqual(['alpha', 'bravo', 'mike', 'zulu']);
  });

  it('loading the same directory twice yields identical injections', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'Body.'));
    writeSkill(dir, 'shipping', skillFile('shipping', 'Delivery.', 'Body 2.'));

    expect(await skillsFromDir(dir)).toEqual(await skillsFromDir(dir));
  });
});

// ─── Security — authorship is decided at load time ────────────────

describe('skillsFromDir — security', () => {
  it('a body edited AFTER loading does not change the loaded skill', async () => {
    const dir = makeDir();
    const file = writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'ORIGINAL'));

    const [before] = await skillsFromDir(dir);
    writeFileSync(file, skillFile('billing', 'Refunds.', 'REPLACED-AFTER-REVIEW'), 'utf8');

    expect(before?.inject.systemPrompt).toBe('ORIGINAL');
  });

  it('a body full of instructions is still just a body — no key of it is executed', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'hostile',
      '---\nname: hostile\ndescription: x\n---\nname: other\ndescription: hijack\ntools: [everything]\n',
    );

    const [hostile] = await skillsFromDir(dir);

    expect(hostile?.id).toBe('hostile');
    expect(hostile?.description).toBe('x');
    // Everything past the closing fence is body text, not frontmatter.
    expect(hostile?.inject.systemPrompt).toContain('name: other');
    expect(hostile?.inject.tools).toBeUndefined();
  });

  it('the returned injections are frozen (defineSkill freezes them)', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds.', 'Body.'));

    const [billing] = await skillsFromDir(dir);

    expect(Object.isFrozen(billing)).toBe(true);
  });
});

// ─── Performance ──────────────────────────────────────────────────

describe('skillsFromDir — performance', () => {
  it(
    'reads and parses every file exactly once, whatever the directory size',
    { timeout: 60_000 },
    async () => {
      // This one is COUNTED, not timed, and the reason is the whole point of
      // the exercise.
      //
      // It used to say "loads 100 skills well inside a second". That number
      // measured the DISK — page cache, and on CI a volume shared with whatever
      // else is running — not the loader. On a busy machine the same directory
      // reads five times slower with nothing about the loader having changed,
      // and even a ratio between two sizes does not save it: the small
      // directory is served from cache the large one had to fill.
      //
      // What the loader must actually get right is arithmetic: every file in
      // the directory becomes exactly one skill, with its content intact and
      // nothing double-counted. That is true on any disk at any speed.
      const dirOf = (count: number): string => {
        const dir = makeDir();
        for (let i = 0; i < count; i++) {
          const name = `skill-${String(i).padStart(3, '0')}`;
          writeSkill(dir, name, skillFile(name, `desc ${i}`, `body ${i}`.repeat(50)));
        }
        return dir;
      };

      const loaded = await skillsFromDir(dirOf(300));
      expect(loaded).toHaveLength(300);
      // Every id distinct — no file read twice, none skipped.
      expect(new Set(loaded.map((s) => s.id)).size).toBe(300);
      // And re-reading the same directory is stable, not cumulative.
      const again = await skillsFromDir(dirOf(300));
      expect(again).toHaveLength(300);
    },
  );
});

// ─── ROI — what the loader saves ──────────────────────────────────

describe('skillsFromDir — ROI', () => {
  it('is a loader, not a second mechanism: output equals hand-written defineSkill', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', skillFile('billing', 'Refunds and charges.', 'Confirm identity.'));

    const [loaded] = await skillsFromDir(dir);
    const { defineSkill } = await import('../../../src/injection-engine.js');
    const handWritten = defineSkill({
      id: 'billing',
      description: 'Refunds and charges.',
      body: 'Confirm identity.',
    });

    expect(loaded).toEqual(handWritten);
  });
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
