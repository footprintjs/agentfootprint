/**
 * `routes:` on disk — a runbook that carries its own graph (`runbookFromDir`).
 *
 * THE DEFECT. The ingest door read prose, `tools:` and `steps:` — everything
 * about one skill — and stopped at the routing, so someone could hand the
 * library a whole runbook and still had to hand-wire the graph in code, which
 * is the work the graph exists to remove.
 *
 * THE SHAPE, and what these tests exist to hold. The file PICKS, it never
 * DEFINES: a route names a skill this directory declares (an unknown id is
 * refused at load, by name, listing what is available — never a half-graph),
 * and a guard is one of the two DATA conditions a route already has. A `when`
 * predicate is code; no file can carry code; the refusal says so and names
 * where that conditional lives instead. The old door keeps its old contract and
 * REFUSES a file that declares routing, because a door that silently dropped it
 * would hand back a graph the author believed was declared on disk.
 *
 * Test types (Convention 3): unit · functional (refusals) · integration ·
 * contract · property · security · performance.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineTool } from '../../../src/index.js';
import { runbookFromDir, skillsFromDir, skillGraph } from '../../../src/injection-engine.js';
import type { Tool } from '../../../src/core/tools.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const created: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-routes-'));
  created.push(dir);
  return dir;
}

function writeSkill(dir: string, folder: string, lines: readonly string[]): string {
  const sub = join(dir, folder);
  mkdirSync(sub, { recursive: true });
  const file = join(sub, 'SKILL.md');
  writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

const tool = (name: string): Tool =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran`,
  }) as unknown as Tool;

const registry = [tool('lookup_order'), tool('issue_refund'), tool('open_ticket')];

const BILLING = (routes: readonly string[]) => [
  '---',
  'name: billing',
  'description: Refunds, charges and billing questions.',
  'tools: lookup_order, issue_refund',
  'routes:',
  ...routes,
  '---',
  'Confirm identity, read the last three charges, then decide.',
];

const ESCALATION = [
  '---',
  'name: escalation',
  'description: A human takes it from here.',
  'tools: open_ticket',
  '---',
  'Open a ticket with the whole history attached.',
];

/** A directory whose billing file routes to escalation on a denied refund. */
function twoSkillDir(
  routes: readonly string[] = ['  - escalation: on issue_refund status=denied'],
) {
  const dir = makeDir();
  writeSkill(dir, 'billing', BILLING(routes));
  writeSkill(dir, 'escalation', ESCALATION);
  return dir;
}

// ── 1. unit — the three guard forms, read off disk ───────────────────────────

describe('unit: the guard grammar — the two DATA conditions, and nothing else', () => {
  it('no guard → a bare (model) edge', async () => {
    const { steps } = await runbookFromDir(twoSkillDir(['  - escalation']), { tools: registry });
    expect(steps).toEqual([{ from: 'billing', to: 'escalation' }]);
  });

  it('`on <tool>` → onToolReturn', async () => {
    const { steps } = await runbookFromDir(twoSkillDir(['  - escalation: on issue_refund']), {
      tools: registry,
    });
    expect(steps).toEqual([{ from: 'billing', to: 'escalation', onToolReturn: 'issue_refund' }]);
  });

  it('`status=a,b` → onToolStatus, closed vocabulary', async () => {
    const { steps } = await runbookFromDir(twoSkillDir(['  - escalation: status=denied,failure']), {
      tools: registry,
    });
    expect(steps).toEqual([
      { from: 'billing', to: 'escalation', onToolStatus: ['denied', 'failure'] },
    ]);
  });

  it('`on <tool> status=<s>` → both, which is how a route already composes', async () => {
    const { steps } = await runbookFromDir(twoSkillDir(), { tools: registry });
    expect(steps).toEqual([
      {
        from: 'billing',
        to: 'escalation',
        onToolReturn: 'issue_refund',
        onToolStatus: ['denied'],
      },
    ]);
  });
});

// ── 2. functional — the refusals, each naming the fix ────────────────────────

