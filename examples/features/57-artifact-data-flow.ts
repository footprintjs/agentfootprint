/**
 * 57 — Artifact data flow: refs the model ROUTES (`wants` + placement + `present`).
 *
 * Phase 2 of the claim check, the two-tool worked example end to end:
 *
 *   1. `get_data` returns 48,000 rows WITHOUT calling the store — the
 *      PLACEMENT threshold (`artifacts: { store, placement }`) sees the
 *      result is over budget, checks it in as `tool-result/get_data`, and
 *      the model reads a ~30-token claim ticket instead of megabytes.
 *   2. The model passes the ref STRING to `transform_report`, which
 *      declares `wants: { dataset: 'tool-result/get_data' }` — the
 *      framework redeems the ref under the run's own scope BEFORE execute,
 *      kind-checks it, and the handler receives the ROWS (plus the ticket
 *      on `ctx.wanted`). A stale or wrong-kind ref would never reach the
 *      tool: the model would read a teaching refusal listing the live refs
 *      of the wanted kind.
 *   3. The tool mints the chart data (`chart/spec`, parent = the dataset)
 *      and the model finishes with `present({ ref, as: 'bar-chart' })` —
 *      the result carries the DESCRIPTION SNAPSHOT {kind, mediaType,
 *      bytes, label}, so a reloaded conversation can re-draw the pane (or
 *      state honestly that it expired). The model never serializes what
 *      the screen will show.
 *
 * The window's spend on ~6 MB of freight: two metadata lines and one
 * snapshot. Every hop is on the typed record:
 *   artifacts.minted → artifacts.resolved (op get, at dispatch) →
 *   artifacts.minted (the chart) → artifacts.resolved (head) →
 *   artifacts.presented.
 *
 * The mock respond function reads the ref off the previous tool result —
 * exactly what a real model does — so the ref genuinely rides the tool
 * arguments here, unlike example 56's closure hand-off.
 */

import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  PRESENT_TOOL_NAME,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/57-artifact-data-flow',
  title: 'Artifact data flow (wants + placement + present)',
  group: 'features',
  description:
    'The model routes tickets instead of hauling data: a 48k-row result is auto-placed into the store, the ref rides a wants-declared tool argument (resolved at dispatch, kind-checked, teaching refusals), and present() hands the chart to the screen with a durable description snapshot.',
  defaultInput: 'Chart Q3 sales by region',
  providerSlots: ['default'],
  tags: ['artifacts', 'wants', 'placement', 'present', 'claim-check'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const events: string[] = [];

  // #region wiring
  // The store + the operator's placement dial: any tool result over
  // 2,000 chars is checked in and the model reads the claim ticket.
  const artifacts = {
    store: inMemoryArtifacts(),
    placement: { maxInlineChars: 2_000 },
  };
  // #endregion wiring

  // #region tools
  // A perfectly ordinary tool — it does NOT call the store. Placement does.
  const getData = defineTool({
    name: 'get_data',
    description: 'Fetch the Q3 sales rows (a large result).',
    execute: () =>
      Array.from({ length: 48_000 }, (_, i) => ({
        order: i,
        region: ['NA', 'EU', 'APAC'][i % 3],
        amount: (i % 97) + 1,
      })),
  });

  // The consumer DECLARES its ref argument: the model passes the art_…
  // string; the framework resolves it before execute and the handler reads
  // the data. `ctx.wanted.dataset` carries the claim ticket (the meta).
  const transformReport = defineTool<{ dataset: string }, string>({
    name: 'transform_report',
    description:
      'Aggregate a stored dataset into chart data. Pass the art_… ref from get_data.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: 'artifact ref of the placed get_data result' },
      },
      required: ['dataset'],
    },
    wants: { dataset: 'tool-result/get_data' },
    execute: async (args, ctx) => {
      // args.dataset is the DATA (the placed payload is the exact text the
      // model was spared — for a placed JSON result, parse it back).
      const rows = JSON.parse(args.dataset as unknown as string) as ReadonlyArray<{
        region: string;
        amount: number;
      }>;
      const totals: Record<string, number> = {};
      for (const row of rows) totals[row.region] = (totals[row.region] ?? 0) + row.amount;
      const parent = ctx.wanted?.dataset.ref;
      const chart = await ctx.artifacts.put({
        kind: 'chart/spec',
        mediaType: 'application/json',
        data: { type: 'bar', series: totals },
        label: 'Q3 sales by region',
        ...(parent !== undefined && { parentRefs: [parent] }),
      });
      return `chart ready: ${chart.ref} [chart/spec · ${chart.bytes} bytes · parent ${parent ?? 'n/a'}]`;
    },
  });
  // #endregion tools

  // #region build
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature', { respond: dataFlowRespond }),
    model: 'mock',
    maxIterations: 6,
    artifacts, // store + placement; `present` is auto-attached
  })
    .system(
      'You analyze sales. Data travels by artifact ticket, never inline: ' +
        'get_data → transform_report({ dataset: <ref> }) → present the chart.',
    )
    .tool(getData)
    .tool(transformReport)
    .build();
  // #endregion build

  // #region record
  agent.on('agentfootprint.artifacts.*', (e) => {
    const p = e.payload as { ref?: string; kind?: string; as?: string; op?: string };
    events.push(
      `${e.type.replace('agentfootprint.artifacts.', '')}${p.kind ? ` [${p.kind}]` : ''}${
        p.as ? ` as ${p.as}` : ''
      }`,
    );
  });
  // #endregion record

  const answer = await agent.run({ message: input }, { sessionId: 'q3-analytics' });
  return `${answer}\n\nthe record: ${events.join(' → ')}`;
}

/**
 * The scripted "model": reads each ref off the PREVIOUS tool result —
 * exactly what a real model does with a claim ticket — and routes it.
 */
function dataFlowRespond(req: LLMRequest): Partial<LLMResponse> {
  const toolResults = req.messages.filter((m) => m.role === 'tool');
  const lastResult = String(toolResults.at(-1)?.content ?? '');
  const lastRef = lastResult.match(/art_[A-Za-z0-9]+/)?.[0];
  if (toolResults.length === 0) {
    return { content: '', toolCalls: [{ id: 'c1', name: 'get_data', args: {} }] };
  }
  if (toolResults.length === 1) {
    // The placed ticket named the ref; route it to the wants-tool.
    return {
      content: '',
      toolCalls: [{ id: 'c2', name: 'transform_report', args: { dataset: lastRef ?? '' } }],
    };
  }
  if (toolResults.length === 2) {
    return {
      content: '',
      toolCalls: [
        {
          id: 'c3',
          name: PRESENT_TOOL_NAME,
          args: { ref: lastRef ?? '', as: 'bar-chart', label: 'Q3 sales by region' },
        },
      ],
    };
  }
  const snapshot = lastResult.includes('"presented":true')
    ? 'the chart is on screen — rendered from the ref, not from anything I typed'
    : lastResult;
  return {
    content: `Done: ${snapshot}. The 48,000 rows never entered this conversation.`,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
