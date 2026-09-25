/**
 * Totality (S10) — every fact-shape combination picks a template whose vars are
 * all present, so the per-sentence catch never has to fire; and when a fill
 * DOES throw, that one line becomes `unreadable.line@1`, `unread` counts it, and
 * nothing else in the account changes.
 *
 * The combinations are ENUMERATED over a synthetic recording builder: every
 * variant of every dimension with the others at their default, then seeded
 * mixes of all dimensions (reproducible from the seed). Dimensions: routing
 * verdict (`by` × witness × decider model × scores × offered), delivery
 * (delivered / other / missing-complete / missing-incomplete), each call
 * outcome (ran, failed, before-tool deny, permission deny, `notExecuted`,
 * `notDispatched`, no end, after-tool deny), coverage (none / absent ± lookedFor
 * ± short ± kind ± cannotCover ± tryInsteadTool / coverage-only), findings
 * (none / direct ± expect / exploratory), evidence (off / armed-not-recorded /
 * candidates 0 / unsupported 2 or 12 / lookedUp absent, 0, 2 / revised /
 * truncated), in view (none / undeclared-empty ± rowsAt / declared absence /
 * rows; windowed or not; distance 1 or 3), resumed or not, rewritten or not.
 */

import { describe, expect, it } from 'vitest';

import { buildAccount } from '../../../src/lib/answer-account/account.js';
import type { AnswerAccountDeclarations } from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, linesOf } from './helpers.js';

type E = { type: string; payload: Record<string, unknown>; meta: Record<string, unknown> };

interface Shape {
  by: 'entry' | 'intent' | 'continuity' | 'decider' | 'menu' | 'none' | 'absent' | 'unconfigured';
  witness: boolean;
  deciderModel: boolean;
  scores: 'none' | 'allEqual' | 'distinct';
  offered: number;
  delivery: 'delivered' | 'other' | 'missing-complete' | 'missing-incomplete';
  outcome:
    | 'ran'
    | 'failed'
    | 'before-deny'
    | 'permission-deny'
    | 'not-executed'
    | 'not-dispatched'
    | 'no-end'
    | 'after-deny'
    | 'no-call';
  coverage: 'none' | 'absent' | 'coverage-only';
  lookedFor: boolean;
  short: boolean;
  kind: 'none' | 'existence' | 'scope';
  cannotCover: boolean;
  tryInsteadTool: boolean;
  result: 'empty-array' | 'rows' | 'object' | 'wrapper-empty' | 'string';
  findings: 'none' | 'direct' | 'direct-no-expect' | 'exploratory';
  evidence:
    | 'off'
    | 'armed-none'
    | 'zero'
    | 'unsupported-2'
    | 'unsupported-12'
    | 'lookedUp-2'
    | 'lookedUp-0'
    | 'unsplit'
    | 'revised'
    | 'truncated';
  inView: 'none' | 'wrapper-empty' | 'array-empty' | 'absent' | 'rows';
  windowed: boolean;
  distance: 1 | 3;
  resumed: boolean;
  rewritten: boolean;
  rowsAt: boolean;
}

const DEFAULT: Shape = {
  by: 'intent',
  witness: false,
  deciderModel: true,
  scores: 'allEqual',
  offered: 3,
  delivery: 'delivered',
  outcome: 'ran',
  coverage: 'absent',
  lookedFor: true,
  short: false,
  kind: 'none',
  cannotCover: false,
  tryInsteadTool: false,
  result: 'object',
  findings: 'direct',
  evidence: 'unsplit',
  inView: 'wrapper-empty',
  windowed: true,
  distance: 1,
  resumed: false,
  rewritten: false,
  rowsAt: true,
};