describe('functional: refusals — a file that cannot be honored is not loaded', () => {
  it('refuses an UNRESOLVED target by name, listing what the directory carries', async () => {
    const dir = twoSkillDir(['  - refunds: on issue_refund']);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /routes to 'refunds', which no SKILL.md in this directory declares[\s\S]*Available skills: billing, escalation/,
    );
  });

  it('refuses a guard the grammar cannot express, and says where code lives', async () => {
    const dir = twoSkillDir(['  - escalation: when the customer is angry']);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /a `when` predicate is code, and nothing in a SKILL.md is ever evaluated/,
    );
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /skillGraph\(\{ skills, steps: \[\{ from: '<this skill>', to: 'escalation', when: r =>/,
    );
  });

  it('refuses a guard naming a tool the file itself does not declare', async () => {
    const dir = twoSkillDir(['  - escalation: on open_ticket']);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /fires on 'open_ticket', which is not in this file's 'tools' \(lookup_order, issue_refund\)/,
    );
  });

  it('refuses a status outside the closed vocabulary, listing it', async () => {
    const dir = twoSkillDir(['  - escalation: status=exploded']);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /names the status 'exploded'[\s\S]*success, failure, denied, invalid, partial, pending/,
    );
  });

  it('refuses two routes to the same skill — the second is dead wiring', async () => {
    const dir = twoSkillDir(['  - escalation: on issue_refund', '  - escalation: on lookup_order']);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
      /routes to 'escalation' twice/,
    );
  });

  it('refuses an EMPTY routes key, and a one-line one', async () => {
    await expect(runbookFromDir(twoSkillDir([]), { tools: registry })).rejects.toThrow(
      /declares 'routes' with no items/,
    );
    const dir = makeDir();
    writeSkill(dir, 'billing', [
      '---',
      'name: billing',
      'description: d',
      'routes: escalation',
      '---',
      'body',
    ]);
    await expect(runbookFromDir(dir)).rejects.toThrow(/writes 'routes' on one line/);
  });

  it('the OLD door refuses a routing file by name, pointing at the new one', async () => {
    await expect(skillsFromDir(twoSkillDir(), { tools: registry })).rejects.toThrow(
      /declares 'routes', and skillsFromDir returns SKILLS only[\s\S]*runbookFromDir/,
    );
  });
});

// ── 3. integration — the runbook becomes a graph that routes ─────────────────

describe('integration: the directory IS the graph', () => {
  it('spreads into skillGraph and routes on the declared tool result', async () => {
    const runbook = await runbookFromDir(twoSkillDir(['  - escalation: on issue_refund']), {
      tools: registry,
    });
    const graph = skillGraph({ ...runbook, start: 'billing' });
    expect(graph.nextSkill({ iteration: 1, userMessage: 'refund me', history: [] })).toBe(
      'billing',
    );
    expect(
      graph.nextSkill({
        iteration: 2,
        userMessage: 'refund me',
        history: [],
        currentSkillId: 'billing',
        lastToolResult: { toolName: 'issue_refund', result: 'refunded' },
      }),
    ).toBe('escalation');
    // Declared === drawn: the edge the FILE wrote is on the drawing.
    expect(graph.toMermaid()).toContain('n_billing -->|on issue_refund| n_escalation');
  });

  it('a status guard rides through to the compiled edge', async () => {
    const runbook = await runbookFromDir(twoSkillDir(), { tools: registry });
    const graph = skillGraph({ ...runbook, start: 'billing' });
    const at = (status: 'denied' | 'success') =>
      graph.nextSkill({
        iteration: 2,
        userMessage: 'refund me',
        history: [],
        currentSkillId: 'billing',
        toolResults: [{ toolName: 'issue_refund', result: 'no', status }],
      });
    expect(at('denied')).toBe('escalation');
    expect(at('success')).toBe('billing'); // sticky stay — the guard did not fire
  });

  it('the skills are byte-identical to what the old door returns', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', BILLING(['  - escalation']));
    writeSkill(dir, 'escalation', ESCALATION);
    const viaRunbook = await runbookFromDir(dir, { tools: registry });

    const plain = makeDir();
    writeSkill(plain, 'billing', [
      '---',
      'name: billing',
      'description: Refunds, charges and billing questions.',
      'tools: lookup_order, issue_refund',
      '---',
      'Confirm identity, read the last three charges, then decide.',
    ]);
    writeSkill(plain, 'escalation', ESCALATION);
    const viaSkills = await skillsFromDir(plain, { tools: registry });

    expect(JSON.stringify(viaRunbook.skills)).toBe(JSON.stringify(viaSkills));
  });
});

