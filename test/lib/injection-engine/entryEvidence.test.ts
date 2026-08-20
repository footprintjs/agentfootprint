/**
 * The entry-evidence rows: two ONE-ROW facts about guessed entries, replacing
 * the dead per-node exit lint (which flags 0 of 20 on the real failing graph
 * with the reachability union, and 19 of 20 without it — both wrong).
 *
 * `one-way-entries`: ≥3 rule-driven entries, more than half with no declared
 * outgoing edge — the stated PRECONDITION of a permanent mis-entry.
 * `no-negative-evidence`: ≥3 rule-driven entries, zero examples, zero
 * neverRoutes — the proving machinery ships and nothing uses it.
 *
 * Test types (Convention 3): unit (the pure module, incl. the REAL consumer
 * graph's arithmetic: 19 rule entries, 1 edge) / integration (graph.checkup()
 * carries the rows; declaring a neverRoutes phrase silences the second) /
 * regression (shapes the library documents as correct stay silent: pipeline,
 * decision tree, two-skill agent, routed-onward entries).
 */

import { describe, expect, it } from 'vitest';
import { checkEntryEvidence } from '../../../src/lib/injection-engine/skillEntryEvidence.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';

const entry = (id: string, over: Partial<{ conditional: boolean; hasExamples: boolean }> = {}) => ({
  id,
  conditional: true,
  hasExamples: false,
  ...over,
});

const base = {
  routeFromIds: new Set<string>(),
  neverRoutesCount: 0,
  isTree: false,
};

describe('unit: the pure module', () => {
  it('fires BOTH rows once on the real failing arithmetic — 19 rule entries, 1 edge', () => {
    // The recorded consumer graph: 20 skills, 19 rule-driven entries, exactly
    // one declared edge (esxi-inventory → volume-lookup), no examples, no
    // neverRoutes. 18 of 19 entries are one-way — comfortably over half.
    const entries = Array.from({ length: 19 }, (_, i) => entry(`skill-${i}`));
    entries[0] = entry('esxi-inventory');
    const problems = checkEntryEvidence({
      ...base,
      entries,
      routeFromIds: new Set(['esxi-inventory']),
    });
    expect(problems.map((p) => p.code).sort()).toEqual(['no-negative-evidence', 'one-way-entries']);
    expect(problems.every((p) => p.kind === 'warning')).toBe(true);
    const oneWay = problems.find((p) => p.code === 'one-way-entries')!;
    expect(oneWay.message).toContain('18 of 19');
    expect(oneWay.message).toContain('.maps()');
  });

  it('stays silent on a two-skill agent and on a decision tree', () => {
    expect(checkEntryEvidence({ ...base, entries: [entry('a'), entry('b')] })).toEqual([]);
    expect(
      checkEntryEvidence({
        ...base,
        entries: [entry('a'), entry('b'), entry('c')],
        isTree: true,
      }),
    ).toEqual([]);
  });

  it('one-way-entries stays silent when half or fewer are one-way (a routed pipeline)', () => {
    const problems = checkEntryEvidence({
      ...base,
      entries: [entry('a'), entry('b'), entry('c'), entry('d')],
      routeFromIds: new Set(['a', 'b']), // exactly half one-way — not MORE than half
    });
    expect(problems.map((p) => p.code)).toEqual(['no-negative-evidence']);
  });

  it('no-negative-evidence is silenced by ONE examples row or ONE neverRoutes phrase', () => {
    const entries = [entry('a', { hasExamples: true }), entry('b'), entry('c')];
    expect(checkEntryEvidence({ ...base, entries }).map((p) => p.code)).toEqual([
      'one-way-entries',
    ]);
    expect(
      checkEntryEvidence({
        ...base,
        entries: [entry('a'), entry('b'), entry('c')],
        neverRoutesCount: 1,
      }).map((p) => p.code),
    ).toEqual(['one-way-entries']);
  });

  it('unconditional entries do not count as rule-driven', () => {
    const problems = checkEntryEvidence({
      ...base,
      entries: [entry('a', { conditional: false }), entry('b'), entry('c')],
    });
    expect(problems).toEqual([]); // only 2 rule-driven — under the threshold
  });
});

describe('integration: graph.checkup() carries the rows', () => {
  const s = (id: string) => defineSkill({ id, description: id, body: `${id} body` });

  it('a keyword-entry menu with no edges and no evidence gets both warnings', () => {
    const graph = skillGraph()
      .entry(s('zone-audit'), { match: { keywords: ['zone'] } })
      .entry(s('port-triage'), { match: { keywords: ['port'] } })
      .entry(s('vm-backup'), { match: { keywords: ['backup'] } })
      .build();
    const codes = graph.checkup().problems.map((p) => p.code);
    expect(codes).toContain('one-way-entries');
    expect(codes).toContain('no-negative-evidence');
    // Warnings, not errors: the report is still ok.
    expect(graph.checkup().ok).toBe(true);
  });

  it('declaring one neverRoutes phrase silences the evidence row', () => {
    // Note the phrase must be one no rule claims — declaring the recorded
    // trap phrase ("…zone redundancy run") against a 'zone' keyword rule is
    // a build ERROR (never-routes-claimed), which is the E2 machinery doing
    // exactly what this row exists to get people to use.
    const graph = skillGraph()
      .entry(s('zone-audit'), { match: { keywords: ['zone'] } })
      .entry(s('port-triage'), { match: { keywords: ['port'] } })
      .entry(s('vm-backup'), { match: { keywords: ['backup'] } })
      .neverRoutes(['what is the weather in Berlin'])
      .build();
    const codes = graph.checkup().problems.map((p) => p.code);
    expect(codes).not.toContain('no-negative-evidence');
    expect(codes).toContain('one-way-entries'); // still one-way; different cure
  });

  it('the recorded trap phrase as a neverRoutes row is a build ERROR with a witness', () => {
    // The whole incident, as build-time arithmetic: the phrase the person
    // typed, declared as must-route-nowhere, against the rule that trapped it.
    expect(() =>
      skillGraph()
        .entry(s('zone-audit'), { match: { keywords: ['zone'] } })
        .entry(s('port-triage'), { match: { keywords: ['port'] } })
        .entry(s('vm-backup'), { match: { keywords: ['backup'] } })
        .neverRoutes(['find the most recent zone redundancy run'])
        .build(),
    ).toThrow(/never-routes-claimed/);
  });
});