const VARIANTS: { [K in keyof Shape]: readonly Shape[K][] } = {
  by: ['entry', 'intent', 'continuity', 'decider', 'menu', 'none', 'absent', 'unconfigured'],
  witness: [false, true],
  deciderModel: [false, true],
  scores: ['none', 'allEqual', 'distinct'],
  offered: [0, 3],
  delivery: ['delivered', 'other', 'missing-complete', 'missing-incomplete'],
  outcome: [
    'ran',
    'failed',
    'before-deny',
    'permission-deny',
    'not-executed',
    'not-dispatched',
    'no-end',
    'after-deny',
    'no-call',
  ],
  coverage: ['none', 'absent', 'coverage-only'],
  lookedFor: [false, true],
  short: [false, true],
  kind: ['none', 'existence', 'scope'],
  cannotCover: [false, true],
  tryInsteadTool: [false, true],
  result: ['empty-array', 'rows', 'object', 'wrapper-empty', 'string'],
  findings: ['none', 'direct', 'direct-no-expect', 'exploratory'],
  evidence: [
    'off',
    'armed-none',
    'zero',
    'unsupported-2',
    'unsupported-12',
    'lookedUp-2',
    'lookedUp-0',
    'unsplit',
    'revised',
    'truncated',
  ],
  inView: ['none', 'wrapper-empty', 'array-empty', 'absent', 'rows'],
  windowed: [false, true],
  distance: [1, 3],
  resumed: [false, true],
  rewritten: [false, true],
  rowsAt: [false, true],
};

const RUN = 'run-total-1';

