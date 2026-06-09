/**
 * Commentary for skill-GRAPH routing (proposal 002 — full root fix).
 *
 * When a `skillGraph()` routes a skill this turn, the `context.evaluated` event
 * carries `routing` provenance (decision path / edge + tools). These tests cover
 * the three commentary functions over that payload: the key selection, the var
 * extraction (matched predicate + tool count), and the rendered prose. The
 * structured `routing` array itself is asserted in the skillGraph compiler tests.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

function evaluatedEvent(routing?: unknown): AgentfootprintEvent {
  return {
    type: 'agentfootprint.context.evaluated',
    payload: {
      iteration: 1,
      activeCount: 1,
      skippedCount: 0,
      evaluatedTotal: 3,
      activeIds: ['x'],
      skippedDetails: [],
      triggerKindCounts: { rule: 1 },
      skillCatalog: [],
      ...(routing !== undefined ? { routing } : {}),
    },
    meta: {
      wallClockMs: 1,
      runOffsetMs: 0,
      runtimeStageId: 'rid#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ctx = { appName: 'Neo' };
const render = (e: AgentfootprintEvent) => {
  const key = selectCommentaryKey(e);
  if (!key) return null;
  const vars = extractCommentaryVars(e, ctx);
  return renderCommentary(defaultCommentaryTemplates[key] ?? '', vars);
};

describe('commentary — skill-graph routing (context.evaluated)', () => {
  it('no routing → silent (null key), so non-skill-graph runs stay quiet', () => {
    expect(selectCommentaryKey(evaluatedEvent())).toBeNull();
    expect(selectCommentaryKey(evaluatedEvent([]))).toBeNull();
  });

  it('a decision-tree route → names the skill, the matched predicate, and tool count', () => {
    const e = evaluatedEvent([
      {
        injectionId: 'powermax-performance',
        flavor: 'skill',
        via: 'tree',
        path: [
          { label: 'io intent?', branch: 'no' },
          { label: 'array latency / cache?', branch: 'yes' },
        ],
        tools: [
          'pmax_get_array_perf',
          'pmax_get_port_perf',
          'pmax_get_sg_perf',
          'pmax_get_fa_ports',
        ],
      },
    ]);
    expect(selectCommentaryKey(e)).toBe('context.routed');
    const line = render(e)!;
    expect(line).toContain('powermax-performance');
    expect(line).toContain('array latency / cache?'); // the deciding 'yes' predicate
    expect(line).toContain('4 tools');
    expect(line).not.toContain('io intent?'); // a skipped 'no' is not the match
  });

  it("the default leaf (all-'no' path) → '(no specific intent — default)'", () => {
    const e = evaluatedEvent([
      {
        injectionId: 'mds-interface-issues',
        flavor: 'skill',
        via: 'tree',
        path: [
          { label: 'io intent?', branch: 'no' },
          { label: 'sfp intent?', branch: 'no' },
        ],
        tools: ['get_interface_status'],
      },
    ]);
    const line = render(e)!;
    expect(line).toContain('mds-interface-issues');
    expect(line).toContain('no specific intent');
    expect(line).toContain('1 tool now available'); // singular grammar
  });

  it('a route edge → matched label is the edge caption; singular/plural tool grammar', () => {
    const e = evaluatedEvent([
      {
        injectionId: 'sfp',
        flavor: 'skill',
        via: 'route',
        from: 'triage',
        label: 'on get_counters',
        triggerKind: 'on-tool-return',
        tools: ['load_show_tech'],
      },
    ]);
    const line = render(e)!;
    expect(line).toContain('sfp');
    expect(line).toContain('on get_counters');
    expect(line).toContain('1 tool now available'); // singular
  });

  it('no tools unlocked → reads "no new tools"', () => {
    const e = evaluatedEvent([
      { injectionId: 'persona', flavor: 'skill', via: 'entry', label: 'always', tools: [] },
    ]);
    expect(render(e)).toContain('no new tools');
  });
});
