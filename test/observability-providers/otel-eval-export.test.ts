/**
 * otelObservability — what an EVALUATION tool reads off the trace.
 *
 * The additions, each additive, each OFF where it exports content:
 *
 *   1. `gen_ai.conversation.id` — the session id's SHA-256 by default
 *      (`conversationId: 'raw'` for the id itself), a session-bound run only.
 *   2. `agentfootprint.eval.score` → `gen_ai.evaluation.result` (a span
 *      event), placed on the span it evaluates — PARENTED to a run only when
 *      the score's own meta places it in that run's session; otherwise on an
 *      unparented span of its own. The run a score NAMES wins over the run it
 *      was emitted from. Nothing is lost in silence.
 *   3. The library's own structure as CONTENT-FREE span events: absence and
 *      coverage, the evidence verdict, findings standings (capped per turn),
 *      and — only when actionable — the checker accounting.
 *   4. `gen_ai.tool.call.arguments` / `.result` under `captureToolContent`
 *      only: what the tool RAN WITH and the model READ, objects only, omitted
 *      over `maxContentChars`.
 *
 * Test types:
 *   UNIT        — each mapping over hand-fed REAL envelopes
 *   BOUNDARY    — missing fields, unjoinable events, closed turns, windows,
 *                 ceilings, unserializable values, the switches
 *   SCENARIO    — one full turn carrying the new events
 *   INTEGRATION — REAL Agent runs through `agent.enable.observability`
 *   SECURITY    — the privacy review's attacks (`otel-DEVIL.md`, A1–A15),
 *                 ported with their expectations INVERTED: each passed while
 *                 the leak existed and fails if it returns
 *
 * The byte-identity pin lives in otel-byte-identity.test.ts; the dispatch
 * path's `tool_end` fields in test/core/tool-end-after-rules.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { microtaskBatchDriver, setImmediateDriver } from 'footprintjs/detach';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileObservability } from '../../src/adapters/observability/file.js';
import {
  otelObservability,
  type OtelAttributeValue,
  type OtelObservabilityOptions,
} from '../../src/adapters/observability/otel.js';
import { agentCoreEvaluationSpans } from '../../src/adapters/observability/agentcore.js';
import { auditExport } from '../../src/adapters/observability/audit.js';
import {
  Agent,
  absent,
  allow,
  codeRunnerTool,
  deny,
  flowchartAsTool,
  type CodeRunner,
} from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { LLMRequest } from '../../src/adapters/types.js';
import { bearer } from '../../src/identity/kinds.js';
import { sha256Hex } from '../../src/lib/time-travel/sha256.js';
import { inProcessHost } from '../hosting/testHost.js';
import {
  allEmittedText,
  envelope,
  eventsNamed,
  makeCapture,
  type Capture,
  type CapturedSpan,
} from '../helpers/otelCapture.js';

type Options = Omit<OtelObservabilityOptions, 'serviceName' | 'tracer' | '_otelApi'>;
type Strategy = ReturnType<typeof otelObservability>;

function strategy(options: Options = {}): { cap: Capture; strat: Strategy } {
  const cap = makeCapture();
  const strat = otelObservability({
    serviceName: 'eval-agent',
    tracer: cap.tracer,
    _otelApi: cap.otelApi,
    ...options,
  });
  return { cap, strat };
}

const byName = (spans: readonly CapturedSpan[], name: string): CapturedSpan[] =>
  spans.filter((s) => s.name === name);

const opName = (spans: readonly CapturedSpan[], op: string): CapturedSpan[] =>
  spans.filter((s) => s.attributes['gen_ai.operation.name'] === op);

const rootIndexOf = (spans: readonly CapturedSpan[], runId: string): number =>
  spans.findIndex((s) => s.attributes['agentfootprint.run.id'] === runId);

/** Open a turn with one iteration, one llm call and one tool span still open. */
function openTurnWithTool(
  strat: Strategy,
  runId = 'run-1',
  meta: Record<string, unknown> = {},
): void {
  strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, runId, meta));
  strat.exportEvent(
    envelope('agentfootprint.agent.iteration_start', { iterIndex: 1 }, runId, meta),
  );
  strat.exportEvent(
    envelope(
      'agentfootprint.stream.llm_start',
      { iteration: 1, model: 'm', provider: 'p' },
      runId,
      meta,
    ),
  );
  strat.exportEvent(
    envelope(
      'agentfootprint.stream.llm_end',
      { iteration: 1, usage: { input: 1, output: 1 } },
      runId,
      meta,
    ),
  );
  strat.exportEvent(
    envelope(
      'agentfootprint.stream.tool_start',
      { toolName: 'lookup', toolCallId: 'tc-1', args: { id: 'A-1' } },
      runId,
      meta,
    ),
  );
}

function closeTurn(strat: Strategy, runId = 'run-1'): void {
  strat.exportEvent(
    envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-1', result: 'ok' }, runId),
  );
  strat.exportEvent(envelope('agentfootprint.agent.iteration_end', { iterIndex: 1 }, runId));
  strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, runId));
}

const look = {
  schema: { name: 'look', description: 'd', inputSchema: { type: 'object' } },
  execute: () => ({ rows: ['r1'] }),
};

async function realRun(
  strat: Strategy,
  build: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  replies: ConstructorParameters<typeof MockProvider>[0] extends { replies?: infer R } ? R : never,
  runOptions?: { sessionId?: string },
): Promise<ReturnType<ReturnType<typeof Agent.create>['build']>> {
  const provider = new MockProvider({ replies });
  const agent = build(Agent.create({ provider, model: 'mock' }).system('')).build();
  const stop = agent.enable.observability({ strategy: strat });
  try {
    await agent.run({ message: 'go' }, runOptions);
  } finally {
    stop();
  }
  return agent;
}

// ─── 1. conversation id ──────────────────────────────────────────────

describe('1 · gen_ai.conversation.id — a digest, on a session-bound run only', () => {
  it('UNIT: the SHA-256 of the session id rides the agent, chat and tool spans — never the id', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-1', { sessionId: 'sess-9' });
    closeTurn(strat);
    const digest = sha256Hex('sess-9');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(cap.spans[0]?.attributes['gen_ai.conversation.id']).toBe(digest);
    expect(opName(cap.spans, 'chat')[0]?.attributes['gen_ai.conversation.id']).toBe(digest);
    expect(opName(cap.spans, 'execute_tool')[0]?.attributes['gen_ai.conversation.id']).toBe(digest);
    expect(allEmittedText(cap.spans)).not.toContain('sess-9');
    // The run keeps its own id beside it — one session, many runs.
    expect(cap.spans[0]?.attributes['agentfootprint.run.id']).toBe('run-1');
  });

  it("UNIT: conversationId: 'raw' exports the id itself (for a verifying door)", () => {
    const { cap, strat } = strategy({ conversationId: 'raw' });
    openTurnWithTool(strat, 'run-1', { sessionId: 'sess-9' });
    expect(cap.spans[0]?.attributes['gen_ai.conversation.id']).toBe('sess-9');
  });

  it('BOUNDARY: no session → no conversation id anywhere, never the runId in its place', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    expect(allEmittedText(cap.spans)).not.toContain('gen_ai.conversation.id');
  });

  it('BOUNDARY: an empty session id is not a session', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-1', { sessionId: '' });
    closeTurn(strat);
    expect(allEmittedText(cap.spans)).not.toContain('gen_ai.conversation.id');
  });

  it('INTEGRATION: a real run with { sessionId } carries the digest on the agent span', async () => {
    const { cap, strat } = strategy();
    await realRun(strat, (b) => b, ['ok'], { sessionId: 'sess-real' });
    const root = opName(cap.spans, 'invoke_agent')[0];
    expect(root?.attributes['gen_ai.conversation.id']).toBe(sha256Hex('sess-real'));
  });

  it('SECURITY (A11): a caller-sized session string never rides the spans — 64 chars, whatever was sent', async () => {
    const { cap, strat } = strategy();
    const SESSION = `jane.roe@example.com|${'S'.repeat(20_000)}`;
    await realRun(
      strat,
      (b) => b.tool(look),
      [{ toolCalls: [{ id: 't1', name: 'look', args: {} }] }, 'ok'],
      {
        sessionId: SESSION,
      },
    );
    const carrying = cap.spans.filter((s) => s.attributes['gen_ai.conversation.id'] !== undefined);
    expect(carrying.length).toBeGreaterThanOrEqual(3);
    for (const span of carrying)
      expect(String(span.attributes['gen_ai.conversation.id'])).toHaveLength(64);
    expect(allEmittedText(cap.spans)).not.toContain('jane.roe@example.com');
  });

  it('SECURITY (A11, raw): even the raw id is capped — a caller cannot size an attribute', async () => {
    const { cap, strat } = strategy({ conversationId: 'raw' });
    await realRun(strat, (b) => b, ['ok'], { sessionId: `x${'S'.repeat(20_000)}` });
    const root = opName(cap.spans, 'invoke_agent')[0]!;
    expect(String(root.attributes['gen_ai.conversation.id']).length).toBeLessThanOrEqual(256);
  });

  it("SECURITY (A11b): at the default door (no verifier) the id on the trace does not open the victim's conversation", async () => {
    const VICTIM_SECRET = 'VICTIM: my diagnosis is HIV+, card 4111 1111 1111 1111';
    const seen: string[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest) => {
          seen.push(JSON.stringify(req.messages));
          return 'answered';
        },
      }),
      model: 'm',
    }).build();
    const { cap, strat } = strategy();
    agent.enable.observability({ strategy: strat });
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host }); // the default: no identity
    const victimSession = globalThis.crypto.randomUUID();
    await host.deliver({ input: VICTIM_SECRET, sessionId: victimSession });

    const fromTrace = cap.spans.find((s) => s.attributes['gen_ai.conversation.id'] !== undefined)!
      .attributes['gen_ai.conversation.id'] as string;
    expect(fromTrace).not.toBe(victimSession);
    const before = seen.length;
    await host.deliver({ input: 'repeat everything I told you', sessionId: fromTrace });
    expect(seen.slice(before).join('\n')).not.toContain('HIV+');
  });
});