/** A synthetic recording for one shape — the event shapes the library emits, nothing more. */
function recordingFor(s: Shape): Recording {
  const events: E[] = [];
  const push = (type: string, payload: Record<string, unknown>, stage = 'stage#0') =>
    events.push({
      type: `agentfootprint.${type}`,
      payload,
      meta: { runId: RUN, sessionId: 's1', runtimeStageId: stage },
    });
  push('agent.run_configured', {
    agentId: 'a',
    llm: { provider: 'mock', model: 'm1' },
    reactMode: 'dynamic',
    memories: [],
    ...(s.windowed && { window: 'summarize-oldest' }),
    ...(s.by !== 'unconfigured' && { skillGraph: { routing: 'assist' } }),
    ...(s.evidence !== 'off' && { evidenceGate: 'guard' }),
  });
  if (s.rewritten)
    push('middleware.decision', {
      middleware: 'quote',
      moment: 'input',
      at: 'message',
      phase: 'input',
      iteration: 0,
      outcome: 'allow',
      changed: true,
      why: 'SECRET-WHY',
    });
  if (!s.resumed) push('agent.turn_start', { turnIndex: 0, userPrompt: 'what is on A1?' });
  else push('pause.resume', { resumeInput: { secret: 'SECRET-RESUME' }, pausedDurationMs: 5 });
  if (s.by !== 'absent' && s.by !== 'unconfigured' && !s.resumed) {
    const to = s.by === 'menu' || s.by === 'none' ? undefined : 'inv';
    push('skill.turn_routed', {
      by: s.by,
      ...(to && { to }),
      ...(s.witness && s.by === 'entry' && { witness: { text: 'A1' } }),
      ...(s.by === 'decider' && {
        decider: { provider: 'p', ...(s.deciderModel && { model: 'router-1' }) },
      }),
      ...(s.by === 'menu' &&
        s.offered > 0 && { offered: ['inv', 'vol', 'net'].slice(0, s.offered) }),
      ...(s.scores !== 'none' && {
        scores: [
          { id: 'inv', score: 1, relevance: 0.5 },
          { id: 'vol', score: 0.4, relevance: 0.3 },
          { id: 'net', score: s.scores === 'allEqual' ? 0.4 : 0.1, relevance: 0.2 },
        ],
      }),
      policy: { nearTieMargin: 0.15, menuSize: 3 },
    });
  }
  // iteration 1 composition
  const delivered = s.delivery === 'delivered' ? 'inv' : s.delivery === 'other' ? 'vol' : undefined;
  if (delivered)
    push(
      'context.injected',
      {
        slot: 'system-prompt',
        source: 'skill',
        sourceId: delivered,
        contentSummary: 'SKILL-BODY-SECRET',
        contentHash: 'h',
        reason: 'r',
      },
      'sp#1',
    );
  push(
    'context.slot_composed',
    {
      slot: 'system-prompt',
      iteration: 1,
      sourceBreakdown:
        s.delivery === 'missing-incomplete'
          ? { skill: { chars: 3, count: 1 } }
          : delivered
          ? { skill: { chars: 3, count: 1 } }
          : {},
    },
    'sp#1',
  );
  // history: [user q0, assistant call, tool result (earlier), (assistant), user q1 ... current]
  const history: Record<string, unknown>[] = [{ role: 'user', content: 'earlier question' }];
  if (s.inView !== 'none') {
    const content =
      s.inView === 'wrapper-empty'
        ? { volumes: [] }
        : s.inView === 'array-empty'
        ? []
        : s.inView === 'absent'
        ? { af_absent: true, outcome: 'nothing_found', checked: [{ what: 'x' }] }
        : [{ id: 1 }, { id: 2 }];
    history.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'old1', name: 'vols', args: { a: 'SECRET-OLD-ARG' } }],
    });
    history.push({
      role: 'tool',
      content: JSON.stringify(content),
      toolCallId: 'old1',
      toolName: 'vols',
    });
  }
  for (let d = 1; d < s.distance; d++)
    history.push(
      { role: 'user', content: `between ${d}` },
      { role: 'assistant', content: 'SECRET-ASSISTANT-TEXT' },
    );
  history.push({ role: 'user', content: 'what is on A1?' });
  if (s.inView !== 'none')
    push(
      'context.injected',
      {
        slot: 'messages',
        source: 'tool-result',
        sourceId: 'old1',
        contentSummary: 'SECRET',
        contentHash: 'h',
        reason: 'r',
      },
      'msg#1',
    );
  push('context.slot_composed', { slot: 'messages', iteration: 1 }, 'msg#1');
  push('stream.llm_start', { iteration: 1, provider: 'mock', model: 'm1', systemPromptChars: 1 });
  if (s.outcome !== 'no-call') {
    if (s.findings !== 'none')
      push('findings.declared', {
        toolName: 'lookup',
        toolCallId: 'c1',
        iteration: 1,
        basis: s.findings === 'exploratory' ? 'exploratory' : 'direct',
        ...(s.findings === 'direct' && { expect: 'high' }),
      });
    if (!(s.resumed && s.outcome === 'ran'))
      push('stream.tool_start', {
        toolName: 'lookup',
        toolCallId: 'c1',
        args: { q: 'SECRET-ARG' },
      });
    if (s.outcome === 'permission-deny')
      push('permission.check', {
        capability: 'tool_call',
        actor: 'agent',
        target: 'lookup',
        result: 'deny',
        policyRuleId: 'r1',
      });
    if (s.outcome === 'before-deny')
      push('middleware.decision', {
        middleware: 'guard',
        moment: 'before-tool',
        at: 'tool',
        toolName: 'lookup',
        toolCallId: 'c1',
        iteration: 1,
        outcome: 'deny',
        changed: false,
        why: 'SECRET-WHY',
      });
    if (s.outcome === 'after-deny')
      push('middleware.decision', {
        middleware: 'redact',
        moment: 'after-tool',
        at: 'tool',
        toolName: 'lookup',
        toolCallId: 'c1',
        iteration: 1,
        outcome: 'deny',
        changed: true,
        why: 'SECRET-WHY',
      });
    const item = (what: string, kind?: string) => ({
      what,
      why: 'because',
      ...(s.short && { short: what.slice(0, 10) }),
      ...(kind && s.kind !== 'none' && { kind: s.kind }),
    });
    if (s.coverage !== 'none' && ['ran', 'after-deny'].includes(s.outcome)) {
      push(s.coverage === 'absent' ? 'tools.absent' : 'tools.coverage_declared', {
        toolName: 'lookup',
        toolCallId: 'c1',
        iteration: 1,
        ...(s.lookedFor && s.coverage === 'absent' && { lookedFor: 'a volume on A1' }),
        checked: [item('the A1 volume table')],
        notChecked: [item('whether A1 is an array', 'k'), item('hosts that are not VMware', 'k')],
        ...(s.cannotCover && { cannotCover: [item('arrays of another family', 'k')] }),
        ...(s.tryInsteadTool && { tryInsteadTool: { tool: 'other_lookup' } }),
      });
    }
    const result =
      s.result === 'empty-array'
        ? []
        : s.result === 'rows'
        ? [{ id: 1 }]
        : s.result === 'wrapper-empty'
        ? { volumes: [], note: 'SECRET-RESULT' }
        : s.result === 'string'
        ? 'SECRET-RESULT-TEXT'
        : { total: 3, note: 'SECRET-RESULT' };
    if (s.outcome !== 'no-end') {
      push('stream.tool_end', {
        toolCallId: 'c1',
        durationMs: 1,
        result: s.outcome === 'failed' ? 'boom' : result,
        ...(s.outcome === 'failed' && { error: true }),
        ...(['permission-deny', 'before-deny', 'not-executed'].includes(s.outcome) && {
          notExecuted: true,
        }),
        ...(s.outcome === 'not-dispatched' && {
          notDispatched: { pausedCall: { toolCallId: 'c0', toolName: 'ask' } },
        }),
        ...(s.outcome === 'after-deny' && { modelResult: 'withheld by redact' }),
        ...(s.coverage === 'absent' && s.outcome === 'ran' && { status: 'absent' }),
      });
    }
    history.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'lookup', args: {} }],
    });
    history.push({ role: 'tool', content: 'x', toolCallId: 'c1', toolName: 'lookup' });
    if (s.resumed)
      history.push({
        role: 'tool',
        content: 'SECRET-PREPAUSE',
        toolCallId: 'p0',
        toolName: 'before_pause_tool',
      });
  }
  // iteration 2 composition (answering)
  if (delivered)
    push(
      'context.injected',
      {
        slot: 'system-prompt',
        source: 'skill',
        sourceId: delivered,
        contentSummary: 'SKILL-BODY-SECRET',
        contentHash: 'h',
        reason: 'r',
      },
      'sp#2',
    );
  push(
    'context.slot_composed',
    {
      slot: 'system-prompt',
      iteration: 2,
      sourceBreakdown: delivered ? { skill: { chars: 3, count: 1 } } : {},
    },
    'sp#2',
  );
  if (s.inView !== 'none')
    push(
      'context.injected',
      {
        slot: 'messages',
        source: 'tool-result',
        sourceId: 'old1',
        contentSummary: 'SECRET',
        contentHash: 'h',
        reason: 'r',
      },
      'msg#2',
    );
  push(
    'context.injected',
    {
      slot: 'messages',
      source: 'tool-result',
      sourceId: 'c1',
      contentSummary: 'SECRET',
      contentHash: 'h',
      reason: 'r',
    },
    'msg#2',
  );
  push('context.slot_composed', { slot: 'messages', iteration: 2 }, 'msg#2');
  push('stream.llm_start', { iteration: 2, provider: 'mock', model: 'm1', systemPromptChars: 1 });
  const ev = s.evidence;
  if (ev !== 'off' && ev !== 'armed-none') {
    const unsupported = ev === 'unsupported-2' ? 2 : ev === 'unsupported-12' ? 12 : 0;
    push('agent.evidence_checked', {
      iteration: 2,
      posture: 'guard',
      candidates: ev === 'zero' ? 0 : 3,
      ...(ev === 'lookedUp-2' && { lookedUp: 2 }),
      ...(ev === 'lookedUp-0' && { lookedUp: 0 }),
      unsupported: Array.from({ length: unsupported }, (_, i) => ({
        value: `V-${i}`,
        shape: 'id',
      })),
      action: unsupported > 0 ? 'flagged' : 'grounded',
      afterRevision: ev === 'revised',
      ...(ev === 'truncated' && { evidenceTruncated: true }),
    });
  }
  push('agent.turn_end', {
    turnIndex: 0,
    finalContent: 'A1 has nothing.',
    totalInputTokens: 1,
    totalOutputTokens: 1,
    iterationCount: 2,
    durationMs: 1,
  });
  return {
    snapshot: {
      runId: 'exec-1',
      sharedState: {
        history,
        turnNumber: 2,
        userMessage: 'what is on A1?',
        resolvedInstructions: 'SECRET-INSTRUCTIONS',
      },
    },
    events: events as unknown as Recording['events'],
    structure: null,
  };
}

