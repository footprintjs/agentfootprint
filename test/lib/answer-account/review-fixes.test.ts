/**
 * The af-2 review round — each finding pinned by the reviewer's own repro,
 * ported here so a regression of the fix fails by name.
 *
 *   B1  a `gate_open` permission verdict is NOT a refusal (the call RAN), in both
 *       readers: the tool-call reader (real runs) and the skill reader;
 *       `deny` and `halt` are.
 *   B2  judge everything, cap only what is listed: 55 real calls, the 54th
 *       failed and the 55th returned `[]` — both are judged; an existence item
 *       at position 31 is a signal.
 *   S1  the account stays ≤ 128 KB and `shown` ≤ 64 KB on the reviewer's worst
 *       cases (3,000 rejections, 3,000 rejections of the decided skill, 3,000
 *       in-view witnesses with 500-character names, a 1 MB question + answer).
 *   S2  the evidence line reads only the FINAL verdict of the answering
 *       iteration — never another iteration's.
 *   S4  a call whose tool no event names is counted as unread and kept.
 *   S5  a declared label obeys the one plain-line rule.
 *   M1  mutation survivors: `capped` at exactly 12 (a6); a withheld result is
 *       not judged for emptiness (a11); `kind` on `checked` is refused by the
 *       reader (a13); the deny list wins over the allow-list (a14).
 *   af-1 F1  a self-referencing ledger is served as found, never a RangeError.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import type { PermissionChecker } from '../../../src/adapters/types.js';
import { servedToModel, strip } from '../../../src/core/agent/coverage/read.js';
import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { validateDeclarations } from '../../../src/lib/answer-account/declarations.js';
import {
  isShowable,
  MAX_SHOWN_BYTES,
  SHOW_ME_ALLOW_LIST,
  showLeaves,
} from '../../../src/lib/answer-account/shown.js';
import type { AnswerAccount, RowId } from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7, fixtureA, FLAGSHIP_RUN_ID, NEO_DECLARATIONS } from './helpers.js';

type E = { type: string; payload: Record<string, any>; meta: Record<string, any> };
const SCOPE = { conversationId: 'review-fixes' };
const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);
const rowIds = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.template.id);
const tool = (name: string, execute: () => unknown) =>
  defineTool({ name, description: name, inputSchema: { type: 'object', properties: {} }, execute });

/** A real run, read back from the recording the agent itself mints (or `recordRun` when none is minted). */
async function realRun(opts: {
  tools: ReturnType<typeof defineTool>[];
  replies: unknown[];
  permissionChecker?: PermissionChecker;
}): Promise<{ recording: Recording; runId?: string }> {
  const store = inMemoryArtifacts();
  const agent = Agent.create({
    provider: mock({ replies: opts.replies as never }),
    model: 'mock',
    maxIterations: 5,
    artifacts: { store, recordings: true },
    ...(opts.permissionChecker && { permissionChecker: opts.permissionChecker }),
  })
    .tools(opts.tools)
    .build();
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const ref = (e.payload as { ref?: string }).ref;
    if (ref) refs.push(ref);
  });
  const recorder = recordRun(agent);
  await agent.run({ message: 'what runs on array A1?', identity: SCOPE }).catch(() => undefined);
  recorder.stop();
  for (const ref of refs.reverse()) {
    const r = await store.get(SCOPE, ref);
    if (r?.meta.kind === 'recording/run') {
      return { recording: JSON.parse(r.data as string), runId: r.meta.origin?.runId as string };
    }
  }
  return { recording: JSON.parse(JSON.stringify(recorder.toRecording())) };
}

function explain(recording: Recording, runId?: string, declarations = {}): AnswerAccount {
  const account = accountForAnswer(recording, declarations, runId ? { runId } : undefined);
  assertP1(account, recording, declarations);
  assertP7(account, recording, declarations);
  return account;
}

const checker = (result: 'gate_open' | 'halt' | 'deny'): PermissionChecker => ({
  name: `rule-${result}`,
  check: async (req) =>
    req.target === 'lookup'
      ? ({ result, policyRuleId: 'r-7', ...(result === 'gate_open' && { gateId: 'g1' }) } as never)
      : { result: 'allow' },
});

