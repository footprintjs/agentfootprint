/**
 * Tests — `BoundaryRecorder`: agent-domain projection over `InOutRecorder`.
 *
 * `BoundaryRecorder` is the single source of truth Lens reads to dispatch
 * its render shape. Each entry carries 3 domain tags:
 *   • `slotKind`        — system-prompt / messages / tools (3 slots)
 *   • `primitiveKind`   — Agent / LLMCall / Sequence / …
 *   • `isAgentInternal` — true for Agent's routing/wrapper subflows
 *
 * 7 patterns cover the consumer circle:
 *   P1  Root entry/exit → primitiveKind=undefined, isRoot=true
 *   P2  Slot subflow (sf-system-prompt) → slotKind set, isAgentInternal=false
 *   P3  Primitive subflow with description → primitiveKind parsed from prefix
 *   P4  Agent-internal subflow (sf-route) → isAgentInternal=true
 *   P5  Nested slot subflow (path-prefixed id) → slotKind still detected
 *   P6  getSlotBoundaries groups by slotKind
 *   P7  getVisibleSteps filters out agent-internal routing
 *
 * Plus query API + factory.
 */

import { describe, expect, it } from 'vitest';
import {
  ROOT_RUNTIME_STAGE_ID,
  inOutRecorder,
  type InOutRecorder,
} from 'footprintjs/trace';
import type { FlowRunEvent, FlowSubflowEvent } from 'footprintjs/dist/types/lib/engine/narrative/types.js';
import {
  BoundaryRecorder,
  boundaryRecorder,
} from '../../../src/recorders/observability/BoundaryRecorder.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function freshRecorder(): { source: InOutRecorder; boundary: BoundaryRecorder } {
  const source = inOutRecorder();
  const boundary = boundaryRecorder(source);
  return { source, boundary };
}

function runEvent(payload?: unknown): FlowRunEvent {
  return { payload };
}

function entryEvent(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  description?: string,
  mappedInput?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    description,
    mappedInput,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

function exitEvent(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  outputState?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    outputState,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

// ── P1: root entry/exit ─────────────────────────────────────────────────

describe('BoundaryRecorder — P1: root entry/exit', () => {
  it('the synthetic root pair has isRoot=true, no slotKind, no primitiveKind, isAgentInternal=false', () => {
    const { source, boundary } = freshRecorder();
    source.onRunStart!(runEvent({ request: 'go' }));
    source.onRunEnd!(runEvent({ result: 'done' }));

    const root = boundary.getRootBoundary();
    expect(root.entry).toMatchObject({
      runtimeStageId: ROOT_RUNTIME_STAGE_ID,
      isRoot: true,
      isAgentInternal: false,
      payload: { request: 'go' },
    });
    expect(root.entry?.slotKind).toBeUndefined();
    expect(root.entry?.primitiveKind).toBeUndefined();
    expect(root.exit?.payload).toEqual({ result: 'done' });
  });
});

// ── P2: slot subflow ────────────────────────────────────────────────────

describe('BoundaryRecorder — P2: slot subflow tagging', () => {
  it('sf-system-prompt subflow gets slotKind=system-prompt, isAgentInternal=false', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'System Prompt', 'sp#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'System Prompt', 'sp#0'));

    const pair = boundary.getBoundary('sp#0');
    expect(pair.entry?.slotKind).toBe('system-prompt');
    expect(pair.entry?.isAgentInternal).toBe(false);
  });

  it('sf-messages and sf-tools also detected', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.MESSAGES, 'Messages', 'm#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.MESSAGES, 'Messages', 'm#0'));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.TOOLS, 'Tools', 't#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.TOOLS, 'Tools', 't#0'));

    expect(boundary.getBoundary('m#0').entry?.slotKind).toBe('messages');
    expect(boundary.getBoundary('t#0').entry?.slotKind).toBe('tools');
  });
});

// ── P3: primitiveKind from description prefix ──────────────────────────

describe('BoundaryRecorder — P3: primitiveKind parsing', () => {
  it('parses Agent / LLMCall / Sequence from the colon-prefixed root description', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent('sf-agent', 'Agent', 'a#0', 'Agent: ReAct loop'));
    source.onSubflowExit!(exitEvent('sf-agent', 'Agent', 'a#0'));
    source.onSubflowEntry!(entryEvent('sf-llmcall', 'LLMCall', 'lc#0', 'LLMCall: one-shot'));
    source.onSubflowExit!(exitEvent('sf-llmcall', 'LLMCall', 'lc#0'));
    source.onSubflowEntry!(entryEvent('sf-seq', 'Seq', 's#0', 'Sequence: 3-step pipeline'));
    source.onSubflowExit!(exitEvent('sf-seq', 'Seq', 's#0'));

    expect(boundary.getBoundary('a#0').entry?.primitiveKind).toBe('Agent');
    expect(boundary.getBoundary('lc#0').entry?.primitiveKind).toBe('LLMCall');
    expect(boundary.getBoundary('s#0').entry?.primitiveKind).toBe('Sequence');
  });

  it('subflow without a colon-prefixed description has no primitiveKind', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent('sf-anon', 'Anon', 'an#0', 'free-form text without colon'));
    source.onSubflowExit!(exitEvent('sf-anon', 'Anon', 'an#0'));

    expect(boundary.getBoundary('an#0').entry?.primitiveKind).toBeUndefined();
  });
});

// ── P4: agent-internal routing ─────────────────────────────────────────

