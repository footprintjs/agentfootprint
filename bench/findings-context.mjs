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
 * ## The LONG-RUN table (step 4 — standing-aware eviction)
 *
 * A second table, LONG_N calls (default 30) under the same sliding window,
 * every row ARMED and declaring except the first. It measures the ledger-fact
 * HOLD (`WindowRefusalReason 'ledger-fact'`, `stages/window.ts ·
 * buildWindowStage`): a turn the model declared a `fact` is held beyond
 * `keepRecentTurns`, newest first, up to `keepLedgerFacts`.
 *
 *   sliding                     `.findings()` off — the recency baseline
 *   sliding+findings hold=0     `.findings({ keepLedgerFacts: false })` — the
 *                               piece and the collapse, no hold: the window
 *                               plans exactly as the unarmed row (a law the
 *                               bench checks below)
 *   sliding+findings hold=4     `.findings()` — the DEFAULT ceiling
 *   sliding+findings hold=6     `.findings({ keepLedgerFacts: 6 })`
 *
 * Two columns beyond the first table's, read off `scope.compactions` (the
 * `WindowRecord`s the window stage filed, through `agent.getLastSnapshot()`):
 *
 *   facts-held        `ledgerFacts.pinned.length` on the LAST record — the
 *                     fact turns the hold kept at the visit before the answer
 *                     call (the visit whose window the answer turn was served)
 *   dropped f/o/n/r/u `droppedStandings` summed over every record: how many
 *                     evicted tool results the model had declared fact / open
 *                     / noise / ruled-out, and how many it had not declared
 *                     (`standing` absent = undeclared, never defaulted)
 *
 * and a line under the table: `yielded` on the last record (fact turns the
 * ceiling turned away) and how many visits filed `ledgerFacts.standDown`.
 * The reading the design page owes: `facts-verbatim` must RISE from the
 * `sliding` row while `noise-share` stays at the collapsed level. The
 * hold=0 law: `facts-verbatim`, `tool-msgs` and `receipt-msgs` on the hold=0
 * row equal the unarmed `sliding` row's (limit 0 plans exactly as before the
 * hold existed) — the bench exits non-zero if they differ.
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
 *       N=30 KEEP=6 npm run bench:findings        (the first table)
 *       LONG_N=60 KEEP=6 npm run bench:findings   (the long-run table)
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
const LONG_N = Number(process.env.LONG_N ?? 30);
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
 * `serve` the dial and `keepLedgerFacts` the hold's ceiling, both meaningful
 * only when armed and both handed to `.findings()` only when named, so an
 * unnamed dial is the library's default and not this file's; `calls` the
 * loop length (the first table's N, the long-run table's LONG_N).
 */