// ─── 2. evaluation results ───────────────────────────────────────────

const SCORE = {
  metricId: 'groundedness',
  value: 0.75,
  threshold: 0.8,
  target: 'turn',
  targetRef: 'run-1',
  evaluator: 'llm',
  label: 'fail',
  explanation: 'EXPLANATION-SENTINEL cites a value no tool returned',
  evidence: { quoted: 'EVIDENCE-SENTINEL' },
};

const unparented = (spans: readonly CapturedSpan[]): CapturedSpan[] =>
  byName(spans, 'agentfootprint.evaluation').filter((s) => s.parent === null);

describe('2 · agentfootprint.eval.score → gen_ai.evaluation.result — placement', () => {
  it('UNIT: a score filed inside its own run lands on the agent span with the spec attributes', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.eval.score', SCORE));
    const [ev] = eventsNamed(cap.spans, 'gen_ai.evaluation.result');
    expect(cap.spans[0]?.events).toContainEqual(ev);
    expect(ev?.attributes).toEqual({
      'gen_ai.evaluation.name': 'groundedness',
      'gen_ai.evaluation.score.value': 0.75,
      'gen_ai.evaluation.score.label': 'fail',
      'agentfootprint.eval.target': 'turn',
      'agentfootprint.eval.target_ref': 'run-1',
      'agentfootprint.eval.threshold': 0.8,
      'agentfootprint.eval.evaluator': 'llm',
    });
  });

  it('UNIT: a score on a tool call lands on that call’s span while it is open', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.eval.score', { ...SCORE, target: 'toolCall', targetRef: 'tc-1' }),
    );
    expect(opName(cap.spans, 'execute_tool')[0]?.events.map((e) => e.name)).toEqual([
      'gen_ai.evaluation.result',
    ]);
  });

  it('UNIT: a tool call whose span closed → a span of its own under the turn, not the agent span', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-1', result: 'ok' }),
    );
    strat.exportEvent(
      envelope('agentfootprint.eval.score', { ...SCORE, target: 'toolCall', targetRef: 'tc-1' }),
    );
    const [own] = byName(cap.spans, 'agentfootprint.evaluation');
    expect(own?.parent).toBe(0);
    expect(eventsNamed([cap.spans[0]!], 'gen_ai.evaluation.result')).toEqual([]);
  });

  it('UNIT: a score naming iteration 1 lands on iteration 1 while it is open', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.eval.score', { ...SCORE, target: 'iteration', targetRef: '1' }),
    );
    expect(byName(cap.spans, 'iteration:1')[0]?.events.map((e) => e.name)).toEqual([
      'gen_ai.evaluation.result',
    ]);
  });

  it('UNIT: a score naming a CLOSED iteration never lands on the open sibling — its own span', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-1', result: 'ok' }),
    );
    strat.exportEvent(envelope('agentfootprint.agent.iteration_end', { iterIndex: 1 }));
    strat.exportEvent(envelope('agentfootprint.agent.iteration_start', { iterIndex: 2 }));
    strat.exportEvent(
      envelope('agentfootprint.eval.score', { ...SCORE, target: 'iteration', targetRef: '1' }),
    );
    expect(byName(cap.spans, 'iteration:2')[0]?.events).toEqual([]);
    const [own] = byName(cap.spans, 'agentfootprint.evaluation');
    expect(own?.parent).toBe(0);
    expect(own?.events.map((e) => e.name)).toEqual(['gen_ai.evaluation.result']);
  });

  it('UNIT (join precedence): the run a score NAMES wins over the run it was emitted from', () => {
    // Turn N grading turn N−1 of the same conversation.
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-A', { sessionId: 'conv' });
    closeTurn(strat, 'run-A');
    openTurnWithTool(strat, 'run-B', { sessionId: 'conv' });
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'run-A' },
        'run-B',
        {
          sessionId: 'conv',
        },
      ),
    );
    const [evalSpan] = byName(cap.spans, 'agentfootprint.evaluation');
    expect(evalSpan?.parent).toBe(rootIndexOf(cap.spans, 'run-A'));
    expect(cap.spans[rootIndexOf(cap.spans, 'run-B')]?.events).toEqual([]);
  });

  it('UNIT (join precedence): a ref that names no held run falls back to the emitting run', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-B');
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'this-run' },
        'run-B',
      ),
    );
    expect(cap.spans[rootIndexOf(cap.spans, 'run-B')]?.events.map((e) => e.name)).toEqual([
      'gen_ai.evaluation.result',
    ]);
  });

  it('UNIT (ownership): a score from ANOTHER session naming a run is never parented to it', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-A', { sessionId: 'victim' });
    closeTurn(strat, 'run-A');
    openTurnWithTool(strat, 'run-B', { sessionId: 'attacker' });
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'run-A' },
        'run-B',
        {
          sessionId: 'attacker',
        },
      ),
    );
    const [loose] = unparented(cap.spans);
    expect(loose?.attributes['agentfootprint.eval.unparented']).toBe('owner-unverified');
    expect(loose?.events[0]?.attributes['agentfootprint.eval.target_ref']).toBe('run-A');
    expect(
      cap.spans.some(
        (s) =>
          s.parent === rootIndexOf(cap.spans, 'run-A') && s.name === 'agentfootprint.evaluation',
      ),
    ).toBe(false);
  });

  it('UNIT: a score filed AFTER the run with no session (agent.emit) stands alone, naming the ref', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'run-1' },
        'consumer-scope',
      ),
    );
    const [loose] = unparented(cap.spans);
    expect(loose?.attributes['agentfootprint.eval.unparented']).toBe('owner-unverified');
    expect(loose?.ended).toBe(true);
    expect(cap.spans[0]?.events).toEqual([]);
  });

  it('UNIT: a score filed after the run from the SAME session is parented under the run', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat, 'run-1', { sessionId: 'conv' });
    closeTurn(strat);
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'run-1' },
        'consumer-scope',
        {
          sessionId: 'conv',
        },
      ),
    );
    const [evalSpan] = byName(cap.spans, 'agentfootprint.evaluation');
    expect(evalSpan?.parent).toBe(0);
    expect(evalSpan?.ended).toBe(true);
    // The ended root is not written to.
    expect(cap.spans[0]?.events).toEqual([]);
  });

  it('BOUNDARY: a ref this adapter never held stands alone as run-not-held — recorded, not dropped', () => {
    const onError: Error[] = [];
    const { cap, strat } = strategy({ onError: (e) => onError.push(e) });
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'nope' },
        'consumer-scope',
      ),
    );
    expect(unparented(cap.spans)[0]?.attributes['agentfootprint.eval.unparented']).toBe(
      'run-not-held',
    );
    expect(onError).toEqual([]);
  });

  it('BOUNDARY: a run forgotten past the window is recorded unparented AND reported through onError', () => {
    const onError: Error[] = [];
    const { cap, strat } = strategy({ onError: (e) => onError.push(e) });
    for (let i = 0; i < 40; i++) {
      strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, `r${i}`));
      strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, `r${i}`));
    }
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'r0' },
        'consumer-scope',
      ),
    );
    expect(unparented(cap.spans)[0]?.attributes['agentfootprint.eval.unparented']).toBe(
      'run-forgotten',
    );
    expect(onError).toHaveLength(1);
    expect(onError[0]?.message).toContain("'r0'");
  });

  it('BOUNDARY: a score emitted in a live run naming a FORGOTTEN run is that run’s — never the emitting run’s', () => {
    const onError: Error[] = [];
    const { cap, strat } = strategy({ onError: (e) => onError.push(e) });
    for (let i = 0; i < 40; i++) {
      strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, `r${i}`));
      strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, `r${i}`));
    }
    openTurnWithTool(strat, 'run-live');
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'r0' },
        'run-live',
      ),
    );
    expect(cap.spans[rootIndexOf(cap.spans, 'run-live')]?.events).toEqual([]);
    expect(unparented(cap.spans)[0]?.attributes['agentfootprint.eval.unparented']).toBe(
      'run-forgotten',
    );
    expect(onError).toHaveLength(1);
  });

  it('BOUNDARY: a run sampling dropped takes its scores with it', () => {
    const { cap, strat } = strategy({ sampleRate: 0 });
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.eval.score', SCORE));
    closeTurn(strat);
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'run-1' },
        'consumer-scope',
      ),
    );
    expect(cap.spans).toEqual([]);
  });

  it('BOUNDARY: a score with no metricId is reported, never exported', () => {
    const onError: Error[] = [];
    const { cap, strat } = strategy({ onError: (e) => onError.push(e) });
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.eval.score', { value: 1, target: 'turn', targetRef: 'run-1' }),
    );
    expect(eventsNamed(cap.spans, 'gen_ai.evaluation.result')).toEqual([]);
    expect(onError).toHaveLength(1);
  });

  it('BOUNDARY: optional fields stay absent; a non-finite value is not a score', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.eval.score', {
        metricId: 'm',
        value: Number.NaN,
        target: 'turn',
        targetRef: 'run-1',
      }),
    );
    expect(eventsNamed(cap.spans, 'gen_ai.evaluation.result')[0]?.attributes).toEqual({
      'gen_ai.evaluation.name': 'm',
      'agentfootprint.eval.target': 'turn',
      'agentfootprint.eval.target_ref': 'run-1',
    });
  });

  it('BOUNDARY: explainability:false does not suppress it — it is a gen_ai.* signal', () => {
    const { cap, strat } = strategy({ explainability: false });
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.eval.score', SCORE));
    expect(eventsNamed(cap.spans, 'gen_ai.evaluation.result')).toHaveLength(1);
  });

  it('INTEGRATION (A5): a score naming another user’s run via agent.emit never lands on their trace', async () => {
    const { cap, strat } = strategy({ captureContent: true });
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    const runIds: string[] = [];
    agent.on('agentfootprint.agent.turn_start', (e) => {
      runIds.push(e.meta.runId);
    });
    const stop = agent.enable.observability({ strategy: strat });
    try {
      await agent.run({ message: 'A question' }, { sessionId: 'sess-A' });
      await agent.run({ message: 'B private question' }, { sessionId: 'sess-B' });
      agent.emit('agentfootprint.eval.score', {
        metricId: 'user_feedback',
        value: 0,
        target: 'run',
        targetRef: runIds[1]!,
        label: 'bad',
        explanation: 'A-TYPED-THIS: my card is 4111 1111 1111 1111',
      });
    } finally {
      stop();
    }
    const bRoot = rootIndexOf(cap.spans, runIds[1]!);
    expect(
      cap.spans.some((s) => s.parent === bRoot && s.name === 'agentfootprint.evaluation'),
    ).toBe(false);
    const [loose] = unparented(cap.spans);
    expect(loose?.events[0]?.attributes['agentfootprint.eval.target_ref']).toBe(runIds[1]);
  });
});

