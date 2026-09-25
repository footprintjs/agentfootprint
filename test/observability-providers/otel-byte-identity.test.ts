/**
 * BYTE-IDENTITY — `otelObservability` with no content switch on emits exactly
 * the spans it emitted before the evaluation export, for every trace that
 * carries none of the events that export began to map.
 *
 * The evaluation export (CHANGELOG, first under [Unreleased]) made the OTel
 * export carry what evaluation tools read: the conversation id,
 * `gen_ai.evaluation.result`, the library's own structure (absence, coverage,
 * evidence verdict, integrity disposition, findings standing) and — under
 * `captureToolContent` only — tool arguments and results. Each is ADDITIVE.
 * The references under `./reference/` were generated on the 9.114.1 tree
 * (2fee142c) BEFORE any source edit of that change, by this same file in
 * update mode:
 *
 *   AF_OTEL_REFERENCE=update npx vitest run test/observability-providers/otel-byte-identity.test.ts
 *
 * The six originals were generated in the worktree before its first edit; the
 * two added in the first review round (`otel-session`, `otel-content`) were
 * generated on a scratch copy whose `src` is `git archive 2fee142c` — the
 * base tree itself, never the changed one.
 *
 * What a reference holds: every span in start order with its PARENT index
 * (the capture tracer records parent wiring through `_otelApi`), its name, its
 * attributes in insertion order, its span events, its status and whether it
 * ended. Compared as TEXT, not as parsed objects, so a reordered attribute is
 * a failure too — an exporter serializes in insertion order.
 *
 * NO span is filtered out. The real-agent scenario is a DEFAULT agent run,
 * whose checker accounting (`integrity.disposition`, filed after `turn_end`)
 * is healthy: under the default `checkAccounting: 'actionable'` it exports
 * nothing, so the real run a user gets is pinned byte for byte.
 *
 * ONE stated delta: a session-bound trace (`otel-session`) now carries
 * `gen_ai.conversation.id` — the session id's SHA-256 — on its agent, chat
 * and tool spans. That scenario compares with that one attribute stripped,
 * and the test after the loop proves it is the ONLY thing that moved and
 * exactly where it landed. A session-bound trace is therefore NOT
 * byte-identical to 9.114.1, and the CHANGELOG says so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  otelObservability,
  type OtelObservabilityOptions,
} from '../../src/adapters/observability/otel.js';
import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { makeCapture, envelope, type CapturedSpan } from '../helpers/otelCapture.js';
import { sha256Hex } from '../../src/lib/time-travel/sha256.js';

// ─── the stream: every event the adapter mapped before the change ────

const RUN = 'run-pin';
const ACTOR = { principal: 'user-7', tenant: 'acme' };

/** One turn: two iterations, parallel tool calls ending out of order, a
 *  settled (never-dispatched) bracket, every explainability event, cost. */
