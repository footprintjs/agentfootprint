/**
 * otelObservability — GenAI semantic conventions + explainability (#19).
 *
 * Complements otel.test.ts (legacy back-compat suite). Test types:
 *
 *   UNIT        — gen_ai.* attribute emission per event; evidence
 *                 rendering; options (genAiSpanNames / explainability);
 *                 addEvent fallback; runId anchoring from meta
 *   FUNCTIONAL  — full REAL-envelope event sequence → span tree with
 *                 semconv attrs + explainability span events
 *   INTEGRATION — a REAL Agent run (MockProvider, scripted tool call)
 *                 through agent.enable.observability; a REAL footprintjs
 *                 decide() chart through decisionEvidenceRecorder()
 *   SECURITY    — PII discipline: tool arg/result VALUES, prompts and
 *                 secrets never reach attributes or span events
 *
 * LESSON (#5, load-bearing): events here use the REAL dispatcher
 * envelope shape — `{ type, payload, meta: { runId, ... } }` — not the
 * fabricated `payload.runId` shape the legacy tests used. The fabricated
 * shape masked three runtime bugs (runId / cost.tick / tool_end fields).
 */

import { describe, expect, it } from 'vitest';
import { FlowChartExecutor, decide, flowChart } from 'footprintjs';
import {
  otelObservability,
  type OtelSpanLike,
  type OtelSpanOptions,
  type OtelTracerLike,
  type OtelAttributeValue,
} from '../../src/adapters/observability/otel.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

// ── Mock OTel tracer capturing spans + span events ───────────────────

interface CapturedSpanEvent {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
}

interface CapturedSpan {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
  readonly events: CapturedSpanEvent[];
  status?: { code: number; message?: string };
  ended: boolean;
}

function makeMockTracer(opts: { withAddEvent?: boolean } = {}): {
  tracer: OtelTracerLike;
  spans: CapturedSpan[];
} {
  const withAddEvent = opts.withAddEvent !== false;
  const spans: CapturedSpan[] = [];
  const tracer: OtelTracerLike = {
    startSpan(name: string, options?: OtelSpanOptions): OtelSpanLike {
      const captured: CapturedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        ended: false,
      };
      spans.push(captured);
      const span: OtelSpanLike = {
        setAttribute(key, value): unknown {
          captured.attributes[key] = value;
          return undefined;
        },
        setStatus(status): unknown {
          captured.status = status;
          return undefined;
        },
        end(): void {
          captured.ended = true;
        },
        spanContext() {
          return {
            traceId: 'mock-trace',
            spanId: `mock-${spans.indexOf(captured)}`,
            traceFlags: 1,
          };
        },
        ...(withAddEvent && {
          addEvent(name: string, attributes?: Record<string, OtelAttributeValue>): unknown {
            captured.events.push({ name, attributes: { ...(attributes ?? {}) } });
            return undefined;
          },
        }),
      };
      return span;
    },
  };
  return { tracer, spans };
}

/** Build a REAL dispatcher-envelope event — run anchor on `meta.runId`,
 *  exactly as `bridge/eventMeta.ts` produces at runtime. */
function envelope(
  type: string,
  payload: Record<string, unknown>,
  runId = 'run-1',
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId,
    },
  } as unknown as AgentfootprintEvent;
}

/** Every attribute value (span attrs + span-event attrs) as one string —
 *  for "value X appears NOWHERE" security assertions. */
function allEmittedText(spans: readonly CapturedSpan[]): string {
  return JSON.stringify(spans.map((s) => ({ n: s.name, a: s.attributes, e: s.events })));
}

// ─── UNIT — runId anchoring ──────────────────────────────────────────

describe('otelObservability GenAI — unit: meta.runId anchoring', () => {
  it('opens/closes spans for REAL envelope events (runId on meta, NOT payload)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }),
    );
    expect(spans).toHaveLength(1);
    strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    expect(spans[0]?.ended).toBe(true);
  });

  it('demultiplexes two interleaved runs by meta.runId', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-A'));
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-B'));
    strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, 'run-A'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.ended).toBe(true);
    expect(spans[1]?.ended).toBe(false);
    strat.exportEvent(envelope('agentfootprint.agent.turn_end', { turnIndex: 0 }, 'run-B'));
    expect(spans[1]?.ended).toBe(true);
  });
});