function buildAgent({ window, arm, serve, keepLedgerFacts, calls }) {
  const declaring = arm === 'declaring';
  const replies = Array.from({ length: calls }, (_, k) => ({
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
    maxIterations: calls + 2,
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
  if (arm !== 'off') {
    const options = {
      ...(serve !== undefined && { serve }),
      ...(keepLedgerFacts !== undefined && { keepLedgerFacts }),
    };
    b = b.findings(Object.keys(options).length === 0 ? undefined : options);
  }
  return b.build();
}

/** JSON chars of every `_findings` value the scripted calls carry — the emission's own bytes. */
function declaredChars(calls) {
  let chars = 0;
  for (let k = 1; k <= calls; k++) chars += JSON.stringify(declarationFor(k)).length;
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

/**
 * What the WINDOW did, read off the records the window stage filed
 * (`scope.compactions`, one `WindowRecord` per engaged visit). Facts held =
 * the `ledgerFacts` block on the LAST record, the visit whose window the
 * answer turn was served; `droppedStandings` summed over every record — a
 * result leaves once, so the sum is the count of evicted results by the
 * standing the model had declared at the time (absent = undeclared). An
 * agent with no window files no record and reads as all zeros.
 */
function windowFacts(agent) {
  const records = agent.getLastSnapshot()?.sharedState?.compactions ?? [];
  const dropped = { fact: 0, open: 0, noise: 0, 'ruled-out': 0, undeclared: 0 };
  let standDowns = 0;
  for (const r of records) {
    for (const d of r.droppedStandings ?? []) dropped[d.standing ?? 'undeclared'] += 1;
    if (r.ledgerFacts?.standDown === true) standDowns += 1;
  }
  const last = records[records.length - 1];
  return {
    visits: records.length,
    factsHeld: last?.ledgerFacts?.pinned.length ?? 0,
    factsYielded: last?.ledgerFacts?.yielded ?? 0,
    standDowns,
    dropped,
  };
}

async function measure(config) {
  const calls = config.calls ?? N;
  const agent = buildAgent({ ...config, calls });
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
  const planted = Array.from({ length: calls }, (_, k) => k + 1).filter(isFactCall).length;
  // The ledger, through the public door (`Agent.findings`): undefined when
  // the agent is unarmed or the model declared nothing — never an empty array.
  const ledger = agent.findings() ?? [];
  return {
    ...config,
    calls,
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
    declaredChars: config.arm === 'declaring' ? declaredChars(calls) : 0,
    window: config.window,
    ...windowFacts(agent),
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

/** The columns the hold's OFF position must not move against the unarmed window. */
const HOLD_OFF_LAW = ['factsVerbatim', 'toolMessagesServed', 'receiptMessages'];

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

/** The long-run table: every row under the sliding window, LONG_N calls. */
const LONG = [
  { label: 'sliding', window: 'sliding', arm: 'off', calls: LONG_N },
  {
    label: 'sliding+findings hold=0',
    window: 'sliding',
    arm: 'declaring',
    keepLedgerFacts: false,
    calls: LONG_N,
  },
  { label: 'sliding+findings hold=4', window: 'sliding', arm: 'declaring', calls: LONG_N },
  {
    label: 'sliding+findings hold=6',
    window: 'sliding',
    arm: 'declaring',
    keepLedgerFacts: 6,
    calls: LONG_N,
  },
];

const pad = (v, w) => String(v).padStart(w);

/** The first table's columns, as a list of cells, for one row. */
function cells(r) {
  const armed = r.arm !== 'off';
  return [
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
  ];
}

const HEADER = [
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
];

function printRow(r) {
  console.log([r.label.padEnd(18), ...cells(r)].join('  '));
}

/** The long-run row: the first table's columns plus what the window did. */
function printLongRow(r) {
  const d = r.dropped;
  console.log(
    [
      r.label.padEnd(24),
      ...cells(r),
      pad(r.factsHeld, 10),
      pad(`${d.fact}/${d.open}/${d.noise}/${d['ruled-out']}/${d.undeclared}`, 17),
    ].join('  '),
  );
}

async function main() {
  const rows = [];
  for (const config of TABLE) rows.push(await measure(config));
  const law = [];
  for (const config of LAW) law.push(await measure(config));
  const long = [];
  for (const config of LONG) long.push(await measure(config));

  console.log(
    `findings-context — ${N} tool calls, a fact every ${FACT_EVERY}rd, sliding window keeps ${KEEP} turns; read at the answer epoch (${rows[0].answerEpoch}) through servedAt`,
  );
  console.log(['window'.padEnd(18), ...HEADER].join('  '));
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

  console.log('');
  console.log(
    `long run — ${LONG_N} tool calls, a fact every ${FACT_EVERY}rd, sliding window keeps ${KEEP} turns; the ledger-fact hold (keepLedgerFacts) under .findings(); read at the answer epoch (${long[0].answerEpoch}) through servedAt`,
  );
  console.log(['window'.padEnd(24), ...HEADER, 'facts-held', 'dropped f/o/n/r/u'].join('  '));
  for (const r of long) printLongRow(r);
  console.log(
    `hold at the last visit: ${long
      .map(
        (r) =>
          `${r.label} held ${r.factsHeld} yielded ${r.factsYielded} stand-downs ${r.standDowns} (${r.visits} visits)`,
      )
      .join('; ')}`,
  );

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

  // The step-4 law: the hold's OFF position plans exactly as the unarmed
  // window — the same turns kept, so the same facts verbatim, the same tool
  // messages and the same receipt count; only the collapse and the piece
  // differ, and the record says no fact was held.
  const unarmed = long.find((r) => r.arm === 'off');
  const holdOff = long.find((r) => r.keepLedgerFacts === false);
  const held = [];
  for (const col of HOLD_OFF_LAW)
    if (holdOff[col] !== unarmed[col]) held.push(`${col}: ${unarmed[col]} → ${holdOff[col]}`);
  if (holdOff.factsHeld !== 0) held.push(`facts-held: ${holdOff.factsHeld}`);
  if (held.length > 0) {
    console.error(
      `step-4 law BROKEN — keepLedgerFacts: false moved the window against the unarmed row: ${held.join(
        '; ',
      )}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      'step-4 law: keepLedgerFacts: false plans exactly as the unarmed window — facts-verbatim, tool-msgs and receipt-msgs are unchanged, and no fact was held',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