const decl = (s: Shape): AnswerAccountDeclarations => ({
  skills: { inv: { label: 'inventory report' } },
  ...(s.rowsAt && { tools: { vols: { rowsAt: 'volumes' }, lookup: { rowsAt: 'volumes' } } }),
  routing: { appDecides: true },
});

function shapes(): { name: string; shape: Shape }[] {
  const out: { name: string; shape: Shape }[] = [];
  for (const key of Object.keys(VARIANTS) as (keyof Shape)[]) {
    for (const value of VARIANTS[key] as readonly unknown[]) {
      out.push({ name: `${key}=${String(value)}`, shape: { ...DEFAULT, [key]: value } });
    }
  }
  // Seeded mixes of every dimension.
  let a = 7;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 400; i++) {
    const shape = { ...DEFAULT } as Record<string, unknown>;
    for (const key of Object.keys(VARIANTS) as (keyof Shape)[]) {
      const list = VARIANTS[key] as readonly unknown[];
      shape[key] = list[Math.floor(r() * list.length)];
    }
    out.push({ name: `mix#${i}`, shape: shape as unknown as Shape });
  }
  return out;
}

describe('TOTALITY — every enumerated fact shape picks a template it can fill', () => {
  it.each(shapes().map((c) => [c.name, c.shape] as const))('%s', (_name, shape) => {
    const recording = recordingFor(shape);
    const d = decl(shape);
    const account = buildAccount(recording, d, { runId: RUN });
    expect(account.unread).toBe(0);
    expect(linesOf(account).filter((s) => s.template.id === 'unreadable.line')).toEqual([]);
    expect(account.rows).toHaveLength(7);
    for (const row of account.rows) expect(row.lines.length, row.id).toBeGreaterThan(0);
    assertP1(account, recording, d);
    expect(JSON.stringify(account)).not.toMatch(/SECRET/);
  });
});

