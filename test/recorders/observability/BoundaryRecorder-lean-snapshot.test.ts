/**
 * Tests — `BoundaryRecorder` payload-lean snapshot mode.
 *
 * `toSnapshot()` is what leaves the process: it lands in
 * `runtimeSnapshot.recorders` and gets written to disk, posted to a
 * viewer, or stored as a run artifact. Full mode carries every field of
 * every `DomainEvent`, including everything the agent read and produced.
 * The consumer that rebuilds a commit-range index offline reads five
 * fields per event and none of the content — so `snapshot: 'lean'` drops
 * the content and keeps the structure.
 *
 * Sections:
 *   1. unit         — what lean drops, what it keeps, what stays default
 *   2. functional   — lean is a projection, not a mutation
 *   3. integration  — one captured demo turn: the index rebuilds
 *                     identically from lean data, and the bundle shrinks
 *                     by a wide, fixture-relative margin
 *   4. security     — no captured content survives into a lean bundle
 *
 * The integration fixture is one captured agentfootprint turn (4 ReAct
 * iterations, 3 tool calls, the 3 context slots fanned out in parallel
 * each iteration). Replaying it drives the recorder through the same
 * event sequence the live run did — but NOT the same payload sizes: the
 * capture kept each subflow's final state and nothing else, so the
 * replay uses that state for both the entry and the exit of every
 * boundary. Entry payloads are therefore larger here than in a real run
 * (where an entry carries only the mapped input seed), and the FULL
 * bundle this file measures is several times a real one — 276 KB here,
 * 87% of it that doubled state, against 69.7 KB measured end to end on a
 * real 4-iteration turn with the recorder attached. The lean bundle
 * carries no payloads at all, so it is unaffected. Hence the size test
 * asserts a loose bound rather than the observed ratio, and no number
 * from this file belongs in a release note.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CommitRangeIndex, type RangeToken } from 'footprintjs/trace';
import type { FlowSubflowEvent } from 'footprintjs';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  BoundaryRecorder,
  boundaryRecorder,
  type DomainEvent,
  type LeanDomainEvent,
} from '../../../src/recorders/observability/BoundaryRecorder.js';

// ── The contract under test ─────────────────────────────────────────

/** Fields a lean bundle must NOT carry — the captured content. */
const CONTENT_FIELDS = ['payload', 'args', 'result', 'content', 'contentSummary'] as const;

/** Fields the offline boundary-index rebuild reads. Nothing else. */
const REBUILD_FIELDS = [
  'type',
  'runtimeStageId',
  'commitIdxBefore',
  'subflowPath',
  'depth',
] as const;

// ── Helpers ─────────────────────────────────────────────────────────

function subEvt(
  subflowId: string,
  runtimeStageId: string,
  payload?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name: subflowId,
    subflowId,
    description: `LLMCall: ${subflowId}`,
    mappedInput: payload,
    outputState: payload,
    traversalContext: {
      runId: 'r1',
      stageId: subflowId,
      runtimeStageId,
      stageName: subflowId,
      depth: 1,
    },
  };
}