// ─── UNIT — gen_ai.* semconv attributes ──────────────────────────────

describe('otelObservability GenAI — unit: gen_ai.* attributes', () => {
  function runLlmTurn(genAiSpanNames = false): CapturedSpan[] {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'loan-agent', tracer, genAiSpanNames });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 2 }));
    strat.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 2, iterIndex: 1 }),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.llm_start', {
        iteration: 1,
        provider: 'anthropic',
        model: 'claude-opus-4',
        systemPromptChars: 10,
        messagesCount: 1,
        toolsCount: 1,
        temperature: 0.2,
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'SECRET-CONTENT',
        toolCallCount: 0,
        usage: { input: 120, output: 45, cacheRead: 30, cacheWrite: 7 },
        stopReason: 'end_turn',
        durationMs: 12,
        providerResponseRef: 'resp-123',
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.agent.iteration_end', {
        turnIndex: 2,
        iterIndex: 1,
        toolCallCount: 0,
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.agent.turn_end', {
        turnIndex: 2,
        finalContent: 'done',
        totalInputTokens: 120,
        totalOutputTokens: 45,
        iterationCount: 1,
        durationMs: 99,
      }),
    );
    return spans;
  }

  it('turn span: invoke_agent operation + agent name + run id + turn-total usage', () => {
    const spans = runLlmTurn();
    const root = spans[0]!;
    expect(root.name).toBe('loan-agent'); // legacy name preserved by default
    expect(root.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(root.attributes['gen_ai.agent.name']).toBe('loan-agent');
    expect(root.attributes['agentfootprint.run.id']).toBe('run-1');
    expect(root.attributes['agentfootprint.turn.index']).toBe(2);
    // back-filled from first llm_start:
    expect(root.attributes['gen_ai.provider.name']).toBe('anthropic');
    expect(root.attributes['gen_ai.request.model']).toBe('claude-opus-4');
    // turn totals at turn_end:
    expect(root.attributes['gen_ai.usage.input_tokens']).toBe(120);
    expect(root.attributes['gen_ai.usage.output_tokens']).toBe(45);
    expect(root.attributes['agentfootprint.iteration.count']).toBe(1);
  });

  it('llm span: chat operation + request/response/usage semconv attrs', () => {
    const spans = runLlmTurn();
    const llm = spans.find((s) => s.name === 'llm')!;
    expect(llm.attributes['gen_ai.operation.name']).toBe('chat');
    expect(llm.attributes['gen_ai.provider.name']).toBe('anthropic');
    expect(llm.attributes['gen_ai.request.model']).toBe('claude-opus-4');
    expect(llm.attributes['gen_ai.request.temperature']).toBe(0.2);
    expect(llm.attributes['gen_ai.usage.input_tokens']).toBe(120);
    expect(llm.attributes['gen_ai.usage.output_tokens']).toBe(45);
    expect(llm.attributes['gen_ai.usage.cache_read.input_tokens']).toBe(30);
    expect(llm.attributes['gen_ai.usage.cache_creation.input_tokens']).toBe(7);
    expect(llm.attributes['gen_ai.response.finish_reasons']).toEqual(['end_turn']);
    expect(llm.attributes['gen_ai.response.id']).toBe('resp-123');
    expect(llm.ended).toBe(true);
  });

  it('iteration span pops by prefix using the REAL iterIndex field', () => {
    const spans = runLlmTurn();
    const iter = spans.find((s) => s.name === 'iteration:1')!;
    expect(iter.attributes['iteration.number']).toBe(1);
    expect(iter.attributes['agentfootprint.tool_call.count']).toBe(0);
    expect(iter.ended).toBe(true);
  });

  it('genAiSpanNames: true → spec span names (invoke_agent / chat {model})', () => {
    const spans = runLlmTurn(true);
    expect(spans[0]?.name).toBe('invoke_agent loan-agent');
    expect(spans.some((s) => s.name === 'chat claude-opus-4')).toBe(true);
    expect(spans.every((s) => s.ended)).toBe(true);
  });

  it('tool span: execute_tool operation + tool.call.id; tool_end correlates by toolCallId (parallel-safe)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_start', {
        toolName: 'lookup',
        toolCallId: 'tc-1',
        args: { account: 'a-1' },
        protocol: 'native',
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_start', {
        toolName: 'search',
        toolCallId: 'tc-2',
        args: {},
      }),
    );
    // End OUT of LIFO order — the REAL ToolEndPayload has NO toolName.
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', {
        toolCallId: 'tc-1',
        result: 'ok',
        durationMs: 3,
      }),
    );
    const lookup = spans.find((s) => s.name === 'tool:lookup')!;
    const search = spans.find((s) => s.name === 'tool:search')!;
    expect(lookup.attributes['gen_ai.operation.name']).toBe('execute_tool');
    expect(lookup.attributes['gen_ai.tool.name']).toBe('lookup');
    expect(lookup.attributes['gen_ai.tool.call.id']).toBe('tc-1');
    expect(lookup.attributes['agentfootprint.tool.protocol']).toBe('native');
    expect(lookup.ended).toBe(true); // tc-1 ended, not LIFO tc-2
    expect(search.ended).toBe(false);
    strat.exportEvent(
      envelope('agentfootprint.stream.tool_end', {
        toolCallId: 'tc-2',
        result: 1,
        error: true,
        durationMs: 4,
      }),
    );
    expect(search.ended).toBe(true);
    expect(search.status?.code).not.toBe(0);
    expect(search.attributes['error.type']).toBe('_OTHER');
  });

  it('cost.tick reads the REAL CostTickPayload shape (cumulative.estimatedUsd)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.cost.tick', {
        scope: 'iteration',
        tokensInput: 10,
        tokensOutput: 5,
        estimatedUsd: 0.001,
        cumulative: { tokensInput: 10, tokensOutput: 5, estimatedUsd: 0.0456 },
      }),
    );
    expect(spans[0]?.attributes['cost.cumulative_usd']).toBe(0.0456);
  });

  it('error.fatal closes the span tree with ERROR status on the root (no leak until stop)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 1 }),
    );
    strat.exportEvent(
      envelope('agentfootprint.error.fatal', {
        error: 'boom SECRET-MSG',
        stage: 'call-llm',
        scope: 'agent',
      }),
    );
    expect(spans.every((s) => s.ended)).toBe(true);
    expect(spans[0]?.status?.code).not.toBe(0);
    const fatal = spans[0]?.events.find((e) => e.name === 'agentfootprint.error.fatal');
    expect(fatal?.attributes['agentfootprint.error.stage']).toBe('call-llm');
    // error MESSAGES can echo PII — never emitted:
    expect(allEmittedText(spans)).not.toContain('SECRET-MSG');
  });
});

