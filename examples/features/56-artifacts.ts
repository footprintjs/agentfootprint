/**
 * 56 — Artifacts: the claim-check store (`ctx.artifacts`).
 *
 * Data stops riding the conversation. `get_sales` "fetches" 5,000 rows and
 * checks them into the artifact store; the MODEL sees a ~26-char ticket and
 * one line of description — never the six hundred kilobytes. A second tool
 * redeems the ticket (`head` to decide, `get` to pay for the bytes), computes
 * a summary, and mints a DERIVED artifact whose `parentRefs` names the
 * dataset — a derivation fact validated at mint. A third tool shows expiry:
 * an artifact born with `expiresAt` stops resolving on time, and the absence
 * is stated (`null` + a `refused` event), never a silent blank.
 *
 * Every hop lands on the typed record as it happens:
 *   agentfootprint.artifacts.minted / resolved / expired / refused
 *
 * With a REAL provider the model itself routes the ticket — the ref rides
 * tool arguments. Under the mock provider the replies are scripted, so the
 * tools share the ticket through a closure; the store, the scope isolation
 * and the events are exactly the production path.
 *
 * Swap `inMemoryArtifacts()` for `fileArtifacts({ directory })` or
 * `sqliteArtifacts({ file })` and nothing else changes — that is the port.
 */

import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  type ArtifactMeta,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/56-artifacts',
  title: 'Artifacts (claim check)',
  group: 'features',
  description:
    'Tools pass DATA by reference: mint a ticket in one tool, redeem it in another, derive with parentRefs, and watch expiry state itself — all on the typed record.',
  defaultInput: 'Summarize Q3 sales',
  providerSlots: ['default'],
  tags: ['artifacts', 'claim-check', 'ctx.artifacts', 'events'],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // #region store
  // One store per agent, attached at construction — the door.
  const artifacts = inMemoryArtifacts();
  // #endregion store

  // The tickets the tools hand each other. (A real model carries these in
  // its tool arguments; the mock script cannot know a freshly minted ref.)
  const tickets: { dataset?: ArtifactMeta; summary?: ArtifactMeta } = {};

  // #region tools
  const getSales = defineTool({
    name: 'get_sales',
    description: 'Fetch the Q3 sales rows and check them into the artifact store.',
    execute: async (_args, ctx) => {
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        order: i,
        region: ['NA', 'EU', 'APAC'][i % 3],
        amount: (i % 97) + 1,
      }));
      tickets.dataset = await ctx.artifacts.put({
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: rows,
        label: 'Q3 sales rows',
        digest: 'sha-256',
        expiresAt: Date.now() + 60_000,
      });
      const t = tickets.dataset;
      // The model reads THIS line — the ticket plus enough to decide.
      return `stored ${t.ref} [${t.kind} · ${t.bytes} bytes · 5000 rows]`;
    },
  });

  const summarizeSales = defineTool({
    name: 'summarize_sales',
    description: 'Redeem the dataset ticket, total it per region, store the summary.',
    execute: async (_args, ctx) => {
      const ref = tickets.dataset?.ref ?? 'art_0000000000000000000000';
      const head = await ctx.artifacts.head(ref); // decide from meta, pay nothing
      if (head === null) return `nothing under ${ref} — expired or never stored; re-run get_sales`;
      const got = await ctx.artifacts.get(ref); // now pay for the bytes
      const rows = (got?.data ?? []) as ReadonlyArray<{ region: string; amount: number }>;
      const totals: Record<string, number> = {};
      for (const row of rows) totals[row.region] = (totals[row.region] ?? 0) + row.amount;
      tickets.summary = await ctx.artifacts.put({
        kind: 'report/summary',
        mediaType: 'application/json',
        data: totals,
        label: 'Q3 totals by region',
        parentRefs: [ref], // a derivation FACT — validated at mint
      });
      return `summary ready: ${tickets.summary.ref} [report/summary · parent ${ref}]`;
    },
  });

  const demonstrateExpiry = defineTool({
    name: 'demonstrate_expiry',
    description: 'Mint a short-lived artifact, outlive it, and read the stated absence.',
    execute: async (_args, ctx) => {
      const shortLived = await ctx.artifacts.put({
        kind: 'scratch/preview',
        mediaType: 'text/plain',
        data: 'gone in 800ms',
        expiresAt: Date.now() + 800,
      });
      await sleep(1000);
      const after = await ctx.artifacts.get(shortLived.ref);
      return after === null
        ? `${shortLived.ref} expired on schedule — a resolve now answers null, and the record shows a refused resolve (missing-or-expired)`
        : 'unexpected: still resolving';
    },
  });
  // #endregion tools

  // #region build
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature', { respond: salesRespond }),
    model: 'mock',
    maxIterations: 6,
    artifacts, // ← the whole attachment
  })
    .system(
      'You analyze sales. Data travels by artifact ticket, never inline: ' +
        'get_sales → summarize_sales, then answer with the summary ticket.',
    )
    .tool(getSales)
    .tool(summarizeSales)
    .tool(demonstrateExpiry)
    .build();
  // #endregion build

  // #region observe
  agent.on('agentfootprint.artifacts.*', (e) => {
    const p = e.payload as unknown as Record<string, unknown>;
    if (e.type.endsWith('.minted')) {
      console.log(`  🎟  minted   ${p.ref} (${p.kind}, ${p.bytes} bytes) by ${p.tool}`);
    } else if (e.type.endsWith('.resolved')) {
      console.log(`  🔓 resolved ${p.ref} via ${p.via} by ${p.tool}`);
    } else if (e.type.endsWith('.refused')) {
      console.log(`  ⛔ refused  ${p.op} (${p.reason}) by ${p.tool}`);
    } else {
      console.log(`  🕰  expired  ${p.ref} (${p.reason})`);
    }
  });
  // #endregion observe

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') {
    throw new Error('Agent paused — this example has no pauseHere tool.');
  }
  // The store's own accounting is `list` — no snapshot coupling.
  const held = await artifacts.list(
    // The demo peeks under the run's scope: an anonymous run scopes to its
    // own runId, which the origin on the minted meta names.
    { conversationId: tickets.dataset?.origin?.runId ?? 'unknown' },
  );
  console.log(
    `\n[store] still holding ${held.artifacts.length} artifact(s): ` +
      held.artifacts.map((m) => `${m.kind}`).join(', '),
  );
  return result;
}

/** Scripted turns: fetch → summarize → expiry demo → final answer. */
function salesRespond(req: LLMRequest): Partial<LLMResponse> {
  const toolTurns = req.messages.filter((m) => m.role === 'tool').length;
  if (toolTurns === 0) {
    return { content: '', toolCalls: [{ id: 'c1', name: 'get_sales', args: {} }] };
  }
  if (toolTurns === 1) {
    return { content: '', toolCalls: [{ id: 'c2', name: 'summarize_sales', args: {} }] };
  }
  if (toolTurns === 2) {
    return { content: '', toolCalls: [{ id: 'c3', name: 'demonstrate_expiry', args: {} }] };
  }
  const summaryLine = [...req.messages]
    .reverse()
    .find((m) => m.role === 'tool' && String(m.content ?? '').includes('summary ready'));
  return {
    content: `Q3 summary is checked in — ${String(summaryLine?.content ?? '').trim()}. The dataset itself never entered this conversation.`,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