describe('B1 — a gate_open verdict is not a refusal; deny and halt are', () => {
  const run = (result: 'gate_open' | 'halt' | 'deny') =>
    realRun({
      tools: [tool('lookup', () => ({ rows: 3 }))],
      replies: [{ toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] }, { content: 'done' }],
      permissionChecker: checker(result),
    });

  it('REAL — gate_open: the tool ran, and the account says so (the reviewer’s H1)', async () => {
    const { recording, runId } = await run('gate_open');
    const end = (recording.events as unknown as E[]).find((e) => e.type.endsWith('tool_end'))!;
    expect(end.payload.result).toEqual({ rows: 3 }); // the record: it RAN
    const a = explain(recording, runId);
    expect(a.facts.calls[0]).toMatchObject({ outcome: 'ran' });
    expect(a.facts.errors.refused).toBe(0);
    const all = a.rows.flatMap((r) => r.lines.map((l) => l.text)).join('\n');
    expect(all).not.toMatch(/refused it|did not run, so/);
    expect(all).toContain('No tool call failed or was refused.');
    expect(rowText(a, 'found')).toEqual(['lookup returned a result.']);
  });

  it.each(['deny', 'halt'] as const)(
    'REAL — %s: the call is refused by the rule named r-7',
    async (verdict) => {
      const { recording, runId } = await run(verdict);
      const a = explain(recording, runId);
      expect(a.facts.calls[0]).toMatchObject({ outcome: 'refused', refusedBy: 'r-7' });
      expect(rowText(a, 'checked')).toEqual([
        'It asked to run lookup, and a rule named r-7 refused it.',
      ]);
    },
  );

  it.each([
    ['gate_open', false],
    ['halt', true],
    ['deny', true],
  ] as const)(
    'the skill reader — a skill_read %s on the decided skill is a refusal: %s',
    (verdict, refused) => {
      const rec = fixtureA() as unknown as { events: E[] };
      rec.events.splice(7, 0, {
        type: 'agentfootprint.permission.check',
        payload: {
          capability: 'skill_read',
          actor: 'agent',
          target: 'skill:array-inventory',
          result: verdict,
          policyRuleId: 'skills.r1',
        },
        meta: rec.events[6]!.meta,
      });
      const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
      expect(rowIds(a, 'understood').includes('understood.refused')).toBe(refused);
      expect(a.facts.routing.refusals.length).toBe(refused ? 1 : 0);
    },
  );
});

describe('B2 — judge everything; cap only what is listed', () => {
  it('REAL — 55 calls: the 54th failed, the 55th returned [] — both judged (the reviewer’s H2)', async () => {
    const calls = Array.from({ length: 55 }, (_, i) => ({
      id: `c${i + 1}`,
      name: i === 54 ? 'empty' : i === 53 ? 'boom' : 'ok',
      args: {},
    }));
    const { recording, runId } = await realRun({
      tools: [
        tool('ok', () => [{ id: 1 }]),
        tool('empty', () => []),
        tool('boom', () => {
          throw new Error('down');
        }),
      ],
      replies: [{ toolCalls: calls }, { content: 'done' }],
    });
    const a = explain(recording, runId);
    expect(a.facts.calls).toHaveLength(50); // the LISTING is capped
    expect(a.facts.callsOmitted).toBe(5);
    expect(a.facts.errors.failed).toBe(1); // the JUDGING is not
    expect(rowText(a, 'anything-wrong')).toContain(
      '1 tool call did not run cleanly: 1 failed, 0 refused by a rule, 0 declined by a person, 0 not run.',
    );
    expect(a.signals.map((s) => s.id)).toEqual(['undeclared-empty-used']);
    expect(a.summary.tone).toBe('bad');
    expect(rowText(a, 'anything-wrong')).not.toContain('No tool call failed or was refused.');
  });

  it('an existence item at position 31 of a section is a signal', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    const absent = rec.events[51]!.payload;
    absent.notChecked = [
      ...Array.from({ length: 30 }, (_, i) => ({ what: `scope item ${i}`, kind: 'scope' })),
      { what: 'whether that name is a storage array at all', kind: 'existence' },
    ];
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(a.signals[0]!.sentence.text).toBe(
      'get_array_inventory says it did not check whether that name is a storage array at all.',
    );
    expect(a.facts.calls[0]!.coverage?.notChecked).toBe(31);
  });
});