// ─── UNIT — explainability span events ───────────────────────────────

describe('otelObservability GenAI — unit: explainability span events', () => {
  it('agent.route_decided → span event on the iteration span', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 1 }),
    );
    strat.exportEvent(
      envelope('agentfootprint.agent.route_decided', {
        turnIndex: 0,
        iterIndex: 1,
        chosen: 'tool-calls',
        rationale: 'LLM requested 2 tool call(s)',
      }),
    );
    const iter = spans.find((s) => s.name === 'iteration:1')!;
    const ev = iter.events.find((e) => e.name === 'agentfootprint.agent.route_decided')!;
    expect(ev.attributes['agentfootprint.decision.chosen']).toBe('tool-calls');
    expect(ev.attributes['agentfootprint.decision.rationale']).toBe('LLM requested 2 tool call(s)');
    expect(ev.attributes['agentfootprint.iteration.index']).toBe(1);
  });

  it('composition.route_decided with decide()-shaped evidence → operator-level conditions', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.composition.route_decided', {
        conditionalId: 'risk-router',
        chosen: 'approved',
        rationale: 'rule matched',
        evidence: {
          chosen: 'approved',
          default: 'rejected',
          rules: [
            {
              type: 'filter',
              ruleIndex: 0,
              branch: 'approved',
              matched: true,
              label: 'Good credit',
              conditions: [
                {
                  key: 'creditScore',
                  op: 'gt',
                  threshold: 700,
                  actualSummary: '750',
                  result: true,
                },
              ],
            },
          ],
        },
      }),
    );
    const ev = spans[0]!.events.find((e) => e.name === 'agentfootprint.composition.route_decided')!;
    expect(ev.attributes['agentfootprint.decision.stage']).toBe('risk-router');
    expect(ev.attributes['agentfootprint.decision.rule.label']).toBe('Good credit');
    expect(ev.attributes['agentfootprint.decision.rule.index']).toBe(0);
    expect(ev.attributes['agentfootprint.decision.default']).toBe('rejected');
    expect(ev.attributes['agentfootprint.decision.conditions']).toEqual([
      'creditScore gt 700 → 750 (true)',
    ]);
  });

  it('context.evaluated routing → one skill.routing span event per routed injection', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.context.evaluated', {
        iteration: 1,
        activeCount: 2,
        skippedCount: 0,
        evaluatedTotal: 2,
        activeIds: ['sk-esxi', 'sk-io'],
        skippedDetails: [],
        triggerKindCounts: { rule: 2 },
        skillCatalog: [],
        routing: [
          {
            injectionId: 'sk-esxi',
            flavor: 'skill',
            via: 'tree',
            path: [{ label: 'host type', branch: 'esxi' }],
            tools: ['rvtools'],
          },
          {
            injectionId: 'sk-io',
            flavor: 'skill',
            via: 'route',
            label: 'on io alert',
            from: 'sk-esxi',
          },
        ],
      }),
    );
    const events = spans[0]!.events.filter((e) => e.name === 'agentfootprint.skill.routing');
    expect(events).toHaveLength(2);
    expect(events[0]?.attributes['agentfootprint.skill.injection_id']).toBe('sk-esxi');
    expect(events[0]?.attributes['agentfootprint.skill.path']).toEqual(['host type → esxi']);
    expect(events[0]?.attributes['agentfootprint.skill.tools']).toEqual(['rvtools']);
    expect(events[1]?.attributes['agentfootprint.skill.from']).toBe('sk-esxi');
  });

  it('context.evaluated WITHOUT routing emits no span event (noise control)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.context.evaluated', {
        iteration: 1,
        activeCount: 0,
        skippedCount: 0,
        evaluatedTotal: 0,
        activeIds: [],
        skippedDetails: [],
        triggerKindCounts: {},
        skillCatalog: [],
      }),
    );
    expect(spans[0]?.events).toHaveLength(0);
  });

  it('validation.args_invalid (#9) → span event with TYPE-level issues + enforced flag', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.validation.args_invalid', {
        toolName: 'transfer',
        toolCallId: 'tc-9',
        iteration: 1,
        issues: [{ path: 'amount', expected: 'number', got: 'string' }],
        enforced: true,
      }),
    );
    const ev = spans[0]!.events.find((e) => e.name === 'agentfootprint.validation.args_invalid')!;
    expect(ev.attributes['agentfootprint.validation.tool_name']).toBe('transfer');
    expect(ev.attributes['agentfootprint.validation.enforced']).toBe(true);
    expect(ev.attributes['agentfootprint.validation.issue_count']).toBe(1);
    expect(ev.attributes['agentfootprint.validation.issues']).toEqual([
      'amount: expected number, got string',
    ]);
  });

  it('permission.check + credential lifecycle → span events (no secrets by construction)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.permission.check', {
        capability: 'tool_call',
        actor: 'agent',
        target: 'transfer',
        result: 'deny',
        policyRuleId: 'rule-7',
        reason: 'security:exfiltration',
      }),
    );
    strat.exportEvent(
      envelope('agentfootprint.credential.acquired', {
        service: 'github',
        kind: 'bearer',
        expiresAt: 1,
      }),
    );
    const perm = spans[0]!.events.find((e) => e.name === 'agentfootprint.permission.check')!;
    expect(perm.attributes['agentfootprint.permission.result']).toBe('deny');
    expect(perm.attributes['agentfootprint.permission.policy_rule_id']).toBe('rule-7');
    const cred = spans[0]!.events.find((e) => e.name === 'agentfootprint.credential.acquired')!;
    expect(cred.attributes['agentfootprint.credential.service']).toBe('github');
    expect(cred.attributes['agentfootprint.credential.kind']).toBe('bearer');
  });

  it('explainability: false suppresses span events but keeps gen_ai.* attributes', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer, explainability: false });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.agent.route_decided', {
        turnIndex: 0,
        iterIndex: 1,
        chosen: 'final',
      }),
    );
    expect(spans[0]?.events).toHaveLength(0);
    expect(spans[0]?.attributes['gen_ai.operation.name']).toBe('invoke_agent');
  });

  it('falls back to flattened attributes when the tracer span lacks addEvent', () => {
    const { tracer, spans } = makeMockTracer({ withAddEvent: false });
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.agent.route_decided', {
        turnIndex: 0,
        iterIndex: 1,
        chosen: 'final',
      }),
    );
    expect(
      spans[0]?.attributes['agentfootprint.agent.route_decided.agentfootprint.decision.chosen'],
    ).toBe('final');
  });
});

