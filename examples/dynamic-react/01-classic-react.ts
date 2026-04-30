/**
 * 01 — Classic ReAct: ALL tools shipped on EVERY iteration.
 *
 * Twelve tools across three problem-domains (latency / errors / capacity)
 * are registered up front. Every LLM call carries every tool's full
 * description + schema, even though the agent only uses 3 of them in
 * the actual investigation. The wasted tokens compound with each
 * iteration — that's the classic-ReAct tax.
 *
 * Run alongside `02-dynamic-react.ts` for the side-by-side. Same task,
 * same answer, dramatically different input-token cost.
 *
 * The mock provider's `respond` computes `usage.input` from the actual
 * `JSON.stringify(req.tools).length / 4` — a rough char→token ratio.
 * That makes the comparison real even without an API key: the
 * input-token totals you see at the end ARE the cost of shipping the
 * full tool list to the LLM each iteration.
 */

import {
  Agent,
  defineTool,
  mock,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'dynamic-react/01-classic-react',
  title: 'Classic ReAct — every tool on every iteration',
  group: 'dynamic-react',
  description:
    'All 12 tools registered up front. Every LLM call ships every ' +
    'tool description. Wasted-context tax scales with iteration count.',
  defaultInput: 'Why is /api/checkout slow?',
  providerSlots: ['default'],
  tags: ['classic-react', 'comparison', 'baseline'],
};

// #region tools
const latencyTools = [
  defineTool({
    name: 'get_endpoints',
    description: 'List all HTTP endpoints in the service mesh, sorted by request volume.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => '[{"path":"/api/checkout","rps":1240},{"path":"/api/cart","rps":890}]',
  }),
  defineTool({
    name: 'get_p99_latency',
    description: 'Get p99 latency in ms for an endpoint over the last 1h.',
    inputSchema: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
    },
    execute: ({ endpoint }: { endpoint: string }) =>
      `${endpoint}: p99 = 4200ms (was 320ms 24h ago)`,
  }),
  defineTool({
    name: 'get_traces',
    description: 'Fetch slow distributed traces for an endpoint, last 15 min.',
    inputSchema: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
    },
    execute: ({ endpoint }: { endpoint: string }) =>
      `${endpoint}: 89% of time in postgres.checkout_query (slow seq scan on orders.user_id)`,
  }),
  defineTool({
    name: 'get_dependencies',
    description: 'Show downstream service dependencies for an endpoint.',
    inputSchema: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
    },
    execute: ({ endpoint }: { endpoint: string }) =>
      `${endpoint} depends on: postgres-orders, redis-session, stripe-api`,
  }),
];

const errorTools = [
  defineTool({
    name: 'get_error_rates',
    description: 'Get HTTP 5xx rate per endpoint over the last 1h.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => '[{"endpoint":"/api/checkout","5xx_rate":0.02}]',
  }),
  defineTool({
    name: 'get_recent_errors',
    description: 'Fetch recent error log entries with stack frames for an endpoint.',
    inputSchema: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
    },
    execute: () => '12 errors: ConnectionTimeoutError x12',
  }),
  defineTool({
    name: 'get_stack_traces',
    description: 'Get aggregated stack traces grouped by error class for an endpoint.',
    inputSchema: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
    },
    execute: () => 'Top stack: pg.connect timeout at db/pool.ts:88',
  }),
  defineTool({
    name: 'get_deploy_history',
    description: 'List recent deploys with timestamps and commit SHAs.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'Last deploy: 23h ago, sha=ab12cd (changed: db/orders.ts)',
  }),
];

