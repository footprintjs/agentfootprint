/**
 * Unit tests — conventions.ts (subflow ID protocol).
 */

import { describe, it, expect } from 'vitest';
import {
  SUBFLOW_IDS,
  STAGE_IDS,
  isSlotSubflow,
  slotFromSubflowId,
  slotFromRuntimeStageId,
  isKnownSubflow,
  isKnownStage,
  stageRole,
  milestoneFor,
} from '../../../src/conventions.js';

describe('SUBFLOW_IDS — single source of truth', () => {
  it('has exactly the 12 known subflow IDs', () => {
    const expected = [
      'sf-injection-engine',
      'sf-llm-call', // LLMCall inner subflow wrapping the invocation
      'sf-system-prompt',
      'sf-messages',
      'sf-tools',
      'sf-route',
      'sf-tool-calls',
      'sf-merge',
      'final', // mounted via addSubFlowChartBranch — id IS the route key
      'sf-cache', // v2.14 — per-turn cache decision wrapper
      'sf-cache-decision',
      'sf-thinking', // v2.14 — normalize-thinking mount (agent-internal)
    ];
    const actual = Object.values(SUBFLOW_IDS).sort();
    expect(actual).toEqual(expected.sort());
  });

  it('all subflow IDs use the sf- prefix EXCEPT route-branch keys', () => {
    // Route-decider branches use the branch key as the subflow id.
    // The Route decider returns `'final' | 'tool-calls'`, so those
    // string values double as subflow ids and don't carry the sf-
    // prefix. Everything else does.
    const branchKeyExceptions = new Set<string>([SUBFLOW_IDS.FINAL]);
    for (const id of Object.values(SUBFLOW_IDS)) {
      if (branchKeyExceptions.has(id)) continue;
      expect(id.startsWith('sf-')).toBe(true);
    }
  });
});

describe('STAGE_IDS — single source of truth', () => {
  it('has the 14 known stage IDs', () => {
    const actual = Object.values(STAGE_IDS).sort();
    expect(actual).toEqual(
      [
        'seed',
        // Parallel context-assembly selector (slot fan-out):
        'context',
        // LLMCall outer wrapper + post-invocation marker:
        'client',
        'extract-final',
        'call-llm',
        'final',
        'format-merge',
        'merge-llm',
        'extract-merge',
        // Cache layer (v2.6+):
        'update-skill-history',
        'cache-gate',
        'apply-markers',
        'no-markers',
        'build-llm-request',
      ].sort(),
    );
  });
});

describe('type guards — isSlotSubflow', () => {
  it('accepts the 3 slot subflow IDs', () => {
    expect(isSlotSubflow(SUBFLOW_IDS.SYSTEM_PROMPT)).toBe(true);
    expect(isSlotSubflow(SUBFLOW_IDS.MESSAGES)).toBe(true);
    expect(isSlotSubflow(SUBFLOW_IDS.TOOLS)).toBe(true);
  });

  it('rejects non-slot subflow IDs', () => {
    expect(isSlotSubflow(SUBFLOW_IDS.ROUTE)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.TOOL_CALLS)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.MERGE)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.FINAL)).toBe(false);
    expect(isSlotSubflow('sf-unknown')).toBe(false);
    expect(isSlotSubflow('')).toBe(false);
  });
});

describe('slotFromSubflowId', () => {
  it('maps each slot subflow ID to its ContextSlot name', () => {
    expect(slotFromSubflowId(SUBFLOW_IDS.SYSTEM_PROMPT)).toBe('system-prompt');
    expect(slotFromSubflowId(SUBFLOW_IDS.MESSAGES)).toBe('messages');
    expect(slotFromSubflowId(SUBFLOW_IDS.TOOLS)).toBe('tools');
  });

  it('returns undefined for non-slot subflow IDs', () => {
    expect(slotFromSubflowId(SUBFLOW_IDS.ROUTE)).toBeUndefined();
    expect(slotFromSubflowId('anything-else')).toBeUndefined();
  });
});

