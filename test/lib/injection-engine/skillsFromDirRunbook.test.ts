/**
 * skillsFromDir carries the whole runbook — tools and steps, not just prose
 * (9.36.0).
 *
 * THE DEFECT. This is the ONLY door that ingests an existing runbook from
 * disk, and it is the door the library's "extract the workflow you already
 * have" thesis walks through. It used to carry the prose and drop the other
 * two-thirds: what to do it WITH, and in what order.
 *
 * THE SHAPE. A file NAMES tools; the caller SUPPLIES them. A markdown file has
 * no `execute`, so anything else would either be a lie or a code-execution
 * vector. The tests below therefore care about two things above all: that an
 * unresolved name is a loud refusal rather than a quietly tool-less skill, and
 * that a directory declaring only prose loads exactly as it always did.
 *
 * Test types (Convention 3): unit · functional (refusals) · integration ·
 * property · security · performance · ROI.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool } from '../../../src/index.js';
import { defineSkill, skillsFromDir } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { Tool } from '../../../src/core/tools.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

// ─── Fixture helpers ──────────────────────────────────────────────

const created: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-runbook-'));
  created.push(dir);
  return dir;
}

function writeSkill(dir: string, folder: string, contents: string): string {
  const sub = join(dir, folder);
  mkdirSync(sub, { recursive: true });
  const file = join(sub, 'SKILL.md');
  writeFileSync(file, contents, 'utf8');
  return file;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

const tool = (name: string): Tool =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran`,
  }) as unknown as Tool;

const lookupOrder = tool('lookup_order');
const issueRefund = tool('issue_refund');
const registry = [lookupOrder, issueRefund];

/** The whole runbook: prose, tools, an ordered procedure. */
const RUNBOOK = [
  '---',
  'name: billing',
  'description: Use for refunds, charges and billing questions.',
  'tools: lookup_order, issue_refund',
  'steps:',
  '  - lookup_order: look up the order before touching money',
  '  - issue_refund: refund only what the lookup found',
  '---',
  'Confirm identity first.',
  '',
].join('\n');

/** Tools, no procedure — the smallest file that names a tool. */
const TOOLS_ONLY = [
  '---',
  'name: billing',
  'description: Use for refunds.',
  'tools: lookup_order, issue_refund',
  '---',
  'Confirm identity first.',
  '',
].join('\n');

/** Prose only — the file this loader has always accepted. */
const PROSE_ONLY = [
  '---',
  'name: faq',
  'description: General questions.',
  '---',
  'Be brief.',
  '',
].join('\n');

// ─── Unit — what a file can now carry ─────────────────────────────

describe('skillsFromDir runbook — unit', () => {
  it('a declared tool NAME resolves to the caller-supplied Tool, by reference', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);

    const [billing] = await skillsFromDir(dir, { tools: registry });

    expect(billing?.inject.tools).toEqual([lookupOrder, issueRefund]);
    // BY REFERENCE: nothing was reconstructed from the file, so the executable
    // half is provably the caller's own object and not a look-alike.
    expect(billing?.inject.tools?.[0]).toBe(lookupOrder);
  });

  it("declaration ORDER is the file's, not the registry's", async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      RUNBOOK.replace('tools: lookup_order, issue_refund', 'tools: issue_refund, lookup_order'),
    );

    const [billing] = await skillsFromDir(dir, { tools: registry });

    expect(billing?.inject.tools?.map((t) => t.schema.name)).toEqual([
      'issue_refund',
      'lookup_order',
    ]);
  });

  it('steps land as data on the same metadata bag defineSkill uses', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);

    const [billing] = await skillsFromDir(dir, { tools: registry });

    expect((billing?.metadata as { steps?: unknown }).steps).toEqual([
      { tool: 'lookup_order', note: 'look up the order before touching money' },
      { tool: 'issue_refund', note: 'refund only what the lookup found' },
    ]);
    // The default policy, resolved by defineSkill exactly as for a hand-written skill.
    expect((billing?.metadata as { onSkip?: string }).onSkip).toBe('advance');
  });

  it('a block list is accepted for tools, and reads the same as the inline form', async () => {
    const inlineDir = makeDir();
    writeSkill(inlineDir, 'billing', RUNBOOK);
    const blockDir = makeDir();
    writeSkill(
      blockDir,
      'billing',
      RUNBOOK.replace(
        'tools: lookup_order, issue_refund',
        ['tools:', '  - lookup_order', '  - issue_refund'].join('\n'),
      ),
    );

    expect(await skillsFromDir(blockDir, { tools: registry })).toEqual(
      await skillsFromDir(inlineDir, { tools: registry }),
    );
  });

  it('onSkip: hold rides through to the skill', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK.replace('---\nConfirm', 'onSkip: hold\n---\nConfirm'));

    const [billing] = await skillsFromDir(dir, { tools: registry });

    expect((billing?.metadata as { onSkip?: string }).onSkip).toBe('hold');
  });

  it('a note may contain colons — only the FIRST one separates tool from why', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      RUNBOOK.replace(
        '  - issue_refund: refund only what the lookup found',
        '  - issue_refund: refund what the lookup found: no more, no less',
      ),
    );

    const [billing] = await skillsFromDir(dir, { tools: registry });

    expect((billing?.metadata as { steps?: Array<{ note: string }> }).steps?.[1]?.note).toBe(
      'refund what the lookup found: no more, no less',
    );
  });
});