describe('S1 — bounded whatever the run held (the reviewer’s size cases)', () => {
  const bounded = (a: AnswerAccount, rec: unknown) => {
    const shown = showLeaves(a, rec as Recording, NEO_DECLARATIONS);
    expect(JSON.stringify(a).length).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.stringify(shown).length).toBeLessThanOrEqual(MAX_SHOWN_BYTES);
    assertP7(a, rec as Recording, NEO_DECLARATIONS);
  };

  it('3,000 rejections of other ids, 1 KB each', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    for (let i = 0; i < 3000; i++)
      rec.events.push({
        type: 'agentfootprint.skill.rejected',
        payload: { requestedId: `x${i}-${'y'.repeat(1000)}` },
        meta: rec.events[6]!.meta,
      });
    const a = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(a.facts.routing.refusals).toHaveLength(12);
    expect(a.facts.routing.refusalsOmitted).toBe(2988);
    expect(a.facts.routing.refusals.every((r) => r.requestedId.length <= 200)).toBe(true);
    bounded(a, rec);
  });

  it('3,000 rejections of the DECIDED skill: one line, then "…and n more"', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    for (let i = 0; i < 3000; i++)
      rec.events.push({
        type: 'agentfootprint.skill.rejected',
        payload: { requestedId: 'array-inventory' },
        meta: rec.events[6]!.meta,
      });
    const a = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    const understood = rowText(a, 'understood');
    expect(understood.filter((l) => l.startsWith('The skill graph refused'))).toHaveLength(1);
    expect(understood).toContain('…and 2999 more refusals of the same skill, not listed here.');
    expect(understood.length).toBeLessThan(10);
    bounded(a, rec);
  });

  it('3,000 in-view witnesses with 500-character tool names', () => {
    const rec = fixtureA() as unknown as {
      events: E[];
      snapshot: { sharedState: { history: unknown[] } };
    };
    const witness = rec.events[64]!;
    const history = rec.snapshot.sharedState.history;
    for (let i = 0; i < 3000; i++) {
      const id = `old${i}`;
      history.unshift({
        role: 'tool',
        toolName: 'z'.repeat(500) + i,
        toolCallId: id,
        content: '[]',
      });
      rec.events.push({ ...witness, payload: { ...witness.payload, sourceId: id } });
    }
    history.unshift({ role: 'user', content: 'q' });
    const a = accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(a.facts.inView).toHaveLength(50);
    expect(a.facts.inViewOmitted).toBe(2951);
    expect(a.facts.inView.every((f) => f.toolName.length <= 200)).toBe(true);
    bounded(a, rec);
  });

  it('a 1 MB question and a 1 MB answer', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events[5]!.payload.userPrompt = 'q'.repeat(1_000_000);
    rec.events[192]!.payload.finalContent = 'a'.repeat(1_000_000);
    bounded(
      accountForAnswer(rec as unknown as Recording, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID }),
      rec,
    );
  });
});

describe('S2 — the evidence line reads only the answer’s final verdict', () => {
  it('a verdict of another iteration is never read (the reviewer’s H3)', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    const e = rec.events[189]!;
    e.payload = {
      ...e.payload,
      iteration: 1,
      action: 'revision-asked',
      unsupported: [{ value: 'FOO-123', shape: 'id' }],
    };
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(rowIds(a, 'how-sure')).toContain('howSure.evidence.notRecorded');
    expect(JSON.stringify(a)).not.toContain('FOO-123');
  });

  it('a revision-asked row as the answering iteration’s last row is not a verdict on the answer', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events[189]!.payload.action = 'revision-asked';
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(rowIds(a, 'how-sure')).toContain('howSure.evidence.notRecorded');
  });

  it('no answering iteration on the record: not recorded, never the last row of any iteration', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events = rec.events.filter((e) => !e.type.endsWith('stream.llm_start'));
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(rowIds(a, 'how-sure')).toContain('howSure.evidence.notRecorded');
  });
});

describe('S4 — a call no event names is counted and kept (the reviewer’s H6)', () => {
  it('unread counts it; it is said to be unnamed; never "no tools"', () => {
    const rec = fixtureA() as unknown as {
      events: E[];
      snapshot: { sharedState: { history: Record<string, unknown>[] } };
    };
    for (const e of rec.events)
      if (/tool_start|tools\.absent|findings\.declared/.test(e.type)) delete e.payload.toolName;
    for (const m of rec.snapshot.sharedState.history)
      if (m.toolCallId === 'toolu_01HRutzrsmgifaHQm73u6kuX') delete m.toolName;
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(a.unread).toBeGreaterThanOrEqual(1);
    const ids = a.rows.flatMap((r) => r.lines.map((l) => l.template.id));
    expect(ids).not.toContain('checked.noCalls');
    expect(ids).not.toContain('found.noCalls');
    expect(rowText(a, 'checked')).toEqual([
      'A tool call (toolu_01HRutzrsmgifaHQm73u6kuX) is in this record, but no event of it names its tool.',
    ]);
    expect(a.facts.calls[0]).toMatchObject({ unnamed: true, toolName: '' });
    expect(a.unreachable.map((u) => u.sentence.template.id)).toContain('unreachable.unnamed');
  });
});

describe('S5 — a declared label obeys the one plain-line rule', () => {
  it.each([
    ['U+2028 (line separator)', 'array\u2028estate'],
    ['U+202E (bidi override)', 'array \u202Eetatse'],
    ['U+200B (zero-width space)', 'array\u200Bestate'],
    ['a tab', 'array\testate'],
  ])('refuses %s', (_label, label) => {
    expect(() => validateDeclarations({ skills: { a: { label } } })).toThrow(
      /one line of plain visible text/,
    );
  });
});