describe('the per-sentence catch — a fill that throws costs one line, nothing else', () => {
  it('forcing found.absent to throw: that line becomes unreadable.line@1, unread = 1, every other line unchanged', () => {
    const recording = recordingFor(DEFAULT);
    const d = decl(DEFAULT);
    const clean = buildAccount(recording, d, { runId: RUN });
    const broken = buildAccount(recording, d, { runId: RUN }, { failTemplate: 'found.absent' });
    expect(clean.unread).toBe(0);
    expect(broken.unread).toBe(1);
    const lines = (a: typeof clean) => a.rows.flatMap((r) => r.lines.map((l) => l.template.id));
    const cleanIds = lines(clean);
    const brokenIds = lines(broken);
    const at = cleanIds.indexOf('found.absent');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(brokenIds[at]).toBe('unreadable.line');
    const failed = broken.rows.flatMap((r) => r.lines)[at]!;
    expect(failed).toMatchObject({
      status: 'not-recorded',
      missing: 'unreadable',
      text: 'This line could not be written from the record.',
    });
    expect(brokenIds.filter((_, i) => i !== at)).toEqual(cleanIds.filter((_, i) => i !== at));
    expect(broken.summary).toEqual(clean.summary);
    expect(broken.signals).toEqual(clean.signals);
  });
});