// ─── Functional — every refusal names the file, and carries the fix ─

describe('skillsFromDir runbook — functional (refusals)', () => {
  it('LAW: a name the registry does not carry is refused BY NAME, never loaded tool-less', async () => {
    const dir = makeDir();
    const file = writeSkill(
      dir,
      'billing',
      TOOLS_ONLY.replace('lookup_order, issue_refund', 'lookup_order, isue_refund'),
    );

    const error = await skillsFromDir(dir, { tools: registry }).catch((e: Error) => e);

    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toMatch(/names the tool 'isue_refund'/);
    // …and it lists what IS available, so the typo is visible in the message.
    expect((error as Error).message).toMatch(/available: issue_refund, lookup_order/);
  });

  it('LAW: declaring tools with NO registry passed is refused, with the call to paste', async () => {
    const dir = makeDir();
    const file = writeSkill(dir, 'billing', RUNBOOK);

    const error = await skillsFromDir(dir).catch((e: Error) => e);

    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toMatch(/without a tool registry/);
    expect((error as Error).message).toMatch(
      /skillsFromDir\(dir, \{ tools: \[lookup_order, issue_refund\] \}\)/,
    );
    // And it names the escape for a file whose `tools` key belongs to another program.
    expect((error as Error).message).toMatch(/rename that key/);
  });

  it.each([
    [
      'a step naming a tool the file did not declare',
      RUNBOOK.replace('  - issue_refund:', '  - refund_it:'),
      /step 'refund_it' is not in this file's 'tools'/,
    ],
    [
      'a step with no why',
      RUNBOOK.replace('  - issue_refund: refund only what the lookup found', '  - issue_refund'),
      /every step is '- <tool>: <why>' and this one has no why/,
    ],
    [
      'steps without tools',
      RUNBOOK.replace('tools: lookup_order, issue_refund\n', ''),
      /declares 'steps' but no 'tools'/,
    ],
    [
      'steps written on one line',
      RUNBOOK.replace(
        [
          'steps:',
          '  - lookup_order: look up the order before touching money',
          '  - issue_refund: refund only what the lookup found',
        ].join('\n'),
        'steps: lookup_order then issue_refund',
      ),
      /a procedure is an ORDERED list of pairs/,
    ],
    [
      'an empty tools key',
      RUNBOOK.replace('tools: lookup_order, issue_refund', 'tools:'),
      /declares 'tools' with no names/,
    ],
    [
      'the same tool twice in tools',
      RUNBOOK.replace('tools: lookup_order, issue_refund', 'tools: lookup_order, lookup_order'),
      /lists the tool 'lookup_order' twice/,
    ],
    [
      'a tools item written as a pair',
      RUNBOOK.replace(
        'tools: lookup_order, issue_refund',
        ['tools:', '  - lookup_order: the lookup'].join('\n'),
      ),
      /a 'tools' item is a NAME, not a pair/,
    ],
    [
      'onSkip with no steps',
      [
        '---',
        'name: billing',
        'description: d',
        'tools: lookup_order',
        'onSkip: hold',
        '---',
        'Body.',
        '',
      ].join('\n'),
      /declares 'onSkip' with no 'steps'/,
    ],
    [
      'an onSkip policy this library does not have',
      RUNBOOK.replace('---\nConfirm', 'onSkip: pause\n---\nConfirm'),
      /onSkip 'pause', which is not a policy this library has/,
    ],
  ])('refuses %s, naming the file', async (_label, contents, expected) => {
    const dir = makeDir();
    const file = writeSkill(dir, 'billing', contents);

    const error = await skillsFromDir(dir, { tools: registry }).catch((e: Error) => e);

    expect((error as Error).message).toMatch(expected);
    expect((error as Error).message).toContain(file);
  });

  it('refuses a registry carrying two different tools under one name', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);

    await expect(
      skillsFromDir(dir, { tools: [lookupOrder, issueRefund, tool('issue_refund')] }),
    ).rejects.toThrow(/two different tools named 'issue_refund'/);
  });

  it('a step refusal quotes the LINE, so a forty-step runbook is still navigable', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK.replace('  - issue_refund:', '  - refund_it:'));

    const error = await skillsFromDir(dir, { tools: registry }).catch((e: Error) => e);

    // `- issue_refund: …` is line 7 of RUNBOOK (1-based, counting the opening fence).
    expect((error as Error).message).toMatch(/line 7:/);
  });
});

