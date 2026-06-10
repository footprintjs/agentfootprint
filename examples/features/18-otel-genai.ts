/**
 * 18 — OTel GenAI semantic conventions + explainability (#19).
 *
 * `otelObservability` maps an agent run onto OpenTelemetry spans that
 * follow the GenAI semantic conventions (`gen_ai.*` namespace):
 *
 *   invoke_agent (root)  →  gen_ai.operation.name / gen_ai.agent.name /
 *                           turn-total gen_ai.usage.* tokens
 *   chat (per LLM call)  →  gen_ai.request.model / gen_ai.provider.name /
 *                           gen_ai.usage.* / gen_ai.response.finish_reasons
 *   execute_tool         →  gen_ai.tool.name / gen_ai.tool.call.id
 *
 * …plus the agentfootprint explainability layer as SPAN EVENTS:
 * route decisions, skill routing provenance, validation rejections,
 * permission decisions, credential lifecycle — and, via
 * `strategy.decisionEvidenceRecorder()`, the operator-level
 * decide()/select() evidence (`creditScore gt 700 → 750 (true)`).
 *
 * PII discipline: tool args appear as KEY NAMES only, results as a
 * TYPE only, prompts / LLM content never — mirrors the #9 contract.
 *
 * The example injects an in-memory tracer (the `tracer` option) so it
 * runs without `@opentelemetry/api`. In production omit `tracer` and
 * configure your OTel SDK + exporter once at startup — every span here
 * lands in Honeycomb / Tempo / Datadog / any OTLP backend unchanged.
 *
 * Run:  npm run example -- examples/features/18-otel-genai.ts
 */

import { FlowChartExecutor, decide, flowChart } from 'footprintjs';
import { Agent } from '../../src/index.js';
import { otelObservability } from '../../src/observability-providers.js';
import type {
  OtelSpanLike,
  OtelSpanOptions,
  OtelTracerLike,
} from '../../src/observability-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/18-otel-genai',
  title: 'OTel GenAI conventions — gen_ai.* spans + decision-evidence span events',
  group: 'features',
  description:
    'otelObservability emits GenAI-semconv spans (invoke_agent / chat / execute_tool) plus explainability span events: route decisions, decide() evidence, validation, permission, credential.',
  defaultInput: 'audit the Q3 ledger',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'otel', 'gen_ai', 'compliance'],
};

// ─── In-memory tracer (stands in for @opentelemetry/api) ─────────────

interface DemoSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  ended: boolean;
}

function makeDemoTracer(): { tracer: OtelTracerLike; spans: DemoSpan[] } {
  const spans: DemoSpan[] = [];
  const tracer: OtelTracerLike = {
    startSpan(name: string, options?: OtelSpanOptions): OtelSpanLike {
      const span: DemoSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        ended: false,
      };
      spans.push(span);
      return {
        setAttribute: (key, value) => (span.attributes[key] = value),
        setStatus: () => undefined,
        end: () => (span.ended = true),
        spanContext: () => ({ traceId: 'demo', spanId: `s${spans.length}`, traceFlags: 1 }),
        addEvent: (name, attributes) =>
          span.events.push({ name, attributes: { ...(attributes ?? {}) } }),
      };
    },
  };
  return { tracer, spans };
}

function printSpans(spans: readonly DemoSpan[]): void {
  for (const span of spans) {
    console.log(`\n▣ span "${span.name}"`);
    for (const [k, v] of Object.entries(span.attributes)) {
      if (k.startsWith('gen_ai.') || k.startsWith('agentfootprint.'))
        console.log(`    ${k} = ${JSON.stringify(v)}`);
    }
    for (const ev of span.events) {
      console.log(`    ◆ event ${ev.name}`);
      for (const [k, v] of Object.entries(ev.attributes))
        console.log(`        ${k} = ${JSON.stringify(v)}`);
    }
  }
}

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  const { tracer, spans } = makeDemoTracer();

  // genAiSpanNames: true → spec span names ('invoke_agent my-agent',
  // 'chat mock', 'execute_tool analyze'). Leave it off to keep legacy
  // names while still emitting every gen_ai.* attribute.
  const otel = otelObservability({ serviceName: 'audit-agent', tracer, genAiSpanNames: true });

  // ── Part 1: a tool-using agent run → GenAI span tree ────────────────
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
  })
    .system('You audit ledgers.')
    .tool({
      schema: { name: 'analyze', description: 'Analyze a ledger', inputSchema: { type: 'object' } },
      execute: () => 'analysis complete',
    })
    .build();

  const stop = agent.enable.observability({ strategy: otel });
  let out: unknown;
  try {
    out = await agent.run({ message: input });
  } finally {
    stop();
  }

  // ── Part 2: decide() evidence via the FlowRecorder bridge ──────────
  // Operator-level decision evidence travels on footprintjs's
  // FlowRecorder channel; attach the strategy's bridge to capture it.
  const riskChart = flowChart<{ creditScore: number; outcome?: string }>(
    'Seed',
    async (scope) => {
      scope.creditScore = 750;
    },
    'seed',
  )
    .addDeciderFunction(
      'ClassifyRisk',
      (scope) =>
        decide(
          scope as unknown as { creditScore: number },
          [{ when: { creditScore: { gt: 700 } }, then: 'approved', label: 'Good credit' }],
          'rejected',
        ),
      'classify-risk',
    )
    .addFunctionBranch('approved', 'Approve', async (scope) => {
      scope.outcome = 'approved';
    })
    .addFunctionBranch('rejected', 'Reject', async (scope) => {
      scope.outcome = 'rejected';
    })
    .end()
    .build();

  // Re-open a turn so the evidence has a live span to land on (in an
  // agent run the active iteration span plays this role).
  otel.exportEvent({
    type: 'agentfootprint.agent.turn_start',
    payload: { turnIndex: 0, userPrompt: '' },
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'demo#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'risk-run',
    },
  } as never);
  const executor = new FlowChartExecutor(riskChart);
  executor.attachCombinedRecorder(otel.decisionEvidenceRecorder());
  await executor.run({});
  otel.stop?.();

  console.log('\n══ OTel GenAI span tree (in-memory exporter) ══');
  printSpans(spans);
  console.log(`\n${spans.length} spans, all ended: ${spans.every((s) => s.ended)}`);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