describe('2 · the score’s strings — vocabularies and content', () => {
  it('UNIT: the explanation is content — present only under captureContent; evidence never', () => {
    const { cap, strat } = strategy({ captureContent: true });
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.eval.score', SCORE));
    const [ev] = eventsNamed(cap.spans, 'gen_ai.evaluation.result');
    expect(ev?.attributes['gen_ai.evaluation.explanation']).toBe(SCORE.explanation);
    expect(allEmittedText(cap.spans)).not.toContain('EVIDENCE-SENTINEL');
  });

  it('BOUNDARY: an explanation over maxContentChars is omitted and its size stated, never cut', () => {
    const { cap, strat } = strategy({ captureContent: true, maxContentChars: 10 });
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.eval.score', SCORE));
    const [ev] = eventsNamed(cap.spans, 'gen_ai.evaluation.result');
    expect(ev?.attributes['gen_ai.evaluation.explanation']).toBeUndefined();
    expect(ev?.attributes['agentfootprint.eval.explanation.omitted_chars']).toBe(
      SCORE.explanation.length,
    );
  });

  it('SECURITY (A4): target and evaluator export only their vocabulary words; the label is capped', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.eval.score', {
        metricId: 'm',
        value: 0.1,
        target: `run ${'T'.repeat(50_000)}`,
        targetRef: 'run-1',
        evaluator: 'judge said: the user jane@example.com asked about her divorce',
        label: `fail ${'L'.repeat(1000)}`,
        explanation: 'EXPLANATION-SENTINEL',
      }),
    );
    const [ev] = eventsNamed(cap.spans, 'gen_ai.evaluation.result');
    expect(ev?.attributes['agentfootprint.eval.target']).toBeUndefined();
    expect(ev?.attributes['agentfootprint.eval.evaluator']).toBeUndefined();
    expect(String(ev?.attributes['gen_ai.evaluation.score.label']).length).toBeLessThanOrEqual(256);
    const text = allEmittedText(cap.spans);
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('EXPLANATION-SENTINEL');
  });
});

// ─── 3. the library's own structure ──────────────────────────────────

const ABSENT = {
  toolName: 'lookup',
  toolCallId: 'tc-1',
  iteration: 1,
  lookedFor: 'LOOKED-FOR-SENTINEL A-1',
  checked: [{ what: 'CHECKED-SENTINEL fabric A', why: 'WHY-SENTINEL' }],
  notChecked: [{ what: 'NOTCHECKED-SENTINEL fabric B' }, { what: 'fabric C' }],
  tryInstead: 'TRYINSTEAD-SENTINEL try the archive',
  tryInsteadTool: { tool: 'archive_lookup', why: 'TOOLWHY-SENTINEL' },
};

describe('3 · structure — absence and coverage: kinds and counts, never a sentence', () => {
  it('UNIT: tools.absent lands on the call’s own span; a suggestion naming a tool that RAN is named', () => {
    const { cap, strat } = strategy();
    // archive_lookup ran (and returned) earlier on this strategy — a held tool.
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-0'));
    strat.exportEvent(
      envelope(
        'agentfootprint.stream.tool_start',
        { toolName: 'archive_lookup', toolCallId: 'a0', args: {} },
        'run-0',
      ),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'a0', result: 'none' }, 'run-0'),
    );
    strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, 'run-0'));
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.tools.absent', ABSENT));
    const callSpan = opName(cap.spans, 'execute_tool').find(
      (s) => s.attributes['gen_ai.tool.call.id'] === 'tc-1',
    );
    const [ev] = callSpan?.events ?? [];
    expect(ev?.name).toBe('agentfootprint.tools.absent');
    expect(ev?.attributes).toEqual({
      'gen_ai.tool.name': 'lookup',
      'gen_ai.tool.call.id': 'tc-1',
      'agentfootprint.iteration.index': 1,
      'agentfootprint.coverage.checked.count': 1,
      'agentfootprint.coverage.not_checked.count': 2,
      'agentfootprint.coverage.cannot_cover.count': 0,
      'agentfootprint.coverage.try_instead.tool': 'archive_lookup',
    });
  });

  it('UNIT: an unregistered suggestion says only that it exists', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.tools.absent', ABSENT));
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.tools.absent');
    expect(ev?.attributes['agentfootprint.coverage.try_instead.tool']).toBeUndefined();
    expect(ev?.attributes['agentfootprint.coverage.try_instead.unregistered']).toBe(true);
  });

  it('UNIT: tools.coverage_declared carries the same three counts', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.tools.coverage_declared', {
        toolName: 'lookup',
        toolCallId: 'tc-1',
        iteration: 1,
        checked: [{ what: 'a' }, { what: 'b' }],
        cannotCover: [{ what: 'c', why: 'never' }],
      }),
    );
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.tools.coverage_declared');
    expect(ev?.attributes['agentfootprint.coverage.checked.count']).toBe(2);
    expect(ev?.attributes['agentfootprint.coverage.not_checked.count']).toBe(0);
    expect(ev?.attributes['agentfootprint.coverage.cannot_cover.count']).toBe(1);
  });

  it('BOUNDARY: a call whose span already closed falls back to the active span', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-1', result: 'ok' }),
    );
    strat.exportEvent(envelope('agentfootprint.tools.absent', ABSENT));
    expect(byName(cap.spans, 'iteration:1')[0]?.events.map((e) => e.name)).toEqual([
      'agentfootprint.tools.absent',
    ]);
  });

  it('SECURITY (A2): the event carries no declared sentence — content on or off, addEvent or fallback', () => {
    for (const withAddEvent of [true, false]) {
      for (const options of [{}, { captureContent: true, captureToolContent: true }] as Options[]) {
        const cap = makeCapture({ withAddEvent });
        const strat = otelObservability({
          serviceName: 'd',
          tracer: cap.tracer,
          _otelApi: cap.otelApi,
          ...options,
        });
        strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
        strat.exportEvent(envelope('agentfootprint.tools.absent', ABSENT));
        expect(allEmittedText(cap.spans)).not.toMatch(/SENTINEL/);
      }
    }
  });

  it('SECURITY (A10): a suggestion built from an argument never leaves — content off', async () => {
    const { cap, strat } = strategy();
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'find', description: 'd', inputSchema: { type: 'object' } },
          execute: (args: Record<string, unknown>) =>
            absent({
              what: `orders for ${String(args.customer)}`,
              checked: ['orders db'],
              tryInsteadTool: { tool: `archive lookup for ${String(args.customer)}` },
            }),
        }),
      [
        { toolCalls: [{ id: 't1', name: 'find', args: { customer: 'Jane Roe, acct 99887766' } }] },
        'none',
      ],
    );
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.tools.absent');
    expect(ev?.attributes['agentfootprint.coverage.try_instead.unregistered']).toBe(true);
    expect(allEmittedText(cap.spans)).not.toContain('99887766');
  });

  it('INTEGRATION: a real absent() naming a registered tool the agent has not RUN says only that it exists', async () => {
    const { cap, strat } = strategy();
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'find', description: 'd', inputSchema: { type: 'object' } },
            execute: () =>
              absent({
                what: 'FLOGI on PORT-SENTINEL',
                checked: ['fabric A'],
                notChecked: ['fabric B'],
                tryInsteadTool: { tool: 'archive_lookup' },
              }),
          })
          .tool({
            schema: { name: 'archive_lookup', description: 'd', inputSchema: { type: 'object' } },
            execute: () => 'none',
          }),
      [
        { toolCalls: [{ id: 'tc-1', name: 'find', args: { port: 'PORT-SENTINEL' } }] },
        'none found',
      ],
    );
    const tool = opName(cap.spans, 'execute_tool')[0]!;
    const ev = tool.events.find((e) => e.name === 'agentfootprint.tools.absent');
    expect(ev?.attributes['agentfootprint.coverage.checked.count']).toBe(1);
    expect(ev?.attributes['agentfootprint.coverage.not_checked.count']).toBe(1);
    // No roster rides the event (that would change every absent() event's
    // bytes); a name the adapter has not seen run is withheld, never guessed.
    expect(ev?.attributes['agentfootprint.coverage.try_instead.unregistered']).toBe(true);
    expect(allEmittedText(cap.spans)).not.toContain('SENTINEL');
  });
});