// The load-bearing parallel-safe attribution helper (used by ContextRecorder
// once the 3 slots run concurrently). Guarded directly here, not just via the
// recorder, so a regression in the path-walk / suffix-strip localizes cleanly.
describe('slotFromRuntimeStageId', () => {
  it('resolves the slot from a write inside a slot subflow (bare prefix)', () => {
    expect(slotFromRuntimeStageId('sf-system-prompt/inject#0')).toBe('system-prompt');
    expect(slotFromRuntimeStageId('sf-messages/inject#0')).toBe('messages');
    expect(slotFromRuntimeStageId('sf-tools/inject#0')).toBe('tools');
  });

  it('resolves through deep nesting (e.g. inside sf-llm-call)', () => {
    expect(slotFromRuntimeStageId('sf-llm-call/sf-messages/compose#3')).toBe('messages');
    expect(slotFromRuntimeStageId('sf-llm-call/sf-system-prompt/build#12')).toBe('system-prompt');
  });

  it('strips the #index suffix (including multi-digit)', () => {
    expect(slotFromRuntimeStageId('sf-tools/inject#1234')).toBe('tools');
  });

  it('handles a subflow id with no #index (e.g. an entry id)', () => {
    expect(slotFromRuntimeStageId('sf-tools')).toBe('tools');
  });

  it('walks innermost-first when two slot segments appear', () => {
    // Pathological but defined: the nearest enclosing slot wins.
    expect(slotFromRuntimeStageId('sf-system-prompt/sf-tools/x#0')).toBe('tools');
  });

  it('returns undefined for a non-slot path', () => {
    expect(slotFromRuntimeStageId('sf-route/inject#0')).toBeUndefined();
    expect(slotFromRuntimeStageId('seed#0')).toBeUndefined();
    expect(slotFromRuntimeStageId('inject#0')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(slotFromRuntimeStageId('')).toBeUndefined();
  });
});

describe('isKnownSubflow / isKnownStage', () => {
  it('recognizes every constant in SUBFLOW_IDS', () => {
    for (const id of Object.values(SUBFLOW_IDS)) {
      expect(isKnownSubflow(id)).toBe(true);
    }
    expect(isKnownSubflow('sf-unknown')).toBe(false);
  });

  it('recognizes every constant in STAGE_IDS', () => {
    for (const id of Object.values(STAGE_IDS)) {
      expect(isKnownStage(id)).toBe(true);
    }
    expect(isKnownStage('unknown-stage')).toBe(false);
  });
});

describe('stageRole — hero vs plumbing classification', () => {
  it('classifies the 3 context slots as hero-slot', () => {
    expect(stageRole(SUBFLOW_IDS.SYSTEM_PROMPT)).toBe('hero-slot');
    expect(stageRole(SUBFLOW_IDS.MESSAGES)).toBe('hero-slot');
    expect(stageRole(SUBFLOW_IDS.TOOLS)).toBe('hero-slot');
  });

  it('classifies the LLM call as hero-llm', () => {
    expect(stageRole(STAGE_IDS.CALL_LLM)).toBe('hero-llm');
  });

  it('classifies tool execution as hero-action (bare branch key + reserved id)', () => {
    expect(stageRole('tool-calls')).toBe('hero-action');
    expect(stageRole(SUBFLOW_IDS.TOOL_CALLS)).toBe('hero-action');
  });

  it('classifies mechanism stages as plumbing', () => {
    expect(stageRole(SUBFLOW_IDS.INJECTION_ENGINE)).toBe('plumbing');
    expect(stageRole(SUBFLOW_IDS.CACHE)).toBe('plumbing');
    expect(stageRole(SUBFLOW_IDS.ROUTE)).toBe('plumbing');
    expect(stageRole(SUBFLOW_IDS.THINKING)).toBe('plumbing');
    expect(stageRole(STAGE_IDS.CONTEXT)).toBe('plumbing');
    expect(stageRole(STAGE_IDS.UPDATE_SKILL_HISTORY)).toBe('plumbing');
    expect(stageRole(STAGE_IDS.CACHE_GATE)).toBe('plumbing');
    // The sf-llm-call WRAPPER is plumbing — the hero is call-llm INSIDE it.
    expect(stageRole(SUBFLOW_IDS.LLM_CALL)).toBe('plumbing');
  });

  it('classifies chart boundaries (Initialize root, Final) as boundary', () => {
    expect(stageRole(STAGE_IDS.SEED)).toBe('boundary');
    expect(stageRole(STAGE_IDS.FINAL)).toBe('boundary');
  });

  it('works on PATH-QUALIFIED ids (only the local segment matters)', () => {
    // call-llm nested inside the sf-llm-call wrapper.
    expect(stageRole('sf-llm-call/call-llm')).toBe('hero-llm');
    // a slot nested under the context fork.
    expect(stageRole('sf-llm-call/sf-system-prompt')).toBe('hero-slot');
  });

  it('defaults unknown ids to boundary (never silently muted)', () => {
    expect(stageRole('some-custom-stage')).toBe('boundary');
  });
});

describe('milestoneFor — domain-declared time-travel scrub stops', () => {
  it('classifies the loop entry as an iteration milestone (flat + subflow loop targets)', () => {
    expect(milestoneFor(SUBFLOW_IDS.INJECTION_ENGINE)).toEqual({
      kind: 'iteration',
      label: 'Iteration',
    });
    expect(milestoneFor(SUBFLOW_IDS.LLM_CALL)).toEqual({ kind: 'iteration', label: 'Iteration' });
  });

  it('classifies each context slot as a slot milestone (which slot got updated)', () => {
    expect(milestoneFor(SUBFLOW_IDS.SYSTEM_PROMPT)).toEqual({
      kind: 'slot',
      label: 'System prompt',
    });
    expect(milestoneFor(SUBFLOW_IDS.MESSAGES)).toEqual({ kind: 'slot', label: 'Messages' });
    expect(milestoneFor(SUBFLOW_IDS.TOOLS)).toEqual({ kind: 'slot', label: 'Tools' });
  });

  it('classifies the LLM call as an llm-turn milestone', () => {
    expect(milestoneFor(STAGE_IDS.CALL_LLM)).toEqual({ kind: 'llm-turn', label: 'LLM turn' });
    expect(milestoneFor(STAGE_IDS.MERGE_LLM)).toEqual({ kind: 'llm-turn', label: 'LLM turn' });
  });

  it('classifies tool execution as a tool-call milestone (bare + prefixed forms)', () => {
    expect(milestoneFor('tool-calls')).toEqual({ kind: 'tool-call', label: 'Tool call' });
    expect(milestoneFor(SUBFLOW_IDS.TOOL_CALLS)).toEqual({ kind: 'tool-call', label: 'Tool call' });
  });

  it('classifies the route decider as a decision milestone', () => {
    expect(milestoneFor(SUBFLOW_IDS.ROUTE)).toEqual({ kind: 'decision', label: 'Route' });
  });

  it('returns null for plumbing/boundary stages (they fold into the surrounding collection)', () => {
    expect(milestoneFor(SUBFLOW_IDS.CACHE)).toBeNull();
    expect(milestoneFor(STAGE_IDS.UPDATE_SKILL_HISTORY)).toBeNull();
    expect(milestoneFor(SUBFLOW_IDS.THINKING)).toBeNull();
    expect(milestoneFor(STAGE_IDS.SEED)).toBeNull();
    expect(milestoneFor(STAGE_IDS.CONTEXT)).toBeNull();
  });

  it('accepts runtimeStageId (#index) and path-qualified ids — only the local segment matters', () => {
    expect(milestoneFor('call-llm#17')).toEqual({ kind: 'llm-turn', label: 'LLM turn' });
    expect(milestoneFor('sf-llm-call/call-llm#37')).toEqual({
      kind: 'llm-turn',
      label: 'LLM turn',
    });
    expect(milestoneFor('sf-injection-engine#2')).toEqual({
      kind: 'iteration',
      label: 'Iteration',
    });
  });

  it('returns null for unknown ids (not every stage is a milestone)', () => {
    expect(milestoneFor('some-custom-stage')).toBeNull();
  });
});
