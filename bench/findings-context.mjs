/**
 * findings-context — what the ANSWER TURN is served after a long tool loop.
 *
 * The findings-ledger design (docs/design/2026-09-findings-ledger.md) claims
 * that facts found early get lost, and noise from exploration tangles with
 * them, by the time the model answers. This bench measures that claim on the
 * record, with no model judgement involved: a scripted loop of N tool calls
 * on the mock provider, some returning a planted FACT, most returning NOISE,
 * then the answer turn. It reads what the last model call was SERVED — the
 * served view at the answer epoch (`servedAt(snapshot, k)`: `system.text`,
 * `messages.asSent`, `messages.requestOnly`) and that call's receipt — and
 * counts. It never reads `history`: under step 3 history never moves (the
 * collapse is a wire-only rewrite), so a history-reading bench would report
 * "nothing moved" for a door that moved everything on the wire.
 *
 *   planted           planted facts in the loop
 *   facts-verbatim    planted facts whose result is on the wire in full — a
 *                     `role: 'tool'` message in `messages.asSent` carrying
 *                     `FACT-<k>`, not a ticket
 *   facts-in-piece    planted facts the ledger piece carries in `system.text`:
 *                     the model's assertion for node-<k>, `node/node-<k> · p95
 *                     = <value>us`, with the PLANTED value (the piece quotes
 *                     the declaration, not the tool's string, so the match is
 *                     subject + planted reading — a wrong value would not count)
 *   noise-verbatim    noise results on the wire in full
 *   noise-tickets     noise results on the wire as a collapsed ticket
 *                     (`{"collapsed":true,"standing":"noise","toolCallId":…}`,
 *                     the `CollapsedToolResult` shape of `findings/serve.ts`,
 *                     parsed here by hand: nothing exports it from a barrel)
 *   noise-share       chars of noise results served IN FULL, over all chars of
 *                     all tool messages on the wire — verbatim results AND
 *                     tickets, so the denominator carries the tickets' cost
 *   wire-tool-bytes   that denominator, printed so the share can be read
 *   tool-msgs         `role: 'tool'` messages in `messages.asSent` (the
 *                     collapse never drops one, so this equals the unarmed
 *                     count by law)
 *   receipt-msgs      the receipt's own count for that call
 *
 * The step-2 columns (`basis-rows`, `standings`, `conflicts`, `declared-chars`)
 * are unchanged; `extra-output-tokens` is dropped: it was 0 by construction of
 * the MOCK (`MockProvider · buildResponse` estimates content chars / 4 and does
 * not count tool-call args, where the declarations ride), which the step-2
 * reading on the design page records. The token price of the ask is a
 * real-model number and is measured nowhere on the mock.
 *
 * Five rows, one loop:
 *
 *   none               everything kept, `.findings()` off
 *   sliding            a sliding window keeping the recent turns — eviction by
 *                      recency, not by standing — `.findings()` off
 *   none+findings      `.findings()` on, the mock's scripted calls carrying
 *                      `_findings` (a basis on every call; on every call after
 *                      the first, the previous result's standing — `fact` with
 *                      one assertion for a planted fact, `noise` for noise);
 *                      the default `serve: 'ledger-and-facts'`
 *   sliding+findings   the same under the window
 *   none+ledger-only   `.findings({ serve: 'ledger-only' })` — the BENCH-GATED
 *                      dial: fact results collapse too and the model answers
 *                      from the piece. Never a default until the SHUFFLE run on
 *                      a real model (`bench/findings-shuffle.mjs`).
 *
 * The step-2 law, kept as its own check: with `.findings()` ARMED but the
 * script declaring NOTHING (`silent`), the six baseline columns — planted,
 * facts-verbatim, noise-verbatim, noise-share, tool-msgs, receipt-msgs — must
 * not move against the unarmed twin under either window: a basis-only or
 * empty ledger serves today's bytes plus the instruction. The bench runs the
 * two silent twins and exits non-zero if any of the six moved.
 *
 * The mock SCRIPTS compliance: every armed call declares. Whether a real
 * model declares, and what it costs in tokens, is measured only on a real
 * model (the SHUFFLE harness). No output schema is set, so the LAST batch's
 * standing is absent by law (undeclared, never `open`): `standings` is N − 1
 * by construction, and the last result is served in full on every row.
 *
 * Run:  npm run build && npm run bench:findings   (N defaults to 20, facts every 3rd)
 *       Plain JS on node, like docs-next's generators: the package's own doors
 *       by self-reference, so `npm run build` must be current (the build
 *       deletes dist/ first — build BEFORE any suite that walks dist/esm).
 *       N=30 KEEP=6 npm run bench:findings
 */