const EVIDENCE = {
  iteration: 2,
  posture: 'guard',
  candidates: 5,
  unsupported: [
    { value: 'VALUE-SENTINEL-4471', shape: 'number' },
    { value: 'ACCT-SENTINEL-9', shape: 'id' },
  ],
  action: 'revision-asked',
  afterRevision: false,
};

describe('3 · structure — the evidence verdict', () => {
  it('UNIT: default → the verdict and a COUNT of unsupported values, never the values', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.agent.evidence_checked', EVIDENCE));
    expect(eventsNamed(cap.spans, 'agentfootprint.agent.evidence_checked')[0]?.attributes).toEqual({
      'agentfootprint.evidence.action': 'revision-asked',
      'agentfootprint.evidence.posture': 'guard',
      'agentfootprint.evidence.candidates': 5,
      'agentfootprint.evidence.unsupported.count': 2,
      'agentfootprint.evidence.after_revision': false,
      'agentfootprint.iteration.index': 2,
    });
    expect(allEmittedText(cap.spans)).not.toMatch(/SENTINEL/);
  });

  it('UNIT: lookedUp rides as its own count, beside candidates — absent when the event has none', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.agent.evidence_checked', { ...EVIDENCE, lookedUp: 3 }),
    );
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.agent.evidence_checked');
    expect(ev?.attributes['agentfootprint.evidence.candidates']).toBe(5);
    expect(ev?.attributes['agentfootprint.evidence.looked_up']).toBe(3);
  });

  it('UNIT: captureContent → the values themselves, bounded', () => {
    const { cap, strat } = strategy({ captureContent: true });
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.agent.evidence_checked', { ...EVIDENCE, evidenceTruncated: true }),
    );
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.agent.evidence_checked');
    expect(ev?.attributes['agentfootprint.evidence.unsupported.values']).toEqual([
      'VALUE-SENTINEL-4471',
      'ACCT-SENTINEL-9',
    ]);
    expect(ev?.attributes['agentfootprint.evidence.truncated']).toBe(true);
  });
});

describe('3 · structure — findings standings: ids, enums, counts', () => {
  const standing = (toolCallId: string, s: string, extra: Record<string, unknown> = {}) =>
    envelope('agentfootprint.findings.standing', {
      toolCallId,
      toolName: 'lookup',
      iteration: 2,
      standing: s,
      declaredOn: 'tool-call',
      assertionCount: 1,
      ...extra,
    });

  it('UNIT: one span event per standing row, with the result’s id', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(standing('tc-0', 'ruled-out', { conflictKeys: ['k1', 'k2'], agrees: false }));
    expect(eventsNamed(cap.spans, 'agentfootprint.findings.standing')[0]?.attributes).toEqual({
      'agentfootprint.findings.standing': 'ruled-out',
      'gen_ai.tool.call.id': 'tc-0',
      'gen_ai.tool.name': 'lookup',
      'agentfootprint.findings.declared_on': 'tool-call',
      'agentfootprint.findings.assertion_count': 1,
      'agentfootprint.findings.conflict_count': 2,
      'agentfootprint.findings.agrees': false,
      'agentfootprint.iteration.index': 2,
    });
  });

  it('UNIT: an unknown id exports the flag only — the id is text the model wrote', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      standing('MODEL-WROTE-THIS', 'open', { unknownId: true, toolName: undefined }),
    );
    const [ev] = eventsNamed(cap.spans, 'agentfootprint.findings.standing');
    expect(ev?.attributes['agentfootprint.findings.unknown_id']).toBe(true);
    expect(ev?.attributes['gen_ai.tool.call.id']).toBeUndefined();
    expect(allEmittedText(cap.spans)).not.toContain('MODEL-WROTE-THIS');
  });

  it('UNIT: the turn’s close puts a count per standing on the agent span', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(standing('a', 'fact'));
    strat.exportEvent(standing('b', 'fact'));
    strat.exportEvent(standing('c', 'noise', { assertionCount: 0 }));
    strat.exportEvent(standing('zz', 'open', { unknownId: true, toolName: undefined }));
    closeTurn(strat);
    const root = cap.spans[0]!;
    expect(root.attributes['agentfootprint.findings.fact.count']).toBe(2);
    expect(root.attributes['agentfootprint.findings.open.count']).toBe(1);
    expect(root.attributes['agentfootprint.findings.noise.count']).toBe(1);
    expect(root.attributes['agentfootprint.findings.ruled_out.count']).toBe(0);
  });

  it('BOUNDARY: a turn with no standings gets no count keys', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    expect(
      Object.keys(cap.spans[0]!.attributes).some((k) => k.startsWith('agentfootprint.findings')),
    ).toBe(false);
  });

  it('SECURITY (A1): a model-written id never leaves — a real .findings() run, content off and on', async () => {
    const SECRET = 'USER-SSN-123-45-6789 jane@example.com';
    for (const options of [{}, { captureContent: true, captureToolContent: true }] as Options[]) {
      const { cap, strat } = strategy(options);
      await realRun(strat, (b) => b.tool(look).findings(), [
        {
          toolCalls: [{ id: 'x1', name: 'look', args: { q: 'a', _findings: { basis: 'direct' } } }],
        },
        {
          toolCalls: [
            {
              id: 'x2',
              name: 'look',
              args: {
                q: 'b',
                _findings: {
                  basis: 'direct',
                  previous: [
                    { toolCallId: SECRET, standing: 'fact' },
                    { toolCallId: 'Z'.repeat(100_000), standing: 'noise' },
                  ],
                },
              },
            },
          ],
        },
        'done',
      ]);
      const text = allEmittedText(cap.spans);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('Z'.repeat(300));
      expect(eventsNamed(cap.spans, 'agentfootprint.findings.standing').length).toBeGreaterThan(0);
    }
  });

  it('SECURITY (A1b/A1c): a flood of standing rows cannot push the span’s earlier record off the wire', async () => {
    const { cap, strat } = strategy();
    const previous = Array.from({ length: 300 }, (_, i) => ({
      toolCallId: `bogus-${i}`,
      standing: 'noise',
    }));
    await realRun(strat, (b) => b.tool(look).findings(), [
      { toolCalls: [{ id: 'x1', name: 'look', args: { q: 'a', _findings: { basis: 'direct' } } }] },
      {
        toolCalls: [
          { id: 'x2', name: 'look', args: { q: 'b', _findings: { basis: 'direct', previous } } },
        ],
      },
      'done',
    ]);
    const standings = eventsNamed(cap.spans, 'agentfootprint.findings.standing');
    expect(standings).toHaveLength(32);
    const root = opName(cap.spans, 'invoke_agent')[0]!;
    const [overflow] = root.events.filter(
      (e) => e.name === 'agentfootprint.findings.standing_overflow',
    );
    expect(overflow?.attributes['agentfootprint.findings.standing_events_omitted']).toBe(268);
    expect(root.attributes['agentfootprint.findings.noise.count']).toBe(300);
    // Under a real SDK's 128-events-per-span limit every span now keeps its
    // own decisions: no span carries more than the cap plus its own record.
    for (const span of cap.spans) expect(span.events.length).toBeLessThanOrEqual(64);
    expect(
      eventsNamed(cap.spans, 'agentfootprint.agent.route_decided').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('SECURITY (H6): the model’s findings lines never ride the wire, content on', async () => {
    const { cap, strat } = strategy({ captureContent: true, captureToolContent: true });
    await realRun(strat, (b) => b.tool(look).findings(), [
      {
        toolCalls: [
          {
            id: 'x1',
            name: 'look',
            args: {
              q: 'a',
              _findings: { basis: 'direct', proposition: 'PROP-SENT', predicts: 'PRED-SENT' },
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'x2',
            name: 'look',
            args: {
              q: 'b',
              _findings: {
                basis: 'direct',
                previous: [
                  {
                    toolCallId: 'x1',
                    standing: 'fact',
                    line: 'LINE-SENT',
                    settles: 'SETTLES-SENT',
                    assertions: [
                      {
                        subject: { kind: 'k', id: 'SUBJ-SENT' },
                        predicate: 'PRED2-SENT',
                        value: 'VAL-SENT',
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
      'done',
    ]);
    expect(allEmittedText(cap.spans).match(/[A-Z0-9]+-SENT/g) ?? []).toEqual([]);
  });
});

const DISPOSITION = {
  posture: 'observe',
  workExisted: true,
  rows: [
    {
      check: 'invariant-violation',
      seam: 'wire',
      checked: 2,
      findings: 1,
      notApplicable: 0,
      unreachable: 0,
      synthetic: 0,
    },
    {
      check: 'unsupported-argument',
      seam: 'choice',
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 3,
      synthetic: 1,
    },
    {
      check: 'dangling-reference',
      seam: 'compose',
      checked: 0,
      findings: 0,
      notApplicable: 0,
      unreachable: 0,
      synthetic: 0,
    },
  ],
};
const HEALTHY = {
  posture: 'observe',
  workExisted: true,
  rows: [
    {
      check: 'invariant-violation',
      seam: 'wire',
      checked: 2,
      findings: 0,
      notApplicable: 0,
      unreachable: 0,
      synthetic: 0,
    },
    {
      check: 'unsupported-argument',
      seam: 'choice',
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 0,
      synthetic: 0,
    },
  ],
};

describe('3 · structure — the checker accounting (integrity.disposition)', () => {
  it('UNIT: a healthy accounting exports nothing by default', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', HEALTHY));
    expect(byName(cap.spans, 'agentfootprint.integrity.disposition')).toEqual([]);
  });

  it('UNIT: findings or wiring rot → a span under the turn with ONLY the actionable rows', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION));
    const [span] = byName(cap.spans, 'agentfootprint.integrity.disposition');
    expect(span?.parent).toBe(0);
    expect(span?.ended).toBe(true);
    expect(span?.attributes).toEqual({
      'agentfootprint.integrity.posture': 'observe',
      'agentfootprint.integrity.work_existed': true,
      'agentfootprint.integrity.checked': 2,
      'agentfootprint.integrity.findings': 1,
      'agentfootprint.integrity.not_applicable': 1,
      'agentfootprint.integrity.unreachable': 3,
    });
    // invariant-violation (a finding) and dangling-reference (filed nothing
    // while work existed); unsupported-argument filed dispositions — healthy.
    expect(span?.events.map((e) => e.attributes['agentfootprint.integrity.check.name'])).toEqual([
      'invariant-violation',
      'dangling-reference',
    ]);
    expect(span?.events[0]?.attributes).toEqual({
      'agentfootprint.integrity.check.name': 'invariant-violation',
      'agentfootprint.integrity.check.seam': 'wire',
      'agentfootprint.integrity.check.checked': 2,
      'agentfootprint.integrity.check.findings': 1,
      'agentfootprint.integrity.check.not_applicable': 0,
      'agentfootprint.integrity.check.unreachable': 0,
      'agentfootprint.integrity.check.synthetic': 0,
    });
  });

  it('BOUNDARY: a check that filed nothing on a run with NO work is quiet, not rot', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.exportEvent(
      envelope('agentfootprint.integrity.disposition', {
        ...DISPOSITION,
        workExisted: false,
        rows: [DISPOSITION.rows[2]],
      }),
    );
    expect(byName(cap.spans, 'agentfootprint.integrity.disposition')).toEqual([]);
  });

  it("UNIT: checkAccounting: 'all' → every row, even on a healthy run", () => {
    const { cap, strat } = strategy({ checkAccounting: 'all' });
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', HEALTHY));
    const [span] = byName(cap.spans, 'agentfootprint.integrity.disposition');
    expect(span?.events.map((e) => e.name)).toEqual([
      'agentfootprint.integrity.check',
      'agentfootprint.integrity.check',
    ]);
  });

  it('BOUNDARY: a paused leg (turn still open) → the same span, under the still-open root', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION));
    const [span] = byName(cap.spans, 'agentfootprint.integrity.disposition');
    expect(span?.parent).toBe(0);
    expect(span?.ended).toBe(true);
  });

  it('BOUNDARY: after error.fatal the turn is still joinable', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.error.fatal', { stage: 's' }));
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION));
    expect(byName(cap.spans, 'agentfootprint.integrity.disposition')).toHaveLength(1);
  });

  it('BOUNDARY: an unknown run → nothing', () => {
    const { cap, strat } = strategy();
    strat.exportEvent(
      envelope('agentfootprint.integrity.disposition', DISPOSITION, 'never-traced'),
    );
    expect(cap.spans).toEqual([]);
  });

  it('BOUNDARY: the closed-turn window is bounded — the oldest run is forgotten', () => {
    const { cap, strat } = strategy();
    for (let i = 0; i < 40; i++) {
      strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, `r${i}`));
      strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, `r${i}`));
    }
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION, 'r0'));
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION, 'r39'));
    const spans = byName(cap.spans, 'agentfootprint.integrity.disposition');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.parent).toBe(rootIndexOf(cap.spans, 'r39'));
  });

  // After stop() the strategy ignores every event, so this pins the outcome a
  // consumer sees; `closedTurns.clear()` in stop() is what frees the spans.
  it('BOUNDARY: after stop() a late event lands nowhere, closed turns included', () => {
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    closeTurn(strat);
    strat.stop();
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION));
    expect(byName(cap.spans, 'agentfootprint.integrity.disposition')).toEqual([]);
  });

  it('INTEGRATION: a default real run is healthy — no accounting span (the byte-identity pin holds it)', async () => {
    const { cap, strat } = strategy();
    await realRun(strat, (b) => b, ['ok']);
    expect(byName(cap.spans, 'agentfootprint.integrity.disposition')).toEqual([]);
    expect(cap.spans.every((s) => s.ended)).toBe(true);
  });

  it("INTEGRATION: checkAccounting: 'all' on a real run → one event per registered check", async () => {
    const { cap, strat } = strategy({ checkAccounting: 'all' });
    await realRun(strat, (b) => b, ['ok']);
    const root = opName(cap.spans, 'invoke_agent')[0]!;
    const [span] = byName(cap.spans, 'agentfootprint.integrity.disposition');
    expect(span?.parent).toBe(cap.spans.indexOf(root));
    expect(span?.events.length).toBeGreaterThan(0);
    expect(span?.events.every((e) => e.name === 'agentfootprint.integrity.check')).toBe(true);
  });
});