const STREAM = [
  envelope('agentfootprint.agent.turn_start', { turnIndex: 3, userPrompt: 'q' }, RUN, ACTOR),
  envelope(
    'agentfootprint.context.evaluated',
    {
      routing: [
        {
          injectionId: 'billing',
          via: 'graph',
          label: 'billing skill',
          from: 'triage',
          path: [{ label: 'intent is billing', branch: 'yes' }],
          tools: ['lookup', 'refund'],
        },
      ],
    },
    RUN,
  ),
  envelope('agentfootprint.agent.iteration_start', { turnIndex: 3, iterIndex: 1 }, RUN),
  envelope(
    'agentfootprint.stream.llm_start',
    { iteration: 1, provider: 'anthropic', model: 'claude-x', temperature: 0.1 },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.llm_end',
    {
      iteration: 1,
      content: 'c',
      toolCallCount: 2,
      usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 },
      stopReason: 'tool_use',
      durationMs: 3,
      providerResponseRef: 'resp-1',
    },
    RUN,
  ),
  envelope(
    'agentfootprint.agent.route_decided',
    { chosen: 'tool-calls', rationale: 'model asked', iterIndex: 1 },
    RUN,
  ),
  envelope(
    'agentfootprint.skill.activated',
    { skillId: 'billing', reason: 'read_skill', injectedTools: ['refund'] },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_start',
    { toolName: 'lookup', toolCallId: 'tc-a', args: { account: 'A-1', region: 'eu' } },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_start',
    { toolName: 'refund', toolCallId: 'tc-b', args: { amount: 5 }, protocol: 'mcp' },
    RUN,
  ),
  envelope(
    'agentfootprint.validation.args_invalid',
    {
      toolName: 'refund',
      toolCallId: 'tc-b',
      enforced: true,
      issues: [{ path: 'amount', expected: 'string', got: 'number' }],
    },
    RUN,
  ),
  envelope(
    'agentfootprint.permission.check',
    {
      capability: 'tool_call',
      actor: 'agent',
      target: 'refund',
      result: 'allow',
      policyRuleId: 'r1',
      rationale: 'ok',
    },
    RUN,
  ),
  envelope(
    'agentfootprint.credential.requested',
    { service: 'billing-api', kind: 'oauth', mode: 'interactive', sessionId: 'cred-s' },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_end',
    { toolCallId: 'tc-b', result: { refunded: true }, durationMs: 1 },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_end',
    { toolCallId: 'tc-a', result: 'row', error: true, durationMs: 2 },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_start',
    {
      toolName: 'lookup',
      toolCallId: 'tc-c',
      args: {},
      notDispatched: {
        reason: 'batch-settled',
        pausedCall: { toolCallId: 'tc-p', toolName: 'ask' },
      },
    },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.tool_end',
    { toolCallId: 'tc-c', result: 'not run', durationMs: 0, notDispatched: { reason: 'x' } },
    RUN,
  ),
  envelope(
    'agentfootprint.cost.tick',
    { cumulative: { estimatedUsd: 0.0123, tokensInput: 100, tokensOutput: 20 } },
    RUN,
  ),
  envelope(
    'agentfootprint.agent.iteration_end',
    { turnIndex: 3, iterIndex: 1, toolCallCount: 2 },
    RUN,
  ),
  envelope('agentfootprint.agent.iteration_start', { turnIndex: 3, iterIndex: 2 }, RUN),
  envelope(
    'agentfootprint.stream.llm_start',
    { iteration: 2, provider: 'anthropic', model: 'claude-x' },
    RUN,
  ),
  envelope(
    'agentfootprint.stream.llm_end',
    {
      iteration: 2,
      content: 'final',
      toolCallCount: 0,
      usage: { input: 50, output: 9 },
      stopReason: 'end_turn',
    },
    RUN,
  ),
  envelope(
    'agentfootprint.composition.route_decided',
    {
      conditionalId: 'grade',
      chosen: 'approve',
      rationale: 'score',
      evidence: {
        chosen: 'approve',
        default: 'reject',
        rules: [
          {
            type: 'filter',
            ruleIndex: 0,
            branch: 'approve',
            matched: true,
            label: 'good score',
            conditions: [
              { key: 'score', op: 'gt', threshold: 700, actualSummary: '750', result: true },
            ],
          },
        ],
      },
    },
    RUN,
  ),
  envelope(
    'agentfootprint.permission.halt',
    { target: 'refund', reason: 'budget', iteration: 2 },
    RUN,
  ),
  envelope('agentfootprint.agent.route_decided', { chosen: 'final', iterIndex: 2 }, RUN),
  envelope(
    'agentfootprint.agent.iteration_end',
    { turnIndex: 3, iterIndex: 2, toolCallCount: 0 },
    RUN,
  ),
  envelope(
    'agentfootprint.agent.turn_end',
    {
      turnIndex: 3,
      finalContent: 'the answer',
      totalInputTokens: 150,
      totalOutputTokens: 29,
      iterationCount: 2,
      durationMs: 10,
    },
    RUN,
  ),
];

/** A turn that dies: error.fatal must unwind the tree with ERROR on the root. */
const FATAL_STREAM = [
  envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-fatal'),
  envelope('agentfootprint.agent.iteration_start', { iterIndex: 1 }, 'run-fatal'),
  envelope('agentfootprint.stream.llm_start', { iteration: 1, model: 'm' }, 'run-fatal'),
  envelope(
    'agentfootprint.stream.tool_start',
    { toolName: 't', toolCallId: 'x', args: { a: 1 } },
    'run-fatal',
  ),
  envelope('agentfootprint.error.fatal', { stage: 'tool-calls', scope: 'agent' }, 'run-fatal'),
];

// ─── drivers ─────────────────────────────────────────────────────────

type Options = Omit<OtelObservabilityOptions, 'serviceName' | 'tracer' | '_otelApi'>;

function feed(stream: typeof STREAM, options: Options = {}, withAddEvent = true): CapturedSpan[] {
  const cap = makeCapture({ withAddEvent });
  const strat = otelObservability({
    serviceName: 'pin-agent',
    tracer: cap.tracer,
    _otelApi: cap.otelApi,
    ...options,
  });
  for (const event of stream) strat.exportEvent(event);
  strat.stop();
  return cap.spans;
}