describe('BoundaryRecorder — P4: agent-internal routing subflows', () => {
  it('sf-route, sf-tool-calls, sf-final, sf-merge are flagged as isAgentInternal', () => {
    const { source, boundary } = freshRecorder();
    for (const id of [SUBFLOW_IDS.ROUTE, SUBFLOW_IDS.TOOL_CALLS, SUBFLOW_IDS.FINAL, SUBFLOW_IDS.MERGE]) {
      source.onSubflowEntry!(entryEvent(id, id, `${id}#0`));
      source.onSubflowExit!(exitEvent(id, id, `${id}#0`));
    }

    for (const id of [SUBFLOW_IDS.ROUTE, SUBFLOW_IDS.TOOL_CALLS, SUBFLOW_IDS.FINAL, SUBFLOW_IDS.MERGE]) {
      const pair = boundary.getBoundary(`${id}#0`);
      expect(pair.entry?.isAgentInternal).toBe(true);
    }
  });

  it('slot subflows are NOT flagged as agent-internal (they are real context-engineering steps)', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));

    expect(boundary.getBoundary('sp#0').entry?.isAgentInternal).toBe(false);
  });
});

// ── P5: nested path-prefixed id still detects slot ─────────────────────

describe('BoundaryRecorder — P5: nested slot subflow', () => {
  it('slotKind detected when subflow id is path-prefixed (e.g., llm-call-internals/sf-system-prompt)', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(
      entryEvent(`llm-call-internals/${SUBFLOW_IDS.SYSTEM_PROMPT}`, 'System Prompt', 'sp#0'),
    );
    source.onSubflowExit!(
      exitEvent(`llm-call-internals/${SUBFLOW_IDS.SYSTEM_PROMPT}`, 'System Prompt', 'sp#0'),
    );

    expect(boundary.getBoundary('sp#0').entry?.slotKind).toBe('system-prompt');
  });
});

// ── P6: getSlotBoundaries groups by slotKind ────────────────────────────

describe('BoundaryRecorder — P6: getSlotBoundaries grouping', () => {
  it('groups entry+exit pairs into systemPrompt / messages / tools', () => {
    const { source, boundary } = freshRecorder();
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0', undefined, { from: 'base' }));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0', { rendered: 'base prompt' }));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.MESSAGES, 'M', 'm#0', undefined, { from: 'history' }));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.MESSAGES, 'M', 'm#0', { rendered: 'msgs' }));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.TOOLS, 'T', 't#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.TOOLS, 'T', 't#0'));

    const slots = boundary.getSlotBoundaries();
    expect(slots.systemPrompt).toHaveLength(2); // entry + exit
    expect(slots.messages).toHaveLength(2);
    expect(slots.tools).toHaveLength(2);
    // Confirm no cross-contamination — each slot only contains its own entries.
    expect(slots.systemPrompt.every((b) => b.slotKind === 'system-prompt')).toBe(true);
    expect(slots.messages.every((b) => b.slotKind === 'messages')).toBe(true);
    expect(slots.tools.every((b) => b.slotKind === 'tools')).toBe(true);
  });
});

// ── P7: getVisibleSteps filters out agent-internal ─────────────────────

describe('BoundaryRecorder — P7: getVisibleSteps', () => {
  it('excludes agent-internal routing subflows from the visible timeline', () => {
    const { source, boundary } = freshRecorder();
    source.onRunStart!(runEvent({}));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.ROUTE, 'route', 'r#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.ROUTE, 'route', 'r#0'));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    source.onSubflowEntry!(entryEvent(SUBFLOW_IDS.TOOL_CALLS, 'tc', 'tc#0'));
    source.onSubflowExit!(exitEvent(SUBFLOW_IDS.TOOL_CALLS, 'tc', 'tc#0'));
    source.onRunEnd!(runEvent({}));

    const all = boundary.getSteps();
    expect(all).toHaveLength(4); // root, route, sp, tc

    const visible = boundary.getVisibleSteps();
    // Root + sp visible; route + tc filtered.
    expect(visible.map((b) => b.subflowId)).toEqual([
      '__root__',
      SUBFLOW_IDS.SYSTEM_PROMPT,
    ]);
  });
});

// ── Query API + factory ────────────────────────────────────────────────

describe('BoundaryRecorder — query API', () => {
  it('getBoundaries returns all entries (root + subflow, entry + exit) in order', () => {
    const { source, boundary } = freshRecorder();
    source.onRunStart!(runEvent({}));
    source.onSubflowEntry!(entryEvent('sf-x', 'X', 'x#0'));
    source.onSubflowExit!(exitEvent('sf-x', 'X', 'x#0'));
    source.onRunEnd!(runEvent({}));

    expect(boundary.getBoundaries()).toHaveLength(4);
  });

  it('factory matches the inOutRecorder() / topologyRecorder() style', () => {
    const source = inOutRecorder();
    const b = boundaryRecorder(source);
    expect(b).toBeInstanceOf(BoundaryRecorder);
  });

  it('getRootBoundary returns the root pair', () => {
    const { source, boundary } = freshRecorder();
    source.onRunStart!(runEvent({ a: 1 }));
    source.onRunEnd!(runEvent({ a: 2 }));
    const root = boundary.getRootBoundary();
    expect(root.entry?.payload).toEqual({ a: 1 });
    expect(root.exit?.payload).toEqual({ a: 2 });
  });
});