describe('3 · structure — the explainability switch', () => {
  it('BOUNDARY: explainability:false emits none of the structure events', () => {
    const { cap, strat } = strategy({ explainability: false, checkAccounting: 'all' });
    openTurnWithTool(strat);
    strat.exportEvent(envelope('agentfootprint.tools.absent', ABSENT));
    strat.exportEvent(envelope('agentfootprint.agent.evidence_checked', EVIDENCE));
    strat.exportEvent(
      envelope('agentfootprint.findings.standing', {
        toolCallId: 'a',
        iteration: 1,
        standing: 'fact',
        declaredOn: 'answer',
        assertionCount: 0,
      }),
    );
    closeTurn(strat);
    strat.exportEvent(envelope('agentfootprint.integrity.disposition', DISPOSITION));
    const text = allEmittedText(cap.spans);
    expect(text).not.toContain('agentfootprint.tools.absent');
    expect(text).not.toContain('agentfootprint.evidence');
    expect(text).not.toContain('agentfootprint.findings');
    expect(text).not.toContain('agentfootprint.integrity');
  });
});

// ─── 4. tool arguments and results ───────────────────────────────────

describe('4 · gen_ai.tool.call.arguments / .result — captureToolContent only', () => {
  function oneCall(options: Options, result: unknown, extraEnd: Record<string, unknown> = {}) {
    const { cap, strat } = strategy(options);
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-1', result, ...extraEnd }),
    );
    return opName(cap.spans, 'execute_tool')[0]!;
  }
  const on = { captureToolContent: true };

  it('UNIT: default → neither (key names and result type only, as before)', () => {
    const tool = oneCall({}, { balance: 1 });
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(tool.attributes['agentfootprint.tool.args.keys']).toEqual(['id']);
  });

  it('UNIT: captureContent alone does NOT export tool I/O — its own switch', () => {
    const tool = oneCall({ captureContent: true }, { balance: 1 });
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('UNIT: captureToolContent → both, as JSON strings (the spec’s span form)', () => {
    const tool = oneCall(on, { balance: 1 });
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBe('{"id":"A-1"}');
    expect(tool.attributes['gen_ai.tool.call.result']).toBe('{"balance":1}');
  });

  it('UNIT: a key a rule changed is withheld; the model’s view of the result wins', () => {
    const tool = oneCall(
      on,
      { ssn: '123-45-6789' },
      { changedArgKeys: ['id', 'apiKey'], modelResult: { ssn: '[ssn]' } },
    );
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBe(
      '{"id":"REDACTED","apiKey":"REDACTED"}',
    );
    expect(tool.attributes['gen_ai.tool.call.result']).toBe('{"ssn":"[ssn]"}');
    expect(JSON.stringify(tool.attributes)).not.toContain('123-45-6789');
  });

  it('BOUNDARY (object schema): text that IS a serialized object passes through as the spec attribute', () => {
    expect(oneCall(on, '{"rows":[1,2]}').attributes['gen_ai.tool.call.result']).toBe(
      '{"rows":[1,2]}',
    );
  });

  it('BOUNDARY (object schema): anything else rides the adapter’s own attribute — "123" is never 123', () => {
    const cases: Array<[unknown, string]> = [
      ['123', '123'],
      ['no rows', 'no rows'],
      ['[1,2]', '[1,2]'],
      [42, '42'],
      [[1, 2], '[1,2]'],
      [true, 'true'],
    ];
    for (const [value, exported] of cases) {
      const tool = oneCall(on, value);
      expect(tool.attributes['gen_ai.tool.call.result'], JSON.stringify(value)).toBeUndefined();
      expect(tool.attributes['agentfootprint.tool.result.content'], JSON.stringify(value)).toBe(
        exported,
      );
    }
    expect(typeof oneCall(on, '123').attributes['agentfootprint.tool.result.content']).toBe(
      'string',
    );
  });

  it('BOUNDARY: a failed call exports no content at all', () => {
    const tool = oneCall(on, 'boom', { error: true });
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(tool.attributes['agentfootprint.tool.result.content']).toBeUndefined();
    expect(tool.attributes['error.type']).toBe('_OTHER');
  });

  it('BOUNDARY: a call whose tool never ran exports neither', () => {
    const tool = oneCall(on, 'refused by policy', { notExecuted: true });
    expect(JSON.stringify(tool.attributes)).not.toMatch(/tool\.call\.(arguments|result)|\.content/);
  });

  it('BOUNDARY (ceiling): over maxContentChars the value is omitted and its size stated, never cut', () => {
    const tool = oneCall({ ...on, maxContentChars: 20 }, { rows: 'x'.repeat(100) });
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(tool.attributes['agentfootprint.tool.result.omitted_chars']).toBe(
      JSON.stringify({ rows: 'x'.repeat(100) }).length,
    );
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBe('{"id":"A-1"}');
  });

  it('BOUNDARY: undefined or unserializable values are omitted, never thrown', () => {
    expect(oneCall(on, undefined).attributes['gen_ai.tool.call.result']).toBeUndefined();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const tool = oneCall(on, cyclic);
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(tool.ended).toBe(true);
  });

  it('BOUNDARY: a never-dispatched call still opens no span', () => {
    const { cap, strat } = strategy(on);
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_start', {
        toolName: 'x',
        toolCallId: 'tc-s',
        args: { secret: 'S' },
        notDispatched: { reason: 'batch-settled' },
      }),
    );
    expect(opName(cap.spans, 'execute_tool')).toHaveLength(1);
  });

  it('INTEGRATION: a real run carries the call’s arguments and result', async () => {
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'lookup', description: 'd', inputSchema: { type: 'object' } },
          execute: () => ({ balance: 12 }),
        }),
      [{ toolCalls: [{ id: 'tc-1', name: 'lookup', args: { account: 'A-7' } }] }, 'done'],
    );
    const tool = opName(cap.spans, 'execute_tool')[0]!;
    expect(JSON.parse(tool.attributes['gen_ai.tool.call.arguments'] as string)).toEqual({
      account: 'A-7',
    });
    expect(JSON.parse(tool.attributes['gen_ai.tool.call.result'] as string)).toEqual({
      balance: 12,
    });
  });

  it('INTEGRATION: the default ceiling omits a 100 KB result', async () => {
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'dump', description: 'd', inputSchema: { type: 'object' } },
          execute: () => ({ pad: 'x'.repeat(100_000) }),
        }),
      [{ toolCalls: [{ id: 't1', name: 'dump', args: {} }] }, 'done'],
    );
    const tool = opName(cap.spans, 'execute_tool')[0]!;
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(tool.attributes['agentfootprint.tool.result.omitted_chars']).toBeGreaterThan(65_536);
  });
});