describe('M1 — the mutation survivors', () => {
  it('a6 — exactly 12 unsupported values (the event’s cap) says "at least"; 11 does not', () => {
    const at = (count: number) => {
      const rec = fixtureA() as unknown as { events: E[] };
      rec.events[189]!.payload = {
        ...rec.events[189]!.payload,
        action: 'flagged',
        unsupported: Array.from({ length: count }, (_, i) => ({ value: `V-${i}`, shape: 'id' })),
      };
      return explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    };
    expect(rowIds(at(12), 'how-sure')).toContain('howSure.evidence.flagged.atLeast');
    expect(at(12).facts.evidence.value?.capped).toBe(true);
    expect(rowIds(at(11), 'how-sure')).toContain('howSure.evidence.flagged.list');
    expect(at(11).facts.evidence.value?.capped).toBe(false);
  });

  it('a11 — a withheld result is never judged for emptiness', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    const end = rec.events[59]!;
    end.payload = {
      toolCallId: end.payload.toolCallId,
      result: [],
      durationMs: 1,
      modelResult: 'RULE-REFUSAL-TEXT-XYZ',
    };
    rec.events[52]!.payload.outcome = 'deny';
    rec.events[52]!.payload.changed = true;
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(a.facts.calls[0]).toMatchObject({
      outcome: 'ran',
      withheldBy: 'seo:subject-carry',
      emptiness: 'unknown',
    });
    expect(a.facts.calls[0]).not.toHaveProperty('rows');
    expect(a.facts.calls[0]).not.toHaveProperty('view');
    expect(a.signals.map((s) => s.id)).not.toContain('undeclared-empty-used');
  });

  it('a13 — `kind` on a checked item is refused by the reader: no chip, no signal', () => {
    const rec = fixtureA() as unknown as { events: E[] };
    rec.events[51]!.payload.checked[0].kind = 'existence';
    const a = explain(rec as unknown as Recording, FLAGSHIP_RUN_ID, NEO_DECLARATIONS);
    expect(a.signals.map((s) => s.id)).not.toContain('existence-not-checked');
    const checked = a.rows.find((r) => r.id === 'checked')!.lines;
    expect(checked.some((l) => l.chips?.some((c) => c.mark === 'kind'))).toBe(false);
    expect(a.facts.calls[0]!.coverage?.kinds).toBe(0);
  });

  it('a14 — the deny list wins over an allow-list that names a denied leaf', () => {
    const widened = {
      ...SHOW_ME_ALLOW_LIST,
      'stream.tool_end': [...SHOW_ME_ALLOW_LIST['stream.tool_end']!, '/result', '/modelResult'],
      'context.injected': [...SHOW_ME_ALLOW_LIST['context.injected']!, '/rawContent'],
    };
    const p = (type: string, path: string) => ({
      kind: 'event' as const,
      index: 0,
      type: `agentfootprint.${type}`,
      path,
    });
    expect(isShowable(p('stream.tool_end', '/result'), widened)).toBe(false);
    expect(isShowable(p('stream.tool_end', '/modelResult'), widened)).toBe(false);
    expect(isShowable(p('context.injected', '/rawContent'), widened)).toBe(false);
    expect(isShowable(p('stream.tool_end', '/status'), widened)).toBe(true); // the control
  });
});

describe('af-1 F1 — a ledger that bounds itself is served as found', () => {
  it('servedToModel / strip on a cycle: no RangeError, the value back as found', () => {
    const v: Record<string, unknown> = {
      af_coverage: { checked: [{ what: 'x', short: 'x' }] },
      result: null,
    };
    v.result = v;
    expect(() => servedToModel(v)).not.toThrow();
    const served = strip(v) as Record<string, unknown>;
    expect((served.af_coverage as { checked: object[] }).checked[0]).toEqual({ what: 'x' }); // still stripped
    expect(served.result).toBe(v); // the cycle edge returned as found
  });
});

describe('af-3 security — the conversation id never leaves in an account', () => {
  it('fixture A: neither the account nor its show-me map carries the session id', () => {
    const rec = fixtureA();
    const session = (rec.events[0] as unknown as E).meta.sessionId as string;
    expect(session).toMatch(/^a4fb6d65-/);
    const a = accountForAnswer(rec, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
    expect(a.run.value).not.toHaveProperty('sessionId');
    const response = JSON.stringify({ account: a, shown: showLeaves(a, rec, NEO_DECLARATIONS) });
    expect(response).not.toContain(session);
    const p = {
      kind: 'event' as const,
      index: 0,
      type: 'agentfootprint.agent.run_configured',
      path: '#meta/sessionId',
    };
    expect(isShowable(p)).toBe(false);
  });
});