// ─── UNIT — decisionEvidenceRecorder ─────────────────────────────────

describe('otelObservability GenAI — unit: decisionEvidenceRecorder', () => {
  it('skips decisions WITHOUT evidence (already on the typed-event channel)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    const rec = strat.decisionEvidenceRecorder();
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    rec.onDecision({ decider: 'Route', chosen: 'final' } as never);
    expect(spans[0]?.events).toHaveLength(0);
  });

  it('filters sf-cache plumbing deciders', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    const rec = strat.decisionEvidenceRecorder();
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    rec.onDecision({
      decider: 'CacheGate',
      chosen: 'hit',
      evidence: { rules: [], chosen: 'hit', default: 'miss' },
      traversalContext: { stageId: 'sf-llm-call/sf-cache/gate' },
    } as never);
    expect(spans[0]?.events).toHaveLength(0);
  });

  it('skips when more than one turn is in flight (no cross-run contamination)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    const rec = strat.decisionEvidenceRecorder();
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-A'));
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }, 'run-B'));
    rec.onDecision({
      decider: 'Classify',
      chosen: 'approved',
      evidence: { rules: [], chosen: 'approved', default: 'rejected' },
    } as never);
    expect(spans.every((s) => s.events.length === 0)).toBe(true);
  });
});

// ─── INTEGRATION — real footprintjs decide() chart ───────────────────

