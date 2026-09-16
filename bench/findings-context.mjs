/**
 * findings-context — what the ANSWER TURN is served after a long tool loop.
 *
 * The findings-ledger design (docs/design/2026-09-findings-ledger.md) claims
 * that facts found early get lost, and noise from exploration tangles with
 * them, by the time the model answers. This bench measures that claim on the
 * record, with no model judgement involved: a scripted loop of N tool calls
 * on the mock provider, some returning a planted FACT, most returning NOISE,
 * then the answer turn. It reads what the last model call was served — the
 * final state's `history` minus the reply that call appended, and the last
 * receipt's message count — and counts.
 *
 *   planted facts present   how many planted facts a reader of the served
 *                           context could still find at the answer turn
 *   noise present           how many noise results are still in the context
 *   noise share             noise chars / all tool-result chars served
 *   messages served         the receipt's own count for that call
 *
 * Two configurations, same loop: everything kept (no window), and a sliding
 * window that keeps the recent turns — the eviction the library does today,
 * by recency, not by standing. Built with agentfootprint + footprintjs alone.
 *
 * Run:  npm run build && npm run bench:findings   (N defaults to 20, facts every 3rd)
 *       Plain JS on node, like docs-next's generators: the package's own doors
 *       by self-reference, so `npm run build` must be current.
 *       N=30 KEEP=6 npm run bench:findings
 */
// The package's own doors, by self-reference (the built dist — this is an
// ES module and the sources are CommonJS-typed): run `npm run build` first.
import { Agent, defineTool, slidingWindow } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { recordRun } from 'agentfootprint/observe';

const N = Number(process.env.N ?? 20);
const KEEP = Number(process.env.KEEP ?? 6);
const FACT_EVERY = 3;

const isFactCall = (i) => i % FACT_EVERY === 0;
const factValue = (i) => `FACT-${i} node-${i} p95 ${1000 + i * 7}us`;
const noiseValue = (i) =>
  `NOISE-${i} ${'unrelated inventory row '.repeat(6)}#${i}`;

function buildAgent(window) {
  const replies = Array.from({ length: N }, (_, k) => ({
    toolCalls: [
      {
        id: `c${k + 1}`,
        name: isFactCall(k + 1) ? 'probe_fact' : 'probe_noise',
        args: { i: k + 1 },
      },
    ],
  }));
  let b = Agent.create({
    provider: mock({ replies: [...replies, { content: 'answer' }] }),
    model: 'mock',
    maxIterations: N + 2,
  })
    .tool(
      defineTool({
        name: 'probe_fact',
        description: 'A probe that returns a planted fact.',
        inputSchema: { type: 'object', properties: { i: { type: 'number' } } },
        execute: async (a) => factValue(a.i),
      }),
    )
    .tool(
      defineTool({
        name: 'probe_noise',
        description: 'A probe that returns unrelated data.',
        inputSchema: { type: 'object', properties: { i: { type: 'number' } } },
        execute: async (a) => noiseValue(a.i),
      }),
    );
  if (window === 'sliding') b = b.window(slidingWindow({ keepRecentTurns: KEEP }));
  return b.build();
}


/**
 * What the ANSWER TURN was served, read off the final state: the receipt on
 * the state is the last model call's (its `messages.count` is the served
 * count), and `history` is what that call left behind — minus the reply it
 * appended, which is the answer itself.
 */
function servedAtAnswerTurn(sharedState) {
  const history = [...(sharedState.history ?? [])];
  while (history.length > 0 && history[history.length - 1].role === 'assistant') history.pop();
  return { history, receiptMessages: sharedState.receipt?.messages?.count };
}

async function measure(window) {
  const agent = buildAgent(window);
  const rec = recordRun(agent);
  await agent.run({ message: 'Which nodes have the highest p95?' });
  const recording = rec.toRecording();
  rec.stop();
  const served = servedAtAnswerTurn(recording.snapshot.sharedState);
  const toolMsgs = served.history.filter((m) => m.role === 'tool');
  const text = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
  const factsPresent = new Set();
  let noisePresent = 0;
  let factChars = 0;
  let noiseChars = 0;
  for (const m of toolMsgs) {
    const t = text(m);
    const f = t.match(/FACT-(\d+)/);
    if (f) {
      factsPresent.add(f[1]);
      factChars += t.length;
    } else if (/NOISE-\d+/.test(t)) {
      noisePresent += 1;
      noiseChars += t.length;
    }
  }
  const planted = Array.from({ length: N }, (_, k) => k + 1).filter(isFactCall).length;
  return {
    window,
    planted,
    factsPresent: factsPresent.size,
    noisePresent,
    noiseShare: factChars + noiseChars === 0 ? 0 : noiseChars / (factChars + noiseChars),
    toolMessagesServed: toolMsgs.length,
    receiptMessages: served.receiptMessages,
  };
}

async function main() {
const rows = [await measure('none'), await measure('sliding')];
console.log(`findings-context — ${N} tool calls, a fact every ${FACT_EVERY}rd, sliding window keeps ${KEEP} turns`);
console.log('window   planted  facts-present  noise-present  noise-share  tool-msgs-served  receipt-msgs');
for (const r of rows) {
  console.log(
    `${r.window.padEnd(8)} ${String(r.planted).padStart(7)}  ${String(r.factsPresent).padStart(13)}  ${String(r.noisePresent).padStart(13)}  ${(r.noiseShare * 100).toFixed(1).padStart(10)}%  ${String(r.toolMessagesServed).padStart(16)}  ${String(r.receiptMessages ?? '?').padStart(12)}`,
  );
}
// Correctness: with no window, every call's result is served at the answer turn.
const none = rows[0];
if (none.toolMessagesServed !== N) {
  console.error(`correctness: expected ${N} tool messages served with no window, saw ${none.toolMessagesServed}`);
  process.exitCode = 1;
}
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