describe('4 · SECURITY — what leaves is what the tool ran with and the model read', () => {
  const toolSpan = (cap: Capture): CapturedSpan => opName(cap.spans, 'execute_tool')[0]!;
  const on = { captureToolContent: true } as Options;

  it('A6: an onToolResult scrub the model saw is the scrub the trace gets', async () => {
    const SSN = '123-45-6789';
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'patient', description: 'd', inputSchema: { type: 'object' } },
            execute: () => ({ name: 'Jane Roe', ssn: SSN }),
          })
          .toolMiddleware({
            name: 'scrub-ssn',
            onToolResult: (call) => {
              const text = JSON.stringify(call.result);
              const clean = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
              return clean === text ? allow() : allow(JSON.parse(clean), 'masked an SSN');
            },
          }),
      [{ toolCalls: [{ id: 't1', name: 'patient', args: { id: 'p-1' } }] }, 'done'],
    );
    expect(String(toolSpan(cap).attributes['gen_ai.tool.call.result'])).toContain('[ssn]');
    expect(allEmittedText(cap.spans)).not.toContain(SSN);
  });

  it('A6b: a result an after-tool rule DENIED exports the refusal the model read, never the record', async () => {
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'patient', description: 'd', inputSchema: { type: 'object' } },
            execute: () => ({ name: 'Jane Roe', ssn: '987-65-4321' }),
          })
          .toolMiddleware({
            name: 'hide-raw-pii',
            onToolResult: (call) =>
              /\d{3}-\d{2}-\d{4}/.test(JSON.stringify(call.result))
                ? deny('the record exists but its raw contents are not for the model')
                : allow(),
          }),
      [{ toolCalls: [{ id: 't1', name: 'patient', args: { id: 'p-1' } }] }, 'done'],
    );
    expect(toolSpan(cap).attributes['agentfootprint.tool.result.content']).toContain(
      'not for the model',
    );
    expect(allEmittedText(cap.spans)).not.toContain('987-65-4321');
  });

  it('A7: an onToolCall rewrite — the span carries what the tool ran with, not the proposal', async () => {
    let ranWith: unknown;
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'send', description: 'd', inputSchema: { type: 'object' } },
            execute: (args: unknown) => {
              ranWith = args;
              return 'sent';
            },
          })
          .toolMiddleware({
            name: 'strip-passwords',
            onToolCall: (call) => {
              const body = String((call.args as { body?: unknown }).body ?? '');
              const clean = body.replace(/password=\S+/g, 'password=[removed]');
              return clean === body
                ? allow()
                : allow({ ...call.args, body: clean }, 'stripped a password');
            },
          }),
      [
        {
          toolCalls: [
            { id: 't1', name: 'send', args: { to: 'ops', body: 'password=hunter2 please reset' } },
          ],
        },
        'done',
      ],
    );
    // The key the rule rewrote is withheld; the rest is the proposal.
    expect(JSON.parse(toolSpan(cap).attributes['gen_ai.tool.call.arguments'] as string)).toEqual({
      to: 'ops',
      body: 'REDACTED',
    });
    expect((ranWith as { body: string }).body).toBe('password=[removed] please reset');
    expect(allEmittedText(cap.spans)).not.toContain('hunter2');
  });

  it('A7b: a call a rule DENIED never ran — no arguments, no result on its span', async () => {
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'wire', description: 'd', inputSchema: { type: 'object' } },
            execute: () => 'moved',
          })
          .toolMiddleware({ name: 'no-wires', onToolCall: () => deny('wires need a ticket') }),
      [
        {
          toolCalls: [
            { id: 't1', name: 'wire', args: { iban: 'DE89370400440532013000', amount: 9999 } },
          ],
        },
        'done',
      ],
    );
    expect(allEmittedText(cap.spans)).not.toContain('DE89370400440532013000');
    expect(toolSpan(cap).attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('A15: flowchartAsTool({ redact }) governs BOTH halves — arguments and result read REDACTED', async () => {
    const SECRET = 'sk-live-USER-PASTED-KEY-777';
    const inner = flowChart<{ key: string; used: string }>(
      'Use the key',
      (scope) => {
        const args = scope.$getArgs<{ apiKey: string }>();
        scope.key = args.apiKey;
        scope.used = 'called';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'check_account',
      description: 'checks an account with the user key',
      flowchart: inner,
      redact: { keys: ['key', 'apiKey'] },
    });
    const { cap, strat } = strategy(on);
    await realRun(strat, (b) => b.tool(tool), [
      { toolCalls: [{ id: 'tc-1', name: 'check_account', args: { apiKey: SECRET } }] },
      'done',
    ]);
    const span = toolSpan(cap);
    expect(span.attributes['gen_ai.tool.call.arguments']).toBe('{"apiKey":"REDACTED"}');
    expect(String(span.attributes['gen_ai.tool.call.result'])).toContain('REDACTED');
    expect(allEmittedText(cap.spans)).not.toContain(SECRET);
  });

  it('A9: a built-in credential kind hides its secret — the tool content carries the kind only', async () => {
    const TOKEN = 'tok-LIVE-BEARER-abc123';
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'api', description: 'd', inputSchema: { type: 'object' } },
          execute: () => ({ builtIn: bearer(TOKEN) }),
        }),
      [{ toolCalls: [{ id: 't1', name: 'api', args: {} }] }, 'done'],
    );
    expect(toolSpan(cap).attributes['gen_ai.tool.call.result']).toBe(
      '{"builtIn":{"kind":"bearer"}}',
    );
    expect(allEmittedText(cap.spans)).not.toContain(TOKEN);
  });

  it('A13b: a result the cap cut is exported as what the model read — the marker that SAYS it was cut', async () => {
    const { cap, strat } = strategy(on);
    const provider = new MockProvider({
      replies: [{ toolCalls: [{ id: 't1', name: 'dump', args: {} }] }, 'done'],
    });
    const agent = Agent.create({ provider, model: 'mock', maxToolResultChars: 2000 } as never)
      .system('')
      .tool({
        schema: { name: 'dump', description: 'd', inputSchema: { type: 'object' } },
        execute: () => ({
          rows: Array.from({ length: 5000 }, (_, i) => ({ i, pad: 'x'.repeat(90) })),
        }),
      })
      .build();
    const stop = agent.enable.observability({ strategy: strat });
    try {
      await agent.run({ message: 'go' });
    } finally {
      stop();
    }
    // `maxToolResultChars` replaces the value with the library's own marker
    // object, which declares the cut — never a raw JSON head that reads as
    // the complete record.
    const exported = JSON.parse(String(toolSpan(cap).attributes['gen_ai.tool.call.result'])) as {
      truncated?: unknown;
    };
    expect(exported.truncated).toBe(true);
    expect(JSON.stringify(exported).length).toBeLessThan(5000);
  });

  it('the upstream redaction path still holds on the result', async () => {
    const SECRET = 'sk-live-OTEL-SECRET-BYTES';
    const inner = flowChart<{ apiKey: string; used: string }>(
      'Use the key',
      (scope) => {
        scope.apiKey = SECRET;
        scope.used = 'called';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'd',
      flowchart: inner,
      redact: { keys: ['apiKey'] },
    });
    const { cap, strat } = strategy(on);
    await realRun(strat, (b) => b.tool(tool), [
      { toolCalls: [{ id: 'tc-1', name: 'inner_chart', args: {} }] },
      'done',
    ]);
    expect(String(toolSpan(cap).attributes['gen_ai.tool.call.result'])).toContain('REDACTED');
    expect(allEmittedText(cap.spans)).not.toContain(SECRET);
  });
});

// ─── every string capped; the explanation nowhere when content is off ─

describe('SECURITY — every exported string outside the content switches is capped', () => {
  it('a long principal, tenant, model, label and ref never size an attribute', () => {
    const LONG = 'Q'.repeat(10_000);
    const { cap, strat } = strategy();
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-1', {
        principal: LONG,
        tenant: LONG,
      }),
    );
    strat.exportEvent(envelope('agentfootprint.agent.iteration_start', { iterIndex: 1 }));
    strat.exportEvent(
      envelope('agentfootprint.stream.llm_start', { iteration: 1, model: LONG, provider: LONG }),
    );
    strat.exportEvent(
      envelope('agentfootprint.eval.score', {
        metricId: LONG,
        value: 1,
        target: 'turn',
        targetRef: LONG,
        label: LONG,
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.findings.standing', {
        toolCallId: LONG,
        toolName: LONG,
        iteration: 1,
        standing: 'fact',
        declaredOn: 'answer',
        assertionCount: 0,
      }),
    );
    const check = (attrs: Record<string, OtelAttributeValue>): void => {
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === 'string') expect(value.length, key).toBeLessThanOrEqual(256);
        if (Array.isArray(value)) expect(value.length, key).toBeLessThanOrEqual(21);
      }
    };
    for (const span of cap.spans) {
      check(span.attributes);
      for (const event of span.events) check(event.attributes);
    }
    expect(allEmittedText(cap.spans)).not.toContain('Q'.repeat(300));
  });
});