// ─── Integration — the loaded runbook drives a real agent ─────────

describe('skillsFromDir runbook — integration', () => {
  it('the procedure the FILE declared narrows the offer, step by step', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);
    const skills = await skillsFromDir(dir, { tools: registry });

    const offers: string[][] = [];
    const inner = mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
        { toolCalls: [{ id: 't2', name: 'lookup_order', args: {} }] },
        { toolCalls: [{ id: 't3', name: 'issue_refund', args: {} }] },
        { content: 'refunded' },
      ],
    });
    const provider: LLMProvider = {
      ...inner,
      complete: async (req: LLMRequest) => {
        offers.push((req.tools ?? []).map((t) => t.name).sort());
        return inner.complete(req);
      },
    };

    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => skills })
      .toolsFromActiveSkill()
      .build();

    await agent.run({ message: 'refund please' });

    // Step 1 is `lookup_order`; step 2's tool is held out until step 1 is done.
    expect(offers[1]).toEqual(['lookup_order', 'read_skill', 'skip_step']);
    expect(offers[2]).toEqual(['issue_refund', 'read_skill', 'skip_step']);
  });

  it("the step banner the model reads is built from the FILE's note", async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);
    const skills = await skillsFromDir(dir, { tools: registry });

    const descriptions: string[] = [];
    const inner = mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
        { toolCalls: [{ id: 't2', name: 'lookup_order', args: {} }] },
        { toolCalls: [{ id: 't3', name: 'issue_refund', args: {} }] },
        { content: 'done' },
      ],
    });
    const provider: LLMProvider = {
      ...inner,
      complete: async (req: LLMRequest) => {
        for (const t of req.tools ?? []) descriptions.push(t.description);
        return inner.complete(req);
      },
    };

    await Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => skills })
      .build()
      .run({ message: 'refund please' });

    expect(descriptions.join('\n')).toContain(
      '[Step 1 of 2 — look up the order before touching money]',
    );
  });

  it('and the tool the file named actually runs', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);
    const skills = await skillsFromDir(dir, { tools: registry });

    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
          { toolCalls: [{ id: 't2', name: 'lookup_order', args: {} }] },
          { toolCalls: [{ id: 't3', name: 'issue_refund', args: {} }] },
          { content: 'found it' },
        ],
      }),
      model: 'mock',
    })
      .system('S')
      .skills({ list: () => skills })
      .build();

    expect(await agent.run({ message: 'refund please' })).toBe('found it');
    const state = agent.getLastSnapshot()?.sharedState as { toolResults?: unknown };
    expect(JSON.stringify(state)).toContain('lookup_order ran');
  });
});

// ─── Property — additive ──────────────────────────────────────────

describe('skillsFromDir runbook — property (additive)', () => {
  it('LAW: a prose-only directory loads IDENTICALLY, registry or not', async () => {
    const dir = makeDir();
    writeSkill(dir, 'faq', PROSE_ONLY);

    const without = await skillsFromDir(dir);
    const with_ = await skillsFromDir(dir, { tools: registry });

    expect(without).toEqual(with_);
    expect(without[0]?.inject.tools).toBeUndefined();
    expect((without[0]?.metadata as { steps?: unknown }).steps).toBeUndefined();
    // …and identical to what the loader produced before it could carry tools.
    expect(without[0]).toEqual(
      defineSkill({ id: 'faq', description: 'General questions.', body: 'Be brief.' }),
    );
  });

  it('a directory mixing prose-only and full-runbook files loads both', async () => {
    const dir = makeDir();
    writeSkill(dir, 'faq', PROSE_ONLY);
    writeSkill(dir, 'billing', RUNBOOK);

    const skills = await skillsFromDir(dir, { tools: registry });

    expect(skills.map((s) => s.id)).toEqual(['billing', 'faq']);
    expect(skills[0]?.inject.tools).toHaveLength(2);
    expect(skills[1]?.inject.tools).toBeUndefined();
  });

  it('a tool nothing names is simply unused — no error, no skill gets it', async () => {
    const dir = makeDir();
    writeSkill(dir, 'faq', PROSE_ONLY);

    const skills = await skillsFromDir(dir, { tools: [...registry, tool('unused')] });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.inject.tools).toBeUndefined();
  });

  it('unknown frontmatter keys are still ignored, including ones that look like lists', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'billing',
      [
        '---',
        'name: billing',
        'license: MIT',
        'allowed-tools:',
        '  - Read',
        '  - Write',
        'description: Refunds.',
        '---',
        'Body.',
        '',
      ].join('\n'),
    );

    const [billing] = await skillsFromDir(dir);

    expect(billing?.id).toBe('billing');
    expect(billing?.description).toBe('Refunds.');
    expect(billing?.inject.tools).toBeUndefined();
  });
});

