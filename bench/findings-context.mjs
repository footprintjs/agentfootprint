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
 * STEP 2 (9.101.0) — each configuration runs twice: unarmed, and ARMED with
 * `.findings()` while the mock's scripted calls carry `_findings` (a basis on
 * every call; on every call after the first, the previous result's standing —
 * `fact` with one assertion for a planted fact, `noise` for noise). The law
 * this bench holds for step 2: the six baseline columns above must NOT move
 * under the arm (the ledger is a record, nothing is served differently yet);
 * the bench compares the armed row with its unarmed twin and exits non-zero
 * if any of the six moved. Four columns are added for the armed rows:
 *
 *   calls with a basis        `basis` rows on `agent.findings()`
 *   results with a standing   distinct tool_result ids with a `standing` row
 *   conflict rows             `conflict` rows (two stood-on readings disagree)
 *   extra output tokens       `totalOutputTokens` armed minus unarmed — the
 *                             MOCK'S estimate (`MockProvider · buildResponse`:
 *                             content chars / 4; tool-call args are not
 *                             counted), so it says what the mock says
 *   declared chars            JSON chars of the `_findings` values the
 *                             scripted calls carried — the size the
 *                             declarations added to the emission, by count
 *
 * The mock SCRIPTS compliance: every armed call declares. Whether a real
 * model declares, and what it costs in tokens, is measured only on a real
 * model (the SHUFFLE run planned for step 3). No output schema is set, so
 * the LAST batch's standing is absent by law (undeclared, never `open`):
 * `results with a standing` is N − 1 by construction.
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
const noiseValue = (i) => `NOISE-${i} ${'unrelated inventory row '.repeat(6)}#${i}`;

/**
 * The `_findings` value the scripted call k (1-based) carries when armed: a
 * basis for THIS call, and the standing of the PREVIOUS call's result — the
 * shape the ask (`findings/reserved.ts · FINDINGS_INSTRUCTION`) describes.
 * A planted fact is stood on with one assertion whose value is the planted
 * reading; a noise result is `noise` with nothing. The last call's result is
 * never named: there is no output schema, so no answer-turn declaration.
 */
function declarationFor(k) {
  const basis = isFactCall(k)
    ? { basis: 'direct', expect: 'high' }
    : { basis: 'exploratory', expect: 'low' };
  if (k === 1) return basis;
  const prev = k - 1;
  const previous = isFactCall(prev)
    ? {
        toolCallId: `c${prev}`,
        standing: 'fact',
        sought: true,
        assertions: [
          {
            subject: { kind: 'node', id: `node-${prev}` },
            predicate: 'p95',
            value: `${1000 + prev * 7}us`,
          },
        ],
      }
    : { toolCallId: `c${prev}`, standing: 'noise', sought: false };
  return { ...basis, previous: [previous] };
}

function buildAgent(window, armed) {
  const replies = Array.from({ length: N }, (_, k) => ({
    toolCalls: [
      {
        id: `c${k + 1}`,
        name: isFactCall(k + 1) ? 'probe_fact' : 'probe_noise',
        args: armed ? { i: k + 1, _findings: declarationFor(k + 1) } : { i: k + 1 },
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
  if (armed) b = b.findings();
  return b.build();
}

/** JSON chars of every `_findings` value the scripted calls carry — the emission's own bytes. */
function declaredChars() {
  let chars = 0;
  for (let k = 1; k <= N; k++) chars += JSON.stringify(declarationFor(k)).length;
  return chars;
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

async function measure(window, armed) {
  const agent = buildAgent(window, armed);
  const rec = recordRun(agent);
  await agent.run({ message: 'Which nodes have the highest p95?' });
  const recording = rec.toRecording();
  rec.stop();
  const state = recording.snapshot.sharedState;
  const served = servedAtAnswerTurn(state);
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
  // The ledger, through the public door (`Agent.findings`): undefined when
  // the agent is unarmed or the model declared nothing — never an empty array.
  const ledger = agent.findings() ?? [];
  return {
    window,
    armed,
    planted,
    factsPresent: factsPresent.size,
    noisePresent,
    noiseShare: factChars + noiseChars === 0 ? 0 : noiseChars / (factChars + noiseChars),
    toolMessagesServed: toolMsgs.length,
    receiptMessages: served.receiptMessages,
    outputTokens: state.totalOutputTokens,
    callsWithBasis: ledger.filter((r) => r.kind === 'basis').length,
    resultsWithStanding: new Set(
      ledger.filter((r) => r.kind === 'standing').map((r) => r.toolCallId),
    ).size,
    conflictRows: ledger.filter((r) => r.kind === 'conflict').length,
    declaredChars: armed ? declaredChars() : 0,
  };
}

/** The six baseline columns — the ones step 2 must not move. */
const BASELINE = [
  'planted',
  'factsPresent',
  'noisePresent',
  'noiseShare',
  'toolMessagesServed',
  'receiptMessages',
];

async function main() {
  const rows = [];
  for (const window of ['none', 'sliding']) {
    rows.push(await measure(window, false));
    rows.push(await measure(window, true));
  }
  console.log(
    `findings-context — ${N} tool calls, a fact every ${FACT_EVERY}rd, sliding window keeps ${KEEP} turns`,
  );
  console.log(
    'window           planted  facts-present  noise-present  noise-share  tool-msgs-served  receipt-msgs  calls-with-a-basis  results-with-a-standing  conflict-rows  extra-output-tokens  declared-chars',
  );
  for (const r of rows) {
    const twin = rows.find((t) => t.window === r.window && !t.armed);
    const label = r.armed ? `${r.window}+findings` : r.window;
    const armedCols = r.armed
      ? `${String(r.callsWithBasis).padStart(18)}  ${String(r.resultsWithStanding).padStart(
          23,
        )}  ${String(r.conflictRows).padStart(13)}  ${String(
          r.outputTokens - twin.outputTokens,
        ).padStart(19)}  ${String(r.declaredChars).padStart(14)}`
      : `${'-'.padStart(18)}  ${'-'.padStart(23)}  ${'-'.padStart(13)}  ${'-'.padStart(
          19,
        )}  ${'-'.padStart(14)}`;
    console.log(
      `${label.padEnd(16)} ${String(r.planted).padStart(7)}  ${String(r.factsPresent).padStart(
        13,
      )}  ${String(r.noisePresent).padStart(13)}  ${(r.noiseShare * 100)
        .toFixed(1)
        .padStart(10)}%  ${String(r.toolMessagesServed).padStart(16)}  ${String(
        r.receiptMessages ?? '?',
      ).padStart(12)}  ${armedCols}`,
    );
  }
  // Correctness: with no window, every call's result is served at the answer turn.
  const none = rows.find((r) => r.window === 'none' && !r.armed);
  if (none.toolMessagesServed !== N) {
    console.error(
      `correctness: expected ${N} tool messages served with no window, saw ${none.toolMessagesServed}`,
    );
    process.exitCode = 1;
  }
  // The step-2 law: the arm changes the record, never what is served.
  const moved = [];
  for (const r of rows.filter((x) => x.armed)) {
    const twin = rows.find((t) => t.window === r.window && !t.armed);
    for (const col of BASELINE)
      if (r[col] !== twin[col]) moved.push(`${r.window}.${col}: ${twin[col]} → ${r[col]}`);
  }
  if (moved.length > 0) {
    console.error(
      `step-2 law BROKEN — baseline columns moved under .findings(): ${moved.join('; ')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      'step-2 law: the six baseline columns are unchanged under .findings() (none, sliding)',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