// The package's own doors, by self-reference (the built dist — this is an
// ES module and the sources are CommonJS-typed): run `npm run build` first.
import {
  Agent,
  defineTool,
  epochLocations,
  receiptAt,
  servedAt,
  slidingWindow,
} from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { recordRun } from 'agentfootprint/observe';

const N = Number(process.env.N ?? 20);
const KEEP = Number(process.env.KEEP ?? 6);
const FACT_EVERY = 3;

const isFactCall = (i) => i % FACT_EVERY === 0;
const plantedReading = (i) => `${1000 + i * 7}us`;
const factValue = (i) => `FACT-${i} node-${i} p95 ${plantedReading(i)}`;
const noiseValue = (i) => `NOISE-${i} ${'unrelated inventory row '.repeat(6)}#${i}`;

/**
 * The `_findings` value the scripted call k (1-based) carries when the arm is
 * `declaring`: a basis for THIS call, and the standing of the PREVIOUS call's
 * result — the shape the ask (`findings/reserved.ts · FINDINGS_INSTRUCTION`)
 * describes. A planted fact is stood on with one assertion whose value is the
 * planted reading; a noise result is `noise` with nothing. The last call's
 * result is never named: there is no output schema, so no answer-turn
 * declaration.
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
            value: plantedReading(prev),
          },
        ],
      }
    : { toolCallId: `c${prev}`, standing: 'noise', sought: false };
  return { ...basis, previous: [previous] };
}

/**
 * One configuration: `window` 'none' | 'sliding'; `arm` 'off' (no
 * `.findings()`), 'silent' (`.findings()` on, the script declares nothing)
 * or 'declaring' (`.findings()` on, every call carries `_findings`);
 * `serve` the dial, meaningful only when armed.
 */