// ─── Security — a file names, it never defines ────────────────────

describe('skillsFromDir runbook — security', () => {
  it('LAW: a file can only pick from what the caller already handed in', async () => {
    // The whole argument that ingesting a directory is not a code-execution
    // vector. `rm_rf` is a name in a markdown file and nothing more: no module
    // is resolved, nothing is imported, nothing is evaluated. The set of things
    // this directory can reach is a SUBSET of the caller's own registry.
    const dir = makeDir();
    writeSkill(
      dir,
      'hostile',
      [
        '---',
        'name: hostile',
        'description: d',
        'tools: rm_rf, node:child_process, ../../../etc/passwd',
        '---',
        'Body.',
        '',
      ].join('\n'),
    );

    await expect(skillsFromDir(dir, { tools: registry })).rejects.toThrow(
      /names the tool 'rm_rf', which the `tools` registry passed to skillsFromDir does not carry/,
    );
  });

  it('a tools/steps block AFTER the closing fence is body text, never a declaration', async () => {
    const dir = makeDir();
    writeSkill(
      dir,
      'hostile',
      [
        '---',
        'name: hostile',
        'description: d',
        '---',
        'tools: lookup_order, issue_refund',
        'steps:',
        '  - issue_refund: send the money',
        '',
      ].join('\n'),
    );

    const [hostile] = await skillsFromDir(dir, { tools: registry });

    expect(hostile?.inject.tools).toBeUndefined();
    expect((hostile?.metadata as { steps?: unknown }).steps).toBeUndefined();
    expect(hostile?.inject.systemPrompt).toContain('tools: lookup_order');
  });

  it('editing the file after loading does not change the loaded runbook', async () => {
    const dir = makeDir();
    const file = writeSkill(dir, 'billing', RUNBOOK);

    const [before] = await skillsFromDir(dir, { tools: registry });
    writeFileSync(file, RUNBOOK.replace('tools: lookup_order, issue_refund', 'tools:'), 'utf8');

    expect(before?.inject.tools).toHaveLength(2);
  });
});

// ─── Performance — the arithmetic, not the disk ───────────────────

describe('skillsFromDir runbook — performance', () => {
  it('resolves the registry ONCE for the whole directory, not once per file', async () => {
    const dir = makeDir();
    for (let i = 0; i < 50; i++) {
      writeSkill(
        dir,
        `skill-${String(i).padStart(3, '0')}`,
        RUNBOOK.replace('name: billing', `name: skill-${String(i).padStart(3, '0')}`),
      );
    }

    const skills = await skillsFromDir(dir, { tools: registry });

    expect(skills).toHaveLength(50);
    // Every skill points at the SAME two Tool objects — a per-file rebuild
    // would hand back 100 distinct ones and quietly multiply the agent's
    // dispatch map.
    const distinct = new Set(skills.flatMap((s) => s.inject.tools ?? []));
    expect(distinct.size).toBe(2);
  });
});

// ─── ROI — a loader, not a second mechanism ───────────────────────

describe('skillsFromDir runbook — ROI', () => {
  it('output equals the hand-written defineSkill it saves you writing', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', RUNBOOK);

    const [loaded] = await skillsFromDir(dir, { tools: registry });
    const handWritten = defineSkill({
      id: 'billing',
      description: 'Use for refunds, charges and billing questions.',
      body: 'Confirm identity first.',
      tools: [lookupOrder, issueRefund] as never,
      steps: [
        { tool: 'lookup_order', note: 'look up the order before touching money' },
        { tool: 'issue_refund', note: 'refund only what the lookup found' },
      ],
    });

    expect(loaded).toEqual(handWritten);
  });
});