describe('SECURITY — an evaluation’s explanation appears NOWHERE when content capture is off', () => {
  it('neither the OTel spans nor the audit bundle carry it (A14)', async () => {
    const EXPL = 'EXPL-SENTINEL: the answer said the patient Jane Roe is HIV+';
    const { cap, strat } = strategy();
    const audit = auditExport();
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    let runId = '';
    agent.on('agentfootprint.agent.turn_start', (e) => {
      runId = e.meta.runId;
    });
    const stopOtel = agent.enable.observability({ strategy: strat });
    const stopAudit = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'hi' });
      agent.emit('agentfootprint.eval.score', {
        metricId: 'faithfulness',
        value: 0.2,
        target: 'run',
        targetRef: runId,
        label: 'fail',
        explanation: EXPL,
        evidence: { quoted: 'EVID-SENTINEL' },
      });
    } finally {
      stopOtel();
      stopAudit();
    }
    expect(eventsNamed(cap.spans, 'gen_ai.evaluation.result')).toHaveLength(1);
    expect(allEmittedText(cap.spans)).not.toContain('EXPL-SENTINEL');
    const bundle = JSON.stringify(audit.bundle());
    expect(bundle).toContain('agentfootprint.eval.score');
    expect(bundle).not.toContain('EXPL-SENTINEL');
    expect(bundle).not.toContain('EVID-SENTINEL');
    expect(bundle).toContain(`[${EXPL.length} chars]`);
  });

  it('the audit bundle bounds the new tool_end content fields the same way as result and args', async () => {
    const audit = auditExport();
    const agent = Agent.create({
      provider: new MockProvider({
        replies: [
          { toolCalls: [{ id: 't1', name: 'send', args: { body: 'password=hunter2' } }] },
          'done',
        ],
      }),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'send', description: 'd', inputSchema: { type: 'object' } },
        execute: () => ({ ssn: '123-45-6789' }),
      })
      .toolMiddleware({
        name: 'both',
        onToolCall: (call) => allow({ ...call.args, body: 'CHAINED-ARGS-SENTINEL' }, 'rewrote'),
        onToolResult: () => allow({ ssn: 'MODEL-RESULT-SENTINEL' }, 'masked'),
      })
      .build();
    const stop = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'go' });
    } finally {
      stop();
    }
    const bundle = JSON.stringify(audit.bundle());
    expect(bundle).not.toContain('CHAINED-ARGS-SENTINEL');
    expect(bundle).not.toContain('MODEL-RESULT-SENTINEL');
    expect(bundle).not.toContain('123-45-6789');
  });
});

// ─── round 2 (otel-DEVIL.md / otel-REVIEW.md "Round 2"), inverted ──

describe('ROUND 2 — the closing re-check’s attacks, pinned closed', () => {
  const on = { captureToolContent: true } as Options;
  const toolSpan = (cap: Capture): CapturedSpan => opName(cap.spans, 'execute_tool')[0]!;

  it('R2-A: a tool that turns its arguments into request options in place exports the proposal, not the bearer', async () => {
    const TOKEN = 'tok-R2A-LIVE-BEARER';
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'fetch_orders', description: 'd', inputSchema: { type: 'object' } },
          execute: (args: Record<string, unknown>) => {
            Object.assign(args, {
              headers: bearer(TOKEN).toHeaders(),
              url: 'https://api.internal/orders',
            });
            return { orders: 2 };
          },
        }),
      [{ toolCalls: [{ id: 't1', name: 'fetch_orders', args: { customer: 'c-9' } }] }, 'done'],
    );
    expect(toolSpan(cap).attributes['gen_ai.tool.call.arguments']).toBe('{"customer":"c-9"}');
    expect(allEmittedText(cap.spans)).not.toContain(TOKEN);
  });

  it('R2-B: a value an onToolCall ADDED is withheld on OTel too — the key named, never its value', async () => {
    const SERVER_KEY = 'svc-R2B-INTERNAL-API-KEY';
    const { cap, strat } = strategy(on);
    await realRun(
      strat,
      (b) =>
        b
          .tool({
            schema: { name: 'crm', description: 'd', inputSchema: { type: 'object' } },
            execute: () => 'ok',
          })
          .toolMiddleware({
            name: 'inject',
            onToolCall: (call) => allow({ ...call.args, apiKey: SERVER_KEY }, 'scoped'),
          }),
      [{ toolCalls: [{ id: 't1', name: 'crm', args: { q: 'acme' } }] }, 'done'],
    );
    expect(toolSpan(cap).attributes['gen_ai.tool.call.arguments']).toBe(
      '{"q":"acme","apiKey":"REDACTED"}',
    );
    expect(allEmittedText(cap.spans)).not.toContain(SERVER_KEY);
  });

  it('R2-E: a model-written tool name cannot size a span NAME', () => {
    const LONG = `nope ${'N'.repeat(74_000)}`;
    const { cap, strat } = strategy();
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_start', {
        toolName: LONG,
        toolCallId: 'tc-2',
        args: {},
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'tc-2', result: 'x', error: true }),
    );
    for (const span of cap.spans)
      expect(span.name.length, span.name.slice(0, 20)).toBeLessThanOrEqual(70);
    const long = cap.spans.find((s) => s.name.startsWith('tool:nope'))!;
    expect(long.name.endsWith('…')).toBe(true);
    expect(long.ended).toBe(true);
  });

  it('R2-E (genAiSpanNames): a caller-sized model name is capped in the chat span name', () => {
    const { cap, strat } = strategy({ genAiSpanNames: true });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.stream.llm_start', { iteration: 1, model: 'M'.repeat(5000) }),
    );
    expect(cap.spans[1]?.name.length).toBeLessThanOrEqual(70);
  });

  it('R2-K2: an unparented score span starts a NEW trace (SpanOptions.root), never inside the active span', () => {
    const { cap, strat } = strategy();
    strat.exportEvent(
      envelope(
        'agentfootprint.eval.score',
        { ...SCORE, target: 'run', targetRef: 'nope' },
        'consumer-scope',
      ),
    );
    const [loose] = unparented(cap.spans);
    expect(loose?.root).toBe(true);
    // A turn's own root is NOT forced to a new trace — it may sit under an
    // HTTP request span, as it always could.
    openTurnWithTool(strat);
    expect(opName(cap.spans, 'invoke_agent')[0]?.root).toBeUndefined();
  });

  it('R2-H: the prompt and answer have the content ceiling too — omitted with their size, never cut', () => {
    const { cap, strat } = strategy({ captureContent: true, maxContentChars: 100 });
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'P'.repeat(5000) }),
    );
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_end', { turnIndex: 0, finalContent: 'short answer' }),
    );
    const root = cap.spans[0]!;
    expect(root.attributes['gen_ai.task.input']).toBeUndefined();
    expect(root.attributes['agentfootprint.task.input.omitted_chars']).toBe(5000);
    expect(root.attributes['gen_ai.task.output']).toBe('short answer');
  });

  it('R2-G: a capped value never ends in a lone surrogate', () => {
    const { cap, strat } = strategy();
    const value = `${'a'.repeat(254)}😀${'b'.repeat(10)}`; // the pair straddles the cut
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-1', { principal: value }),
    );
    const capped = String(cap.spans[0]?.attributes['agentfootprint.principal.id']);
    expect(capped.endsWith('…')).toBe(true);
    const beforeMarker = capped.charCodeAt(capped.length - 2);
    expect(beforeMarker >= 0xd800 && beforeMarker <= 0xdbff).toBe(false);
  });

  it('R2-S6: a code runner’s generated program never leaves — hand-fed order: code_run before tool_end', () => {
    const { cap, strat } = strategy(on);
    openTurnWithTool(strat);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_start', {
        toolName: 'run_code',
        toolCallId: 'c1',
        args: { code: 'print(SECRET_DATA_ROW)' },
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.tools.code_run', {
        tool: 'run_code',
        language: 'python',
        stagedInputs: 0,
        outputChars: 3,
        truncated: false,
        ok: true,
        shapeHash: 'h',
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', { toolCallId: 'c1', result: 'ran' }),
    );
    const span = cap.spans.find((s) => s.name === 'tool:run_code')!;
    expect(span.attributes['agentfootprint.tool.args.withheld']).toBe('code-runner');
    expect(allEmittedText(cap.spans)).not.toContain('SECRET_DATA_ROW');
  });

  it('R2-S6: a REAL codeRunnerTool under captureToolContent (and the AgentCore preset) exports no code', async () => {
    const runner: CodeRunner = {
      id: 'test-runner',
      start: async () => ({
        id: 'session-1',
        execute: async () => ({ ok: true, stdout: 'ran', stderr: '', artifacts: [] }),
        stop: async () => undefined,
      }),
    };
    for (const make of [
      () => strategy(on),
      () => {
        const cap = makeCapture();
        return {
          cap,
          strat: agentCoreEvaluationSpans({
            serviceName: 's',
            tracer: cap.tracer,
            _otelApi: cap.otelApi,
          }),
        };
      },
    ]) {
      const { cap, strat } = make();
      await realRun(strat, (b) => b.tool(codeRunnerTool({ runner })), [
        {
          toolCalls: [{ id: 't1', name: 'run_code', args: { code: 'print("PROGRAM-SENTINEL")' } }],
        },
        'done',
      ]);
      expect(allEmittedText(cap.spans)).not.toContain('PROGRAM-SENTINEL');
      expect(toolSpan(cap).attributes['agentfootprint.tool.args.withheld']).toBe('code-runner');
    }
  });
});