const capacityTools = [
  defineTool({
    name: 'get_cpu_utilization',
    description: 'Get per-pod CPU utilization for a service over the last 1h.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    execute: () => 'checkout-svc: avg 45%, peak 78%',
  }),
  defineTool({
    name: 'get_memory_pressure',
    description: 'Get memory pressure indicators (RSS / cache hit rate) for a service.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    execute: () => 'checkout-svc: RSS stable, page cache 92%',
  }),
  defineTool({
    name: 'get_request_volume',
    description: 'Get request volume (RPS) for a service over the last 1h.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    execute: () => 'checkout-svc: 1240 RPS (vs 1180 RPS yesterday — within normal range)',
  }),
  defineTool({
    name: 'get_scaling_history',
    description: 'List recent autoscaler events for a service.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    execute: () => 'No scale events in the last 6h. Replica count: 4.',
  }),
];
// #endregion tools

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // Scripted mock — same investigation flow as 02-dynamic-react.ts so
  // the only variable across the two files is the tool-list size per
  // iteration. Mock computes input_tokens from the actual request size
  // (tools + messages), so totals reflect the real classic-ReAct tax.
  let iter = 0;
  // Authoritative per-iteration tool count — read from req.tools inside
  // the mock since the agentfootprint.stream.llm_start event currently
  // emits a placeholder 0 for `toolsCount` (v2.6 backlog item).
  const perIterToolCount: number[] = [];
  const scriptedProvider =
    provider ??
    mock({
      respond: (req: LLMRequest): Partial<LLMResponse> => {
        iter++;
        const inputTokens = estimateInputTokens(req);
        perIterToolCount.push((req.tools ?? []).length);
        switch (iter) {
          case 1:
            return {
              content: 'Listing endpoints by volume.',
              toolCalls: [{ id: 'c1', name: 'get_endpoints', args: {} }],
              usage: { input: inputTokens, output: 8 },
              stopReason: 'tool_use',
            };
          case 2:
            return {
              content: 'Checking p99 for /api/checkout.',
              toolCalls: [
                { id: 'c2', name: 'get_p99_latency', args: { endpoint: '/api/checkout' } },
              ],
              usage: { input: inputTokens, output: 10 },
              stopReason: 'tool_use',
            };
          case 3:
            return {
              content: 'Fetching slow traces.',
              toolCalls: [{ id: 'c3', name: 'get_traces', args: { endpoint: '/api/checkout' } }],
              usage: { input: inputTokens, output: 8 },
              stopReason: 'tool_use',
            };
          default:
            return {
              content:
                '/api/checkout p99 jumped from 320ms→4200ms. 89% of time is in a slow ' +
                'postgres seq scan on orders.user_id. Add an index — should drop p99 back ' +
                'under 500ms.',
              toolCalls: [],
              usage: { input: inputTokens, output: 60 },
              stopReason: 'stop',
            };
        }
      },
    });

  const builder = Agent.create({
    provider: scriptedProvider,
    model: 'mock',
    maxIterations: 6,
  }).system('You are an SRE assistant. Investigate the user’s question step by step.');

  // Classic ReAct: ALL twelve tools registered up front.
  for (const t of [...latencyTools, ...errorTools, ...capacityTools]) {
    builder.tool(t);
  }
  const agent = builder.build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  const snap = agent.getLastSnapshot();
  const inTok = (snap?.sharedState as { totalInputTokens?: number })?.totalInputTokens ?? 0;
  const outTok = (snap?.sharedState as { totalOutputTokens?: number })?.totalOutputTokens ?? 0;
  const totalToolDescriptionsSent = perIterToolCount.reduce((sum, n) => sum + n, 0);
  console.log(``);
  perIterToolCount.forEach((n, i) => console.log(`  iter ${i + 1}: tools sent = ${n}`));
  console.log(`\n[classic-react summary]`);
  console.log(`  iterations:                    ${perIterToolCount.length}`);
  console.log(`  total tool descriptions sent:  ${totalToolDescriptionsSent}`);
  console.log(`  input tokens (estimated):      ${inTok}`);
  console.log(`  output tokens:                 ${outTok}`);
  return result;
}

/**
 * Estimate input tokens from request size. Rough char→token ratio of 4.
 * Captures the part that actually scales: how big the prompt + tool
 * definitions are. The dynamic-react example uses the same estimator
 * so the difference is solely the tool-list size per iteration.
 */
function estimateInputTokens(req: LLMRequest): number {
  const toolsBytes = JSON.stringify(req.tools ?? []).length;
  const messagesBytes = JSON.stringify(req.messages ?? []).length;
  return Math.round((toolsBytes + messagesBytes) / 4);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