describe('otelObservability GenAI — integration: real decide() evidence', () => {
  it('a real decide() decision lands as a span event with operator-level conditions', async () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });

    // Active turn so the evidence has a span to land on.
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));

    interface LoanState {
      creditScore: number;
      outcome?: string;
    }
    const chart = flowChart<LoanState>(
      'Seed',
      async (scope) => {
        scope.creditScore = 750;
      },
      'seed',
    )
      .addDeciderFunction(
        'Classify',
        (scope) =>
          decide(
            scope as never,
            [{ when: { creditScore: { gt: 700 } }, then: 'approved', label: 'Good credit' }],
            'rejected',
          ),
        'classify',
      )
      .addFunctionBranch('approved', 'Approve', async (scope) => {
        scope.outcome = 'ok';
      })
      .addFunctionBranch('rejected', 'Reject', async (scope) => {
        scope.outcome = 'no';
      })
      .end()
      .build();

    const executor = new FlowChartExecutor(chart);
    executor.attachCombinedRecorder(strat.decisionEvidenceRecorder());
    await executor.run({});

    const root = spans[0]!;
    const ev = root.events.find((e) => e.name === 'agentfootprint.decision.evidence');
    expect(ev).toBeDefined();
    expect(ev?.attributes['agentfootprint.decision.chosen']).toBe('approved');
    expect(ev?.attributes['agentfootprint.decision.rule.label']).toBe('Good credit');
    expect(ev?.attributes['agentfootprint.decision.default']).toBe('rejected');
    const conditions = ev?.attributes['agentfootprint.decision.conditions'] as readonly string[];
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain('creditScore gt 700');
    expect(conditions[0]).toContain('(true)');
  });
});

// ─── INTEGRATION — real Agent run (would have caught the runId bug) ──