function buildAgent({ window, arm, serve }) {
  const declaring = arm === 'declaring';
  const replies = Array.from({ length: N }, (_, k) => ({
    toolCalls: [
      {
        id: `c${k + 1}`,
        name: isFactCall(k + 1) ? 'probe_fact' : 'probe_noise',
        args: declaring ? { i: k + 1, _findings: declarationFor(k + 1) } : { i: k + 1 },
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
  if (arm !== 'off') b = b.findings(serve === undefined ? undefined : { serve });
  return b.build();
}

/** JSON chars of every `_findings` value the scripted calls carry — the emission's own bytes. */
function declaredChars() {
  let chars = 0;
  for (let k = 1; k <= N; k++) chars += JSON.stringify(declarationFor(k)).length;
  return chars;
}

const text = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

/**
 * A collapsed tool result's ticket, or `undefined`: the `CollapsedToolResult`
 * shape `findings/serve.ts · collapseJudged` mints (`{ collapsed: true,
 * standing, toolCallId, ref? }`), read by hand because no barrel exports
 * `isCollapsedToolResult` (the docs-truth ratchet counts every root export).
 */
function ticketOf(t) {
  if (!t.startsWith('{')) return undefined;
  try {
    const v = JSON.parse(t);
    return v !== null &&
      typeof v === 'object' &&
      v.collapsed === true &&
      typeof v.standing === 'string' &&
      typeof v.toolCallId === 'string'
      ? v
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the ANSWER TURN was served, read off the served view at the last
 * epoch: the answer is the last model call, so the last of `epochLocations`
 * is its epoch, `servedAt` rebuilds the wire it was handed, and `receiptAt`
 * reads the receipt that call minted.
 */
function servedAtAnswerTurn(snapshot) {
  const locations = epochLocations(snapshot);
  const answerEpoch = locations[locations.length - 1]?.epoch;
  const view = answerEpoch === undefined ? undefined : servedAt(snapshot, answerEpoch);
  if (view === undefined) throw new Error('no served view at the answer turn');
  return {
    epoch: answerEpoch,
    systemText: view.system.text,
    asSent: view.messages.asSent,
    requestOnly: view.messages.requestOnly,
    receiptMessages: receiptAt(snapshot, answerEpoch)?.messages?.count,
  };
}

/** The planted facts whose assertion, with the PLANTED value, the piece carries. */
function factsInPiece(systemText) {
  const found = new Set();
  for (const m of systemText.matchAll(/node\/node-(\d+) · p95 = (\d+us)/g)) {
    const k = Number(m[1]);
    if (isFactCall(k) && m[2] === plantedReading(k)) found.add(k);
  }
  return found.size;
}

async function measure(config) {
  const agent = buildAgent(config);
  const rec = recordRun(agent);
  await agent.run({ message: 'Which nodes have the highest p95?' });
  const recording = rec.toRecording();
  rec.stop();
  const served = servedAtAnswerTurn(recording.snapshot);
  const toolMsgs = served.asSent.filter((m) => m.role === 'tool');
  const factsVerbatim = new Set();
  let noiseVerbatim = 0;
  const tickets = { fact: 0, open: 0, noise: 0, 'ruled-out': 0 };
  let noiseChars = 0;
  let wireToolBytes = 0;
  for (const m of toolMsgs) {
    const t = text(m);
    wireToolBytes += t.length;
    const ticket = ticketOf(t);
    if (ticket !== undefined) {
      tickets[ticket.standing] = (tickets[ticket.standing] ?? 0) + 1;
      continue;
    }
    const f = t.match(/FACT-(\d+)/);
    if (f) factsVerbatim.add(f[1]);
    else if (/NOISE-\d+/.test(t)) {
      noiseVerbatim += 1;
      noiseChars += t.length;
    }
  }
  const planted = Array.from({ length: N }, (_, k) => k + 1).filter(isFactCall).length;
  // The ledger, through the public door (`Agent.findings`): undefined when
  // the agent is unarmed or the model declared nothing — never an empty array.
  const ledger = agent.findings() ?? [];
  return {
    ...config,
    planted,
    factsVerbatim: factsVerbatim.size,
    factsInPiece: factsInPiece(served.systemText),
    noiseVerbatim,
    noiseTickets: tickets.noise,
    factTickets: tickets.fact,
    noiseShare: wireToolBytes === 0 ? 0 : noiseChars / wireToolBytes,
    wireToolBytes,
    toolMessagesServed: toolMsgs.length,
    receiptMessages: served.receiptMessages,
    requestOnlyLines: served.requestOnly.length,
    answerEpoch: served.epoch,
    basisRows: ledger.filter((r) => r.kind === 'basis').length,
    standings: new Set(ledger.filter((r) => r.kind === 'standing').map((r) => r.toolCallId)).size,
    conflictRows: ledger.filter((r) => r.kind === 'conflict').length,
    declaredChars: config.arm === 'declaring' ? declaredChars() : 0,
  };
}

/** The six baseline columns — the ones an armed-but-silent agent must not move. */
const BASELINE = [
  'planted',
  'factsVerbatim',
  'noiseVerbatim',
  'noiseShare',
  'toolMessagesServed',
  'receiptMessages',
];

const TABLE = [
  { label: 'none', window: 'none', arm: 'off' },
  { label: 'sliding', window: 'sliding', arm: 'off' },
  { label: 'none+findings', window: 'none', arm: 'declaring' },
  { label: 'sliding+findings', window: 'sliding', arm: 'declaring' },
  { label: 'none+ledger-only', window: 'none', arm: 'declaring', serve: 'ledger-only' },
];

const LAW = [
  { label: 'none+silent', window: 'none', arm: 'silent' },
  { label: 'sliding+silent', window: 'sliding', arm: 'silent' },
];

const pad = (v, w) => String(v).padStart(w);

function printRow(r) {
  const armed = r.arm !== 'off';
  console.log(
    [
      r.label.padEnd(18),
      pad(r.planted, 7),
      pad(r.factsVerbatim, 14),
      pad(r.factsInPiece, 14),
      pad(r.noiseVerbatim, 14),
      pad(r.noiseTickets, 13),
      pad(`${(r.noiseShare * 100).toFixed(1)}%`, 11),
      pad(r.wireToolBytes, 15),
      pad(r.toolMessagesServed, 9),
      pad(r.receiptMessages ?? '?', 12),
      pad(armed ? r.basisRows : '-', 10),
      pad(armed ? r.standings : '-', 9),
      pad(armed ? r.conflictRows : '-', 9),
      pad(r.arm === 'declaring' ? r.declaredChars : '-', 14),
    ].join('  '),
  );
}

async function main() {
  const rows = [];
  for (const config of TABLE) rows.push(await measure(config));
  const law = [];
  for (const config of LAW) law.push(await measure(config));

  console.log(
    `findings-context — ${N} tool calls, a fact every ${FACT_EVERY}rd, sliding window keeps ${KEEP} turns; read at the answer epoch (${rows[0].answerEpoch}) through servedAt`,
  );
  console.log(
    [
      'window'.padEnd(18),
      'planted',
      'facts-verbatim',
      'facts-in-piece',
      'noise-verbatim',
      'noise-tickets',
      'noise-share',
      'wire-tool-bytes',
      'tool-msgs',
      'receipt-msgs',
      'basis-rows',
      'standings',
      'conflicts',
      'declared-chars',
    ].join('  '),
  );
  for (const r of rows) printRow(r);
  console.log(
    `request-only lines at the answer turn: ${rows
      .map((r) => `${r.label} ${r.requestOnlyLines}`)
      .join(', ')}`,
  );
  const ledgerOnly = rows.find((r) => r.serve === 'ledger-only');
  if (ledgerOnly !== undefined) {
    console.log(
      `ledger-only: ${ledgerOnly.factTickets} fact results on the wire as tickets, ${ledgerOnly.factsVerbatim} in full`,
    );
  }

  // Correctness: with no window, every call's result is on the wire at the
  // answer turn — in full or as a ticket; the collapse never drops a message.
  for (const r of rows.filter((x) => x.window === 'none')) {
    if (r.toolMessagesServed !== N) {
      console.error(
        `correctness: expected ${N} tool messages on the wire for ${r.label}, saw ${r.toolMessagesServed}`,
      );
      process.exitCode = 1;
    }
  }

  // The step-2 law: armed but silent serves the unarmed bytes.
  const moved = [];
  for (const r of law) {
    const twin = rows.find((t) => t.window === r.window && t.arm === 'off');
    for (const col of BASELINE)
      if (r[col] !== twin[col]) moved.push(`${r.label}.${col}: ${twin[col]} → ${r[col]}`);
  }
  if (moved.length > 0) {
    console.error(
      `step-2 law BROKEN — baseline columns moved under .findings() with nothing declared: ${moved.join(
        '; ',
      )}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      'step-2 law: .findings() armed with nothing declared serves the unarmed bytes — the six baseline columns are unchanged (none, sliding)',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
