/**
 * 02 — Dynamic ReAct: tools live behind skills, narrowed per iteration.
 *
 * Same twelve tools as `01-classic-react.ts`, same task, same scripted
 * mock answers. The ONLY difference is shape: tools live inside three
 * `defineSkill()` blocks with `autoActivate: 'currentSkill'`. The LLM
 * starts with just `list_skills` + `read_skill` (cheap), discovers the
 * relevant skill, and only then sees that skill's 4 tools.
 *
 * What this buys (load-bearing):
 *   1. Token savings — wasted tool descriptions never enter the LLM
 *      context. Run both files; compare totals at the end.
 *   2. Hallucination resistance — fewer tools to choose from per call =
 *      LLM less likely to call the wrong tool. With 12+ tools visible,
 *      classic-ReAct LLMs frequently pick the wrong one or hallucinate
 *      arguments (the v1.x readme called this out; we now demonstrate
 *      it with the comparison).
 *   3. Per-iteration recomposition — the THESIS of agentfootprint:
 *      "owning the loop means recomposing prompt + tool list every
 *      iteration." `toolSchemas` literally changes shape between
 *      iter 1 and iter 3 in this example.
 */

import {
  Agent,
  defineSkill,
  defineTool,
  mock,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'dynamic-react/02-dynamic-react',
  title: 'Dynamic ReAct — tools narrow via autoActivate skills',
  group: 'dynamic-react',
  description:
    'Same 12 tools as 01-classic-react.ts, but behind 3 skills with ' +
    'autoActivate: currentSkill. LLM sees only the active skill’s ' +
    'tools per iteration. Token-cost shrinks; hallucination drops.',
  defaultInput: 'Why is /api/checkout slow?',
  providerSlots: ['default'],
  tags: ['dynamic-react', 'comparison', 'showcase', 'autoActivate'],
};

// #region skills
const latencySkill = defineSkill({
  id: 'latency-investigation',
  description: 'Investigate slow endpoints — list endpoints, p99, traces, dependencies.',
  body:
    'Step 1: list endpoints by volume. Step 2: get p99 for the affected endpoint. ' +
    'Step 3: fetch slow traces to find the bottleneck. Step 4: report.',
  autoActivate: 'currentSkill',
  tools: [
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
  ],
});

const errorSkill = defineSkill({
  id: 'error-investigation',
  description: 'Investigate elevated 5xx error rates — recent errors, stack traces, deploys.',
  body: 'Pull error rates → recent errors → stack traces → correlate with deploy history.',
  autoActivate: 'currentSkill',
  tools: [
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
  ],
});

const capacitySkill = defineSkill({
  id: 'capacity-planning',
  description: 'Investigate capacity / saturation — CPU, memory, RPS, scaling history.',
  body: 'Check CPU + memory + RPS + scaler events. Saturation usually shows in one of those four.',
  autoActivate: 'currentSkill',
  tools: [
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
  ],
});
// #endregion skills

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // Same scripted flow as 01-classic-react.ts, with two extra iterations
  // at the start: list_skills → read_skill → then identical investigation.
  // Token estimator is identical; the difference in totals comes ONLY
  // from how many tool definitions ride along on each request.
  let iter = 0;
  // Authoritative per-iteration tool count — read from req.tools inside
  // the mock. With Dynamic ReAct + autoActivate this number CHANGES per
  // iteration (small during skill discovery, then grows once a skill
  // activates). Other skills' tools never appear here.
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
            // Skill activation. Agent auto-attaches `read_skill` whenever
            // skills are registered; LLM picks the right one from
            // descriptions. (`list_skills` is consumer-attachable for
            // larger registries; with 3 skills the descriptions fit in
            // the system prompt directly.)
            return {
              content: 'Latency-investigation skill matches. Activating.',
              toolCalls: [
                {
                  id: 'c1',
                  name: 'read_skill',
                  args: { id: 'latency-investigation' },
                },
              ],
              usage: { input: inputTokens, output: 6 },
              stopReason: 'tool_use',
            };
          case 2:
            return {
              content: 'Listing endpoints by volume.',
              toolCalls: [{ id: 'c2', name: 'get_endpoints', args: {} }],
              usage: { input: inputTokens, output: 8 },
              stopReason: 'tool_use',
            };
          case 3:
            return {
              content: 'Checking p99 for /api/checkout.',
              toolCalls: [
                { id: 'c3', name: 'get_p99_latency', args: { endpoint: '/api/checkout' } },
              ],
              usage: { input: inputTokens, output: 10 },
              stopReason: 'tool_use',
            };
          case 4:
            return {
              content: 'Fetching slow traces.',
              toolCalls: [{ id: 'c4', name: 'get_traces', args: { endpoint: '/api/checkout' } }],
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

  const agent = Agent.create({
    provider: scriptedProvider,
    model: 'mock',
    maxIterations: 8,
  })
    .system('You are an SRE assistant. Use list_skills + read_skill before data tools.')
    .skill(latencySkill)
    .skill(errorSkill)
    .skill(capacitySkill)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  const snap = agent.getLastSnapshot();
  const inTok = (snap?.sharedState as { totalInputTokens?: number })?.totalInputTokens ?? 0;
  const outTok = (snap?.sharedState as { totalOutputTokens?: number })?.totalOutputTokens ?? 0;
  const totalToolDescriptionsSent = perIterToolCount.reduce((sum, n) => sum + n, 0);
  console.log(``);
  perIterToolCount.forEach((n, i) => console.log(`  iter ${i + 1}: tools sent = ${n}`));
  console.log(`\n[dynamic-react summary]`);
  console.log(`  iterations:                    ${perIterToolCount.length}`);
  console.log(`  total tool descriptions sent:  ${totalToolDescriptionsSent}`);
  console.log(`  input tokens (estimated):      ${inTok}`);
  console.log(`  output tokens:                 ${outTok}`);
  return result;
}

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