describe('otelObservability GenAI — integration: real Agent run', () => {
  async function runRealAgent(): Promise<{ spans: CapturedSpan[]; out: unknown }> {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'compliance-agent', tracer });

    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'tc-1', name: 'lookup', args: { account: 'ACCT-PII-42' } }] },
        'CONTENT-PII-SENTINEL final text',
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
        execute: () => 'RESULT-PII-SENTINEL',
      })
      .build();

    const stop = agent.enable.observability({ strategy: strat });
    try {
      const out = await agent.run({ message: 'check the SECRET-PROMPT account' });
      return { spans, out };
    } finally {
      stop();
    }
  }

  it('a real agent run produces a closed span tree with gen_ai.* attrs end-to-end', async () => {
    const { spans } = await runRealAgent();

    // Spans actually opened — the pre-6.17 payload.runId read produced
    // ZERO spans on real runs (meta.runId is the runtime anchor).
    expect(spans.length).toBeGreaterThan(0);
    const root = spans[0]!;
    expect(root.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(root.attributes['gen_ai.agent.name']).toBe('compliance-agent');
    expect(typeof root.attributes['agentfootprint.run.id']).toBe('string');

    // Two inference spans (tool iteration + final), semconv attrs on.
    const llms = spans.filter((s) => s.attributes['gen_ai.operation.name'] === 'chat');
    expect(llms.length).toBe(2);
    expect(llms[0]?.attributes['gen_ai.request.model']).toBe('mock-model');
    expect(typeof llms[0]?.attributes['gen_ai.usage.input_tokens']).toBe('number');
    expect(Array.isArray(llms[0]?.attributes['gen_ai.response.finish_reasons'])).toBe(true);

    // Tool span correlated by toolCallId from the REAL ToolEndPayload.
    const tool = spans.find((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool')!;
    expect(tool.attributes['gen_ai.tool.name']).toBe('lookup');
    expect(tool.attributes['gen_ai.tool.call.id']).toBe('tc-1');
    expect(tool.ended).toBe(true);

    // Route decisions landed as span events somewhere in the tree.
    const routeEvents = spans.flatMap((s) =>
      s.events.filter((e) => e.name === 'agentfootprint.agent.route_decided'),
    );
    expect(routeEvents.length).toBeGreaterThanOrEqual(2); // tool-calls, then final
    expect(
      routeEvents.some((e) => e.attributes['agentfootprint.decision.chosen'] === 'tool-calls'),
    ).toBe(true);

    // No span leaks — turn_end closed everything.
    expect(spans.every((s) => s.ended)).toBe(true);
  });

  // ─── SECURITY — PII discipline on the real run ─────────────────────

  it('SECURITY: tool arg/result VALUES, prompt and LLM content never reach the wire', async () => {
    const { spans } = await runRealAgent();
    const emitted = allEmittedText(spans);
    expect(emitted).not.toContain('ACCT-PII-42'); // tool arg VALUE
    expect(emitted).not.toContain('RESULT-PII-SENTINEL'); // tool result VALUE
    expect(emitted).not.toContain('SECRET-PROMPT'); // user prompt
    expect(emitted).not.toContain('CONTENT-PII-SENTINEL'); // LLM content
    // …but the SHAPE is there: arg key names only.
    const tool = spans.find((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool')!;
    expect(tool.attributes['agentfootprint.tool.args.keys']).toEqual(['account']);
    expect(tool.attributes['agentfootprint.tool.result.type']).toBe('string');
  });
});

// ─── SECURITY — bounding ─────────────────────────────────────────────

describe('otelObservability GenAI — security: attribute bounding', () => {
  it('caps oversized strings and lists (defense-in-depth under upstream bounding)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelope('agentfootprint.composition.route_decided', {
        conditionalId: 'big',
        chosen: 'x'.repeat(5000),
        evidence: {
          chosen: 'a',
          default: 'b',
          rules: [
            {
              type: 'filter',
              ruleIndex: 0,
              branch: 'a',
              matched: true,
              conditions: Array.from({ length: 50 }, (_, i) => ({
                key: `k${i}`,
                op: 'eq',
                threshold: i,
                actualSummary: String(i),
                result: true,
              })),
            },
          ],
        },
      }),
    );
    const ev = spans[0]!.events.find((e) => e.name === 'agentfootprint.composition.route_decided')!;
    expect((ev.attributes['agentfootprint.decision.chosen'] as string).length).toBeLessThanOrEqual(
      256,
    );
    const conditions = ev.attributes['agentfootprint.decision.conditions'] as readonly string[];
    expect(conditions.length).toBeLessThanOrEqual(21); // 20 + overflow marker
    expect(conditions[conditions.length - 1]).toContain('more');
  });
});