async function realAgentRun(): Promise<CapturedSpan[]> {
  const cap = makeCapture();
  const strat = otelObservability({
    serviceName: 'pin-real-agent',
    tracer: cap.tracer,
    _otelApi: cap.otelApi,
  });
  const provider = new MockProvider({
    replies: [
      { toolCalls: [{ id: 'tc-1', name: 'lookup', args: { account: 'ACCT-42' } }] },
      'final text',
    ],
  });
  const agent = Agent.create({ provider, model: 'mock-model' })
    .system('You are terse.')
    .tool({
      schema: {
        name: 'lookup',
        description: 'Look up an account',
        inputSchema: { type: 'object' },
      },
      execute: () => ({ balance: 10 }),
    })
    .build();
  const stop = agent.enable.observability({ strategy: strat });
  try {
    await agent.run({ message: 'check the account' });
  } finally {
    stop();
  }
  return cap.spans;
}

/** Every event of a session-bound run carries the session on its meta. */
const SESSION = 'conv-77';
const SESSION_STREAM = STREAM.map(
  (e) =>
    ({
      ...e,
      meta: { ...(e as { meta: Record<string, unknown> }).meta, sessionId: SESSION },
    } as unknown as (typeof STREAM)[number]),
);

interface Scenario {
  readonly drive: () => CapturedSpan[] | Promise<CapturedSpan[]>;
  /** Attributes this scenario gained ON PURPOSE — stripped before the byte
   *  comparison, and proven the only delta by their own test. */
  readonly strip?: readonly string[];
}

const SCENARIOS: Record<string, Scenario> = {
  'otel-default': { drive: () => feed(STREAM) },
  'otel-genai-span-names': { drive: () => feed(STREAM, { genAiSpanNames: true }) },
  'otel-no-explainability': { drive: () => feed(STREAM, { explainability: false }) },
  'otel-no-add-event': { drive: () => feed(STREAM, {}, false) },
  'otel-fatal': { drive: () => feed(FATAL_STREAM) },
  'otel-real-agent': { drive: realAgentRun },
  // `captureContent` is the prompt-and-answer switch it always was: tool
  // arguments and results moved to a switch of their own.
  'otel-content': { drive: () => feed(STREAM, { captureContent: true }) },
  'otel-session': { drive: () => feed(SESSION_STREAM), strip: ['gen_ai.conversation.id'] },
};

// ─── projection ──────────────────────────────────────────────────────

/** The run-minted id is the one value that differs between two real runs. */
function normalize(spans: readonly CapturedSpan[], strip: readonly string[] = []): unknown {
  return spans.map((s) => ({
    name: s.name,
    parent: s.parent,
    attributes: Object.fromEntries(
      Object.entries(s.attributes)
        .filter(([k]) => !strip.includes(k))
        .map(([k, v]) => [k, k === 'agentfootprint.run.id' ? '<runId>' : v]),
    ),
    events: s.events,
    status: s.status ?? null,
    ended: s.ended,
  }));
}

const REFERENCE_DIR = new URL('./reference/', import.meta.url);
const referencePath = (name: string): URL => new URL(`${name}.json`, REFERENCE_DIR);
const UPDATE = process.env.AF_OTEL_REFERENCE === 'update';

// ─── the law ─────────────────────────────────────────────────────────

describe('byte-identity — a trace without the new events emits what it emitted on 9.114.1', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      const text = `${JSON.stringify(
        normalize(await scenario.drive(), scenario.strip),
        null,
        2,
      )}\n`;
      if (UPDATE) {
        mkdirSync(REFERENCE_DIR, { recursive: true });
        writeFileSync(referencePath(name), text);
      }
      expect(existsSync(referencePath(name)), `no reference for ${name}`).toBe(true);
      expect(text).toBe(readFileSync(referencePath(name), 'utf8'));
    });
  }

  it('otel-session: the ONLY delta is the conversation digest, on exactly the GenAI spans', () => {
    const digest = sha256Hex(SESSION);
    const spans = feed(SESSION_STREAM);
    for (const span of spans) {
      const op = span.attributes['gen_ai.operation.name'];
      const expected = op === 'invoke_agent' || op === 'chat' || op === 'execute_tool';
      expect(span.attributes['gen_ai.conversation.id'], span.name).toBe(
        expected ? digest : undefined,
      );
    }
    // …and the raw session id is nowhere on the wire.
    expect(JSON.stringify(spans)).not.toContain(SESSION);
  });

  it('the projection is stable: two real runs project identically', async () => {
    // The guard on the guard: a run-minted value slipping past `normalize`
    // would fail every machine and read as a behaviour change.
    expect(JSON.stringify(normalize(await realAgentRun()))).toBe(
      JSON.stringify(normalize(await realAgentRun())),
    );
  });
});