// ─── round 3 (otel-DEVIL.md "Round 3"), inverted ─────────────────────

describe('ROUND 3 — detached delivery carries a snapshot; the code-runner mark follows the called name', () => {
  const on = { captureToolContent: true } as Options;
  const DRIVERS = [
    ['microtaskBatchDriver', microtaskBatchDriver],
    ['setImmediateDriver', setImmediateDriver],
  ] as const;

  async function detachedRun(
    strat: Strategy,
    driver: (typeof DRIVERS)[number][1],
    build: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
    replies: ConstructorParameters<typeof MockProvider>[0] extends { replies?: infer R }
      ? R
      : never,
  ): Promise<void> {
    const provider = new MockProvider({ replies });
    const agent = build(Agent.create({ provider, model: 'mock' }).system('')).build();
    const handle = agent.enable.observability({
      strategy: strat,
      detach: { driver, mode: 'forget' },
    });
    try {
      await agent.run({ message: 'go' });
      await handle.flush();
    } finally {
      handle();
    }
  }

  for (const [label, driver] of DRIVERS) {
    it(`R3-B1 (${label}): a tool that writes a bearer header into its arguments exports the proposal, not the header`, async () => {
      const TOKEN = `tok-R3-DETACH-${label}`;
      const { cap, strat } = strategy(on);
      await detachedRun(
        strat,
        driver,
        (b) =>
          b.tool({
            schema: { name: 'fetch_orders', description: 'd', inputSchema: { type: 'object' } },
            execute: (args: Record<string, unknown>) => {
              Object.assign(args, { headers: bearer(TOKEN).toHeaders() });
              return { orders: 2 };
            },
          }),
        [{ toolCalls: [{ id: 't1', name: 'fetch_orders', args: { c: 'x' } }] }, 'done'],
      );
      const span = opName(cap.spans, 'execute_tool')[0]!;
      expect(span.attributes['gen_ai.tool.call.arguments']).toBe('{"c":"x"}');
      expect(allEmittedText(cap.spans)).not.toContain(TOKEN);
    });

    it(`R3-B1 (${label}): a result mutated after its tool_end exports what the model read then`, async () => {
      const { cap, strat } = strategy(on);
      const shared = { rows: ['public'] as string[] };
      await detachedRun(
        strat,
        driver,
        (b) =>
          b
            .tool({
              schema: { name: 'first', description: 'd', inputSchema: { type: 'object' } },
              execute: () => shared,
            })
            .tool({
              schema: { name: 'second', description: 'd', inputSchema: { type: 'object' } },
              execute: () => {
                shared.rows.push('LATER-SECRET');
                return 'ok';
              },
            }),
        [
          { toolCalls: [{ id: 't1', name: 'first', args: {} }] },
          { toolCalls: [{ id: 't2', name: 'second', args: {} }] },
          'done',
        ],
      );
      const first = opName(cap.spans, 'execute_tool').find(
        (s) => s.attributes['gen_ai.tool.name'] === 'first',
      )!;
      expect(first.attributes['gen_ai.tool.call.result']).toBe('{"rows":["public"]}');
      expect(allEmittedText(cap.spans)).not.toContain('LATER-SECRET');
    });
  }

  it('an uncloneable event is delivered DEGRADED — never the live reference — and reported once per type', async () => {
    const delivered: Array<Record<string, unknown>> = [];
    const errors: Error[] = [];
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    const handle = agent.enable.observability({
      strategy: {
        name: 'recording',
        capabilities: { events: true },
        exportEvent: (e) => {
          if (e.type === 'agentfootprint.eval.score')
            delivered.push(e.payload as Record<string, unknown>);
        },
        _onError: (err: Error) => errors.push(err),
      },
      detach: { driver: microtaskBatchDriver, mode: 'forget' },
    });
    try {
      const live = { note: 'kept' };
      for (let i = 0; i < 2; i++)
        agent.emit('agentfootprint.eval.score', {
          metricId: 'm',
          value: 1,
          target: 'run',
          targetRef: 'r',
          evidence: live,
          scorer: () => 'a function',
        });
      live.note = 'MUTATED-AFTER';
      await handle.flush();
    } finally {
      handle();
    }
    expect(delivered).toHaveLength(2);
    expect(delivered[0]?.scorer).toBe('[not cloneable]');
    expect(delivered[0]?.evidence).toEqual({ note: 'kept' });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('agentfootprint.eval.score');
  });

  it('degradation is at the LEAF: a tool result with one method keeps its data on a detached serializing sink, as it does in sync', async () => {
    const result = () => ({
      id: 7,
      total: 42,
      fmt() {
        return 'x';
      },
      nested: { ok: 'kept', fn: () => 1 },
      rows: [1, () => 2, { deep: 'kept too' }],
    });
    const run = async (detached: boolean): Promise<Record<string, unknown>> => {
      const dir = mkdtempSync(join(tmpdir(), 'af-otel-r4-'));
      const path = join(dir, 'e.ndjson');
      const file = fileObservability({ path });
      const agent = Agent.create({
        provider: new MockProvider({
          replies: [{ toolCalls: [{ id: 't1', name: 'lookup', args: {} }] }, 'done'],
        }),
        model: 'mock',
      })
        .system('')
        .tool({
          schema: { name: 'lookup', description: 'd', inputSchema: { type: 'object' } },
          execute: result,
        })
        .build();
      const handle = agent.enable.observability({
        strategy: file,
        ...(detached && { detach: { driver: microtaskBatchDriver, mode: 'forget' as const } }),
      });
      try {
        await agent.run({ message: 'go' });
        await handle.flush();
      } finally {
        handle();
      }
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .find((l) => l.includes('agentfootprint.stream.tool_end'))!;
      return (JSON.parse(line) as { payload: { result: Record<string, unknown> } }).payload.result;
    };
    const sync = await run(false);
    const detached = await run(true);
    // Sync drops the functions (JSON.stringify); detached marks them — the
    // DATA is the same on both paths.
    expect(sync).toEqual({
      id: 7,
      total: 42,
      nested: { ok: 'kept' },
      rows: [1, null, { deep: 'kept too' }],
    });
    expect(detached).toEqual({
      id: 7,
      total: 42,
      fmt: '[not cloneable]',
      nested: { ok: 'kept', fn: '[not cloneable]' },
      rows: [1, '[not cloneable]', { deep: 'kept too' }],
    });
  });

  it('R3-S1: a codeRunnerTool re-exposed under another schema name still exports no program', async () => {
    const runner: CodeRunner = {
      id: 'r',
      start: async () => ({
        id: 's',
        execute: async () => ({ ok: true, stdout: 'out', stderr: '', artifacts: [] }),
        stop: async () => undefined,
      }),
    };
    const base = codeRunnerTool({ runner });
    const renamed = { ...base, schema: { ...base.schema, name: 'py_sandbox' } };
    const CODE = "print('SSN 123-45-6789 from row 7')";
    const { cap, strat } = strategy(on);
    const agent = await realRun(strat, (b) => b.tool(renamed), [
      { toolCalls: [{ id: 'c1', name: 'py_sandbox', args: { code: CODE } }] },
      'done',
    ]);
    void agent;
    const span = opName(cap.spans, 'execute_tool')[0]!;
    expect(span.attributes['agentfootprint.tool.args.withheld']).toBe('code-runner');
    expect(allEmittedText(cap.spans)).not.toContain('123-45-6789');
  });

  it('R3-S1: tools.code_run names the tool the model CALLED', async () => {
    const runner: CodeRunner = {
      id: 'r',
      start: async () => ({
        id: 's',
        execute: async () => ({ ok: true, stdout: 'out', stderr: '', artifacts: [] }),
        stop: async () => undefined,
      }),
    };
    const base = codeRunnerTool({ runner });
    const agent = Agent.create({
      provider: new MockProvider({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'py_sandbox', args: { code: 'print(1)' } }] },
          'done',
        ],
      }),
      model: 'mock',
    })
      .system('')
      .tool({ ...base, schema: { ...base.schema, name: 'py_sandbox' } })
      .build();
    const names: string[] = [];
    agent.on('agentfootprint.tools.code_run', (e) => names.push(e.payload.tool));
    await agent.run({ message: 'go' });
    expect(names).toEqual(['py_sandbox']);
  });
});

// ─── the AgentCore preset ────────────────────────────────────────────

describe('agentCoreEvaluationSpans — the one preset that turns tool content on', () => {
  async function presetRun(options: Partial<OtelObservabilityOptions> = {}): Promise<CapturedSpan> {
    const cap = makeCapture();
    const strat = agentCoreEvaluationSpans({
      serviceName: 'svc',
      tracer: cap.tracer,
      _otelApi: cap.otelApi,
      ...options,
    });
    await realRun(
      strat,
      (b) =>
        b.tool({
          schema: { name: 'lookup', description: 'd', inputSchema: { type: 'object' } },
          execute: () => ({ balance: 1 }),
        }),
      [{ toolCalls: [{ id: 't1', name: 'lookup', args: { account: 'A' } }] }, 'done'],
    );
    return opName(cap.spans, 'execute_tool')[0]!;
  }

  it('exports the call’s arguments by default — its scorers read them', async () => {
    expect((await presetRun()).attributes['gen_ai.tool.call.arguments']).toBe('{"account":"A"}');
  });

  it('captureToolContent: false opts back out', async () => {
    expect(
      (await presetRun({ captureToolContent: false })).attributes['gen_ai.tool.call.arguments'],
    ).toBeUndefined();
  });
});