function dispatchTyped(
  dispatcher: EventDispatcher,
  type: string,
  payload: Record<string, unknown>,
  subflowPath: readonly string[] = ['sf-a'],
): void {
  dispatcher.dispatch({
    type,
    payload,
    meta: {
      wallClockMs: 1000,
      runOffsetMs: 0,
      runtimeStageId: 'sf-a/stage#2',
      subflowPath,
      compositionPath: [],
      runId: 'r1',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/** One recorder carrying at least one event of every content-bearing kind. */
function recorderWithContent(mode?: 'full' | 'lean'): BoundaryRecorder {
  const rec = boundaryRecorder({
    ...(mode ? { snapshot: mode } : {}),
    getCommitCount: () => 3,
  });
  const dispatcher = new EventDispatcher();
  rec.subscribe(dispatcher);

  rec.onRunStart({ payload: { question: 'run input' } });
  rec.onSubflowEntry(subEvt('sf-a', 'sf-a#1', { seeded: 'subflow input' }));
  dispatchTyped(dispatcher, 'agentfootprint.stream.llm_start', {
    model: 'm',
    provider: 'p',
    systemPromptChars: 10,
  });
  dispatchTyped(dispatcher, 'agentfootprint.stream.llm_end', {
    content: 'assistant said this',
    toolCallCount: 1,
    usage: { input: 7, output: 11 },
    stopReason: 'tool_use',
  });
  dispatchTyped(dispatcher, 'agentfootprint.stream.tool_start', {
    toolName: 'lookup',
    toolCallId: 't0',
    args: { query: 'tool argument' },
  });
  dispatchTyped(dispatcher, 'agentfootprint.stream.tool_end', {
    toolCallId: 't0',
    result: 'tool result body',
    durationMs: 2,
  });
  dispatchTyped(dispatcher, 'agentfootprint.context.injected', {
    slot: 'system-prompt',
    source: 'skill',
    sourceId: 'refunds',
    contentSummary: 'injected content preview',
    reason: 'always-on',
  });
  rec.onSubflowExit(subEvt('sf-a', 'sf-a#1', { produced: 'subflow output' }));
  rec.onRunEnd({ payload: { answer: 'run output' } });
  return rec;
}

function snapshotData(rec: BoundaryRecorder): readonly Record<string, unknown>[] {
  return rec.toSnapshot().data as unknown as readonly Record<string, unknown>[];
}

/** Same, minus the wall clock — two recorders built a millisecond apart
 *  are otherwise identical, and `ts` is the only field that isn't. */
function snapshotDataStable(rec: BoundaryRecorder): readonly Record<string, unknown>[] {
  return snapshotData(rec).map(({ ts: _ts, ...rest }) => rest);
}

// ── The offline rebuild, as the consumer performs it ─────────────────

interface RebuiltRange {
  readonly startIdx: number;
  readonly endIdx: number | undefined;
  readonly type: string;
  readonly runtimeStageId: string;
  readonly subflowPath: readonly string[];
  readonly depth: number;
}

const ENTRY_TYPES = new Set(['run.entry', 'subflow.entry']);
const EXIT_TYPES = new Set(['run.exit', 'subflow.exit']);

/**
 * Rebuild the commit-range index from a stored event stream — pair each
 * boundary's entry with its exit by `runtimeStageId` and replay
 * `open()` / `close()` at the commit index the events carry.
 *
 * Every event is projected down to `REBUILD_FIELDS` first, so whatever
 * else the stream carries is provably unread here. That projection IS
 * the assertion: if a lean bundle stopped carrying one of those five,
 * the rebuilt ranges would stop matching the live index.
 */
function rebuildBoundaryIndex(
  events: readonly (DomainEvent | LeanDomainEvent)[],
): CommitRangeIndex<Omit<RebuiltRange, 'startIdx' | 'endIdx'>> {
  const index = new CommitRangeIndex<Omit<RebuiltRange, 'startIdx' | 'endIdx'>>();
  const open = new Map<string, RangeToken>();
  for (const raw of events) {
    const e = {
      type: raw.type,
      runtimeStageId: raw.runtimeStageId,
      commitIdxBefore: raw.commitIdxBefore,
      subflowPath: raw.subflowPath,
      depth: raw.depth,
    };
    if (ENTRY_TYPES.has(e.type)) {
      const token = index.open(
        {
          type: e.type,
          runtimeStageId: e.runtimeStageId,
          subflowPath: e.subflowPath,
          depth: e.depth,
        },
        e.commitIdxBefore,
      );
      open.set(e.runtimeStageId, token);
    } else if (EXIT_TYPES.has(e.type)) {
      const token = open.get(e.runtimeStageId);
      if (token) {
        index.close(token, e.commitIdxBefore);
        open.delete(e.runtimeStageId);
      }
    }
  }
  return index;
}

/** Flatten any index — live or rebuilt — to a comparable range list. */
function rangesOf(index: {
  overlapping: (
    a: number,
    b: number,
  ) => readonly {
    label: { type: string; runtimeStageId: string; subflowPath: readonly string[]; depth: number };
    startIdx: number;
    endIdx?: number;
  }[];
}): RebuiltRange[] {
  return index.overlapping(0, Number.MAX_SAFE_INTEGER).map((r) => ({
    startIdx: r.startIdx,
    endIdx: r.endIdx,
    type: r.label.type,
    runtimeStageId: r.label.runtimeStageId,
    subflowPath: r.label.subflowPath,
    depth: r.label.depth,
  }));
}

// ── The real demo turn ──────────────────────────────────────────────

interface DemoTurn {
  readonly runId: string;
  readonly runInput: unknown;
  readonly commits: readonly { readonly idx: number; readonly runtimeStageId: string }[];
  readonly subflowResults: Readonly<Record<string, unknown>>;
  readonly finalState: Readonly<Record<string, unknown>>;
  readonly events: readonly {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly meta: { readonly runtimeStageId: string };
  }[];
}

const demoTurn: DemoTurn = JSON.parse(
  readFileSync(new URL('./fixtures/demo-turn.json', import.meta.url), 'utf8'),
) as DemoTurn;

/** Trailing `#executionIndex` — globally monotonic, so it orders the run. */
const execIndexOf = (runtimeStageId: string): number =>
  Number(runtimeStageId.slice(runtimeStageId.lastIndexOf('#') + 1));

/**
 * Drive a recorder through the captured turn.
 *
 * A subflow is open from its first commit to its last: the mount stage
 * commits once when it seeds and once when it merges back, and the run's
 * commit log records both. Typed events fire mid-stage, before the
 * commit of the stage that raised them, so they are released as soon as
 * the cursor reaches their execution index.
 *
 * `mountEvent` hands the SAME captured state to both phases — the
 * capture kept final states only, so there is no recorded entry seed to
 * replay. Boundary structure is exact; entry payloads are not, which
 * only inflates the full bundle (see the file header).
 */
function replayDemoTurn(mode: 'full' | 'lean'): BoundaryRecorder {
  let commitCount = 0;
  const rec = boundaryRecorder({ snapshot: mode, getCommitCount: () => commitCount });
  const dispatcher = new EventDispatcher();
  rec.subscribe(dispatcher);

  const firstCommit = new Map<string, number>();
  const lastCommit = new Map<string, number>();
  demoTurn.commits.forEach((c, i) => {
    if (!c.runtimeStageId.startsWith('sf-')) return;
    if (!firstCommit.has(c.runtimeStageId)) firstCommit.set(c.runtimeStageId, i);
    lastCommit.set(c.runtimeStageId, i);
  });

  const mountEvent = (runtimeStageId: string, phase: 'entry' | 'exit'): FlowSubflowEvent => {
    const subflowId = runtimeStageId.slice(0, runtimeStageId.lastIndexOf('#'));
    const state = demoTurn.subflowResults[runtimeStageId];
    return {
      name: subflowId,
      subflowId,
      description: `Subflow: ${subflowId}`,
      ...(phase === 'entry' ? { mappedInput: state } : { outputState: state }),
      traversalContext: {
        runId: demoTurn.runId,
        stageId: subflowId,
        runtimeStageId,
        stageName: subflowId,
        depth: 1,
      },
    } as FlowSubflowEvent;
  };

  const typed = [...demoTurn.events].sort(
    (a, b) => execIndexOf(a.meta.runtimeStageId) - execIndexOf(b.meta.runtimeStageId),
  );
  let cursor = 0;
  const releaseTypedUpTo = (execIndex: number): void => {
    while (cursor < typed.length && execIndexOf(typed[cursor]!.meta.runtimeStageId) <= execIndex) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dispatcher.dispatch(typed[cursor] as any);
      cursor++;
    }
  };

  rec.onRunStart({ payload: demoTurn.runInput });
  demoTurn.commits.forEach((commit, i) => {
    commitCount = i;
    for (const [runtimeStageId, at] of firstCommit) {
      if (at === i) rec.onSubflowEntry(mountEvent(runtimeStageId, 'entry'));
    }
    releaseTypedUpTo(execIndexOf(commit.runtimeStageId));
    commitCount = i + 1;
    for (const [runtimeStageId, at] of lastCommit) {
      if (at === i) rec.onSubflowExit(mountEvent(runtimeStageId, 'exit'));
    }
  });
  releaseTypedUpTo(Number.MAX_SAFE_INTEGER);
  commitCount = demoTurn.commits.length;
  rec.onRunEnd({ payload: demoTurn.finalState });
  return rec;
}

// ─── 1. UNIT ────────────────────────────────────────────────────────

describe('BoundaryRecorder snapshot mode — unit', () => {
  it('full is the default — an unconfigured recorder still ships content', () => {
    const data = snapshotData(recorderWithContent());
    const runEntry = data.find((e) => e['type'] === 'run.entry');
    const toolEnd = data.find((e) => e['type'] === 'tool.end');
    expect(runEntry?.['payload']).toEqual({ question: 'run input' });
    expect(toolEnd?.['result']).toBe('tool result body');
  });

  it("snapshot: 'full' is explicit-equal to the default", () => {
    expect(snapshotDataStable(recorderWithContent('full'))).toEqual(
      snapshotDataStable(recorderWithContent()),
    );
  });

  it("snapshot: 'lean' drops every content field", () => {
    for (const event of snapshotData(recorderWithContent('lean'))) {
      for (const field of CONTENT_FIELDS) {
        expect(event, `${String(event['type'])} still carries ${field}`).not.toHaveProperty(field);
      }
    }
  });

  it("snapshot: 'lean' keeps every field the rebuild reads", () => {
    for (const event of snapshotData(recorderWithContent('lean'))) {
      for (const field of REBUILD_FIELDS) {
        expect(event).toHaveProperty(field);
      }
    }
  });

  it("snapshot: 'lean' keeps the structural fields beyond the rebuild's five", () => {
    const data = snapshotData(recorderWithContent('lean'));
    expect(data.find((e) => e['type'] === 'subflow.entry')).toMatchObject({
      subflowId: 'sf-a',
      localSubflowId: 'sf-a',
      subflowName: 'sf-a',
      primitiveKind: 'LLMCall',
      isAgentInternal: false,
      commitIdxAfter: 3,
    });
    expect(data.find((e) => e['type'] === 'llm.end')).toMatchObject({
      toolCallCount: 1,
      usage: { input: 7, output: 11 },
      stopReason: 'tool_use',
      actorArrow: 'llm→tool',
    });
    expect(data.find((e) => e['type'] === 'tool.start')).toMatchObject({
      toolName: 'lookup',
      toolCallId: 't0',
    });
    expect(data.find((e) => e['type'] === 'context.injected')).toMatchObject({
      slot: 'system-prompt',
      source: 'skill',
      sourceId: 'refunds',
      reason: 'always-on',
    });
  });

  it('the bundle says which mode produced it', () => {
    expect(recorderWithContent('lean').toSnapshot().description).toContain('lean');
    expect(recorderWithContent('full').toSnapshot().description).not.toContain('lean');
    expect(recorderWithContent('lean').toSnapshot().name).toBe('BoundaryEvents');
    expect(recorderWithContent('lean').toSnapshot().preferredOperation).toBe('translate');
  });
});

// ─── 2. FUNCTIONAL ──────────────────────────────────────────────────

describe('BoundaryRecorder snapshot mode — functional', () => {
  it('lean is a projection — the live stream keeps its content', () => {
    const rec = recorderWithContent('lean');
    rec.toSnapshot();
    const live = rec.getEvents();
    expect(live.find((e) => e.type === 'run.entry')).toHaveProperty('payload');
    expect(live.find((e) => e.type === 'tool.end')).toHaveProperty('result');
    // In-process consumers (buildStepGraph, aggregateForBoundary) read
    // getEvents(), so lean mode never changes what they see.
    expect(rec.aggregateForBoundary('sf-a#1')?.llmCalls).toBe(1);
  });

  it('lean and full describe the same events in the same order', () => {
    const lean = snapshotData(recorderWithContent('lean'));
    const full = snapshotData(recorderWithContent('full'));
    expect(lean.map((e) => e['type'])).toEqual(full.map((e) => e['type']));
    expect(lean.map((e) => e['runtimeStageId'])).toEqual(full.map((e) => e['runtimeStageId']));
  });
});

// ─── 3. INTEGRATION — one real demo turn ────────────────────────────

describe('BoundaryRecorder snapshot mode — real demo turn', () => {
  it('replays into a non-trivial run', () => {
    const rec = replayDemoTurn('full');
    const byType = new Map<string, number>();
    for (const e of rec.getEvents()) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    expect(byType.get('subflow.entry')).toBe(28);
    expect(byType.get('subflow.exit')).toBe(28);
    expect(byType.get('llm.start')).toBe(4);
    expect(byType.get('tool.start')).toBe(3);
    expect(byType.get('context.injected')).toBe(32);
    expect(rec.boundaryIndex.size).toBe(29);
  });

  it('the boundary index rebuilds from the LEAN bundle, range for range', () => {
    const leanRec = replayDemoTurn('lean');
    const rebuilt = rebuildBoundaryIndex(leanRec.toSnapshot().data as readonly LeanDomainEvent[]);
    // The recorder's own index — built live during the run — is ground truth.
    expect(rangesOf(rebuilt)).toEqual(rangesOf(leanRec.boundaryIndex));
    expect(rangesOf(rebuilt)).toHaveLength(29);
    // Every range closed: no boundary lost its exit in the projection.
    expect(rangesOf(rebuilt).every((r) => r.endIdx !== undefined)).toBe(true);
  });

  it('lean and full rebuild the identical index', () => {
    const fromLean = rebuildBoundaryIndex(
      replayDemoTurn('lean').toSnapshot().data as readonly LeanDomainEvent[],
    );
    const fromFull = rebuildBoundaryIndex(
      replayDemoTurn('full').toSnapshot().data as readonly DomainEvent[],
    );
    expect(rangesOf(fromLean)).toEqual(rangesOf(fromFull));
  });

  it('lean cuts the bundle by more than 5x', () => {
    const full = JSON.stringify(replayDemoTurn('full').toSnapshot()).length;
    const lean = JSON.stringify(replayDemoTurn('lean').toSnapshot()).length;
    // Measured on this REPLAY: 276 KB → 32 KB. NOT a real turn's ratio —
    // the replay doubles every subflow's final state across entry and exit
    // (file header). A real turn measured 69.7 KB → 21.7 KB (3.2x). The
    // bound here is loose on purpose, so a fixture refresh doesn't turn a
    // still-large win into a red build.
    expect(lean * 5).toBeLessThan(full);
  });
});

// ─── 4. SECURITY ────────────────────────────────────────────────────

/**
 * Scope of the guarantee: the five `CONTENT_FIELDS` — everything the
 * agent read, produced, or handed across a boundary. Two short
 * capture-time annotations are OUT of scope on purpose (`rationale`,
 * `reason`); the last test in this block pins that boundary so nobody
 * reads "lean" as "free-text-free".
 */
describe('BoundaryRecorder snapshot mode — security', () => {
  it('no captured content reaches a lean bundle, at any nesting depth', () => {
    const rec = boundaryRecorder({ snapshot: 'lean', getCommitCount: () => 0 });
    const dispatcher = new EventDispatcher();
    rec.subscribe(dispatcher);
    rec.onRunStart({ payload: { token: 'run-secret' } });
    rec.onSubflowEntry(subEvt('sf-a', 'sf-a#1', { nested: { deep: 'subflow-secret' } }));
    dispatchTyped(dispatcher, 'agentfootprint.stream.tool_end', {
      toolCallId: 't0',
      result: { rows: [{ email: 'tool-secret' }] },
    });
    rec.onRunEnd({ payload: { answer: 'exit-secret' } });

    const serialized = JSON.stringify(rec.toSnapshot());
    for (const secret of ['run-secret', 'subflow-secret', 'tool-secret', 'exit-secret']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('the whole demo turn carries no captured content into a lean bundle', () => {
    const serialized = JSON.stringify(replayDemoTurn('lean').toSnapshot());
    // The user's question and the agent's tool output both appear in the
    // full bundle; neither may survive the lean projection.
    expect(JSON.stringify(replayDemoTurn('full').toSnapshot())).toContain('Heat');
    expect(serialized).not.toContain('rents for');
  });

  it('the guarantee is payloads, not free text — rationale and reason survive', () => {
    const rec = boundaryRecorder({ snapshot: 'lean', getCommitCount: () => 0 });
    const dispatcher = new EventDispatcher();
    rec.subscribe(dispatcher);
    rec.onDecision({
      decider: 'route',
      chosen: 'tool-calls',
      rationale: 'user asked about ACCOUNT-4417',
      traversalContext: { runId: 'r1', stageId: 'route', runtimeStageId: 'route#1', depth: 0 },
    });
    dispatchTyped(dispatcher, 'agentfootprint.context.injected', {
      slot: 'system-prompt',
      source: 'skill',
      contentSummary: 'refund policy text',
      reason: 'matched ACCOUNT-4417',
    });

    const serialized = JSON.stringify(rec.toSnapshot());
    // Deliberate: these two say WHY a boundary happened, and a lean
    // bundle without them explains nothing. They are short annotations,
    // not captured payloads — but they CAN interpolate run values, so
    // lean is not a redaction guarantee for free text. Changing this is
    // an owner decision; the test exists so it can't change silently.
    expect(serialized).toContain('user asked about ACCOUNT-4417');
    expect(serialized).toContain('matched ACCOUNT-4417');
    // The payload alongside them is still gone.
    expect(serialized).not.toContain('refund policy text');
  });
});
