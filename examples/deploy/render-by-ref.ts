/**
 * deploy/render-by-ref — the screen redeems a claim ticket over the wire.
 *
 * The artifact store (9.21) taught tools to check data in and hand the model
 * a ~30-token ticket; `present` (9.22) let the model hand one to the screen.
 * This is the hosting half (9.23): a served agent answers two WIRE OPERATIONS
 * on its invoke path, so a frontend can redeem the ticket —
 *
 *   POST /invoke { op: 'artifact-head', ref, sessionId }
 *     → 200 { artifact: { ref, meta } }         the render decision (kind, bytes)
 *   POST /invoke { op: 'artifact-get',  ref, sessionId }
 *     → 200 { artifact: { ref, meta, data } }   render it
 *
 * The law this file proves on a real socket: **resolution is governed by the
 * requesting session's identity** — a ref is redeemed under exactly the scope
 * the run's tools minted it in, and a ref presented by ANOTHER session gets
 * the same `404 ERR_ARTIFACT_NOT_FOUND` a never-minted ref gets. Nothing
 * distinguishable, so a leaked ref in a bug report opens nothing. And when an
 * artifact has expired, the same not-found is what tells the screen to render
 * its stated absence (from the `present` snapshot) instead of a blank pane.
 *
 * Run:  npm run example examples/deploy/render-by-ref.ts
 */

import { Agent, defineTool, inMemoryArtifacts, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/render-by-ref',
  title: 'Render by ref — the screen redeems claim tickets over the wire',
  group: 'deploy',
  description:
    'Serve an agent whose tool mints a chart artifact, then redeem the ticket over HTTP: artifact-head for the render decision, artifact-get for the data — and prove a stranger session gets the same not-found a missing ref gets.',
  defaultInput: 'Chart Q3 sales by region.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'artifacts', 'render-by-ref', 'security', 'http'],
};

/** A consumer swaps `mock()` for a real provider — nothing else changes. */
function buildAgent(provider?: LLMProvider): Agent {
  const chartSales = defineTool({
    name: 'chart_sales',
    description: 'Aggregate sales and check the chart data in as an artifact.',
    execute: async (_args, ctx) => {
      // The tool stores the RESULT, not the conversation: the model (and the
      // wire) will only ever see this ticket's metadata.
      const chart = await ctx.artifacts.put({
        kind: 'chart/spec',
        mediaType: 'application/json',
        data: { type: 'bar', series: { west: 130, east: 90, south: 70 } },
        label: 'Q3 sales by region',
      });
      return `chart ready: ${chart.ref} [${chart.kind} · ${chart.bytes} bytes]`;
    },
  });
  return Agent.create({
    provider:
      provider ??
      mock({
        replies: [
          { content: '', toolCalls: [{ id: 't1', name: 'chart_sales', args: {} }] },
          'The chart is ready — the screen can redeem its ticket.',
        ],
      }),
    model: 'mock',
    maxIterations: 3,
    artifacts: inMemoryArtifacts(), // swap for sqliteArtifacts beside sqliteSessions
  })
    .system('You chart sales data. Store charts as artifacts; never inline them.')
    .tool(chartSales)
    .build();
}

// #region redeem
/** What the frontend does: describe first (pick a renderer), then fetch. */
async function redeem(base: string, sessionId: string, op: string, ref: string) {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ref, sessionId }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
// #endregion redeem

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const agent = buildAgent(provider);

  // The mint lands on the typed record as it happens — the same event a
  // dashboard would watch. The demo reads the ref from there.
  const minted: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    minted.push((e.payload as { ref: string }).ref);
  });

  const handle = await standingAgent({
    agent,
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });

  try {
    // One served turn; its tool checks the chart in under THIS session's scope.
    const turn = await fetch(`${handle.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, sessionId: 'q3-dashboard' }),
    });
    const answer = ((await turn.json()) as { output?: string }).output ?? '';
    const ref = minted[0];
    if (ref === undefined) {
      return { answer, note: 'the provider never called chart_sales, so nothing was minted' };
    }

    // The screen's two moves, under the SAME session identity the turn used.
    const head = await redeem(handle.url, 'q3-dashboard', 'artifact-head', ref);
    const got = await redeem(handle.url, 'q3-dashboard', 'artifact-get', ref);

    // A stranger presenting the same ref: the one indistinguishable not-found.
    const stranger = await redeem(handle.url, 'someone-else', 'artifact-get', ref);
    const missing = await redeem(handle.url, 'someone-else', 'artifact-get', 'art_neverMinted00000000');

    return {
      answer,
      ticket: (head.body.artifact as { meta: unknown }).meta,
      chartData: (got.body.artifact as { data: unknown }).data,
      strangerWithRealRef: { status: stranger.status, code: stranger.body.code },
      strangerWithFakeRef: { status: missing.status, code: missing.body.code },
      refAloneOpensNothing:
        stranger.status === 404 && stranger.body.code === missing.body.code,
    };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