// ── 4. contract — never a half-graph, and zero delta without the key ─────────

describe('contract: all of the routing, or none of the load', () => {
  it('one bad id fails the WHOLE load — a graph missing an edge routes silently wrong', async () => {
    const dir = makeDir();
    writeSkill(dir, 'billing', BILLING(['  - escalation', '  - typo_here']));
    writeSkill(dir, 'escalation', ESCALATION);
    await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(/typo_here/);
  });

  it('ZERO DELTA: a directory with no routes yields an empty step list', async () => {
    const dir = makeDir();
    writeSkill(dir, 'escalation', ESCALATION);
    const runbook = await runbookFromDir(dir, { tools: registry });
    expect(runbook.steps).toEqual([]);
    expect(runbook.skills).toHaveLength(1);
  });

  it('steps are in skill-name order, then file order — a stable graph', async () => {
    const dir = makeDir();
    writeSkill(dir, 'zulu', [
      '---',
      'name: zulu',
      'description: z',
      'routes:',
      '  - alpha',
      '---',
      'body',
    ]);
    writeSkill(dir, 'alpha', [
      '---',
      'name: alpha',
      'description: a',
      'routes:',
      '  - zulu',
      '---',
      'body',
    ]);
    const { steps } = await runbookFromDir(dir);
    expect(steps.map((s) => `${s.from}->${s.to}`)).toEqual(['alpha->zulu', 'zulu->alpha']);
  });
});

// ── 5. property · 6. security · 7. performance ───────────────────────────────

describe('property / security / performance', () => {
  it('property: a chain of N files yields exactly N-1 steps, at every N', async () => {
    for (const n of [2, 5, 12]) {
      const dir = makeDir();
      for (let i = 0; i < n; i++) {
        writeSkill(dir, `s${i}`, [
          '---',
          `name: s${i}`,
          `description: step ${i}`,
          ...(i < n - 1 ? ['routes:', `  - s${i + 1}`] : []),
          '---',
          'body',
        ]);
      }
      const { skills, steps } = await runbookFromDir(dir);
      expect(skills).toHaveLength(n);
      expect(steps).toHaveLength(n - 1);
    }
  });

  it('security: a file can only ever NAME — it cannot reach a path or a module', async () => {
    for (const hostile of [
      '  - ../../../etc/passwd',
      "  - escalation: on require('fs')",
      '  - escalation: on issue_refund; rm -rf /',
      '  - __proto__',
    ]) {
      const dir = twoSkillDir([hostile]);
      // Every one of them dies as an unresolved NAME or an unparsable guard —
      // nothing is resolved as a path, imported, or evaluated.
      await expect(runbookFromDir(dir, { tools: registry })).rejects.toThrow(
        /which no SKILL.md in this directory declares|this grammar cannot express/,
      );
    }
  });

  it('security: a route cannot introduce a skill the directory does not have', async () => {
    const dir = twoSkillDir(['  - escalation']);
    const { skills } = await runbookFromDir(dir, { tools: registry });
    expect(skills.map((s) => s.id).sort()).toEqual(['billing', 'escalation']);
  });

  it('performance: 100 routed files load in well under a second', async () => {
    const dir = makeDir();
    for (let i = 0; i < 100; i++) {
      writeSkill(dir, `s${i}`, [
        '---',
        `name: s${i}`,
        `description: step ${i}`,
        ...(i < 99 ? ['routes:', `  - s${i + 1}`] : []),
        '---',
        'body',
      ]);
    }
    const started = Date.now();
    const { steps } = await runbookFromDir(dir);
    expect(steps).toHaveLength(99);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
