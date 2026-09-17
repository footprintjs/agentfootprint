/**
 * findings-shuffle — is the SERVED ledger a sufficient statistic of the evidence?
 *
 * The findings-ledger design (docs/design/2026-09-findings-ledger.md, step 3)
 * ships a `serve` dial on `.findings()`: `'ledger-and-facts'` (the default —
 * judged noise and ruled-out results collapse to tickets on the wire, facts
 * stay verbatim) and `'ledger-only'` (fact results collapse too, and the model
 * answers from the ledger piece: its own declared assertions). The second may
 * never become a default until a run on a REAL model shows that the answer
 * does not depend on the ORDER the evidence arrived in: if the served ledger
 * is a sufficient statistic of the evidence, the same evidence in a different
 * order yields the same answer; if the answer drifts with the order, it is
 * not (the spec's law: "an answer that drifts under shuffled evidence means
 * it is not"). This harness is that run, checked in so the number comes from
 * here and nowhere else.
 *
 * WHAT IT DOES. One task: a survey of records read one at a time through a
 * paging tool (`next_record`). FACTS of the records are planted p95 readings
 * (`node-<i>: <value>us`), NOISE of them are unrelated inventory rows
 * (`SKU-<n>`); the question asks for every node's reading. Every run serves
 * the SAME records in an order drawn from a seeded PRNG — run r's order is
 * the same in every condition (a paired comparison; the seed is printed, and
 * `AF_SHUFFLE_SEED` reproduces it) — and the model answers. Three
 * conditions, RUNS runs each:
 *
 *   findings off       `.findings()` not called — the wire as it is today
 *   ledger-and-facts   `.findings({ serve: 'ledger-and-facts' })` — the default dial
 *   ledger-only        `.findings({ serve: 'ledger-only' })` — the bench-gated dial
 *
 * Each final answer is scored on the record, with no model as judge:
 *
 *   facts-in-answer   planted facts whose node id AND value the answer states,
 *                     over FACTS; the mean over runs
 *   noise-cited       1 when the answer names ANY planted noise value (an SKU),
 *                     else 0; the mean over runs = the share of runs that cited noise
 *   declared          results with a `standing` row on `agent.findings()` that
 *                     named a real result, over the records served; armed rows only.
 *                     The compliance signal without which the other columns cannot
 *                     be read: a model that never declares serves an empty ledger
 *                     under `'ledger-only'`. Standing rows whose id named no result
 *                     (`unknownId`) are counted apart and printed when non-zero —
 *                     the design page's second provider assumption (the model sees
 *                     tool_result ids) is what that count tests on a real wire.
 *   drift             distinct NORMALISED answers over runs. The normal form is
 *                     the CLAIM SET the answer makes — every `node-<i>` it names
 *                     with the value it gives, plus every SKU it cites, sorted —
 *                     so wording and order do not count and content does.
 *                     1/runs = every order gave the same claims.
 *
 * PROVIDERS. `AF_SHUFFLE_PROVIDER=mock` (the default) SCRIPTS the model: it
 * declares a basis on every call and the previous result's standing (a fact
 * with one assertion, or noise), and its answer ECHOES every reading and
 * every SKU it can find in what it was served (the system prompt and the
 * tool messages). So on the mock the columns measure the HARNESS and the
 * wire, not a model: with findings off the echo cites every fact and every
 * SKU; once the step 3 wire collapses judged results, `noise-cited` on the
 * armed rows is what the wire withheld and `facts-in-answer` under
 * `'ledger-only'` is what the ledger piece carried. `AF_SHUFFLE_PROVIDER=
 * ollama` runs a real local model through the package's own `ollama()`
 * factory (`agentfootprint/providers`): `AF_SHUFFLE_MODEL` is required, and
 * `OLLAMA_HOST` is read by the provider itself (`OllamaProvider · resolveBaseUrl`;
 * default http://localhost:11434). The agent runs at `temperature: 0` so
 * that drift is the order's, not the sampler's. Nothing this file prints on
 * the mock is a claim about a model, and no number is quoted anywhere before
 * a real-model run prints it.
 *
 * Planting duplicates `bench/findings-context.mjs`'s shape (a node's p95 as
 * the fact, an inventory row as the noise) rather than importing it: that
 * bench runs its `main()` at module load and exports nothing.
 *
 * Run:  npm run build && node bench/findings-shuffle.mjs
 *       AF_SHUFFLE_SEED=7 RUNS=10 FACTS=6 NOISE=12 node bench/findings-shuffle.mjs
 *       AF_SHUFFLE_PROVIDER=ollama AF_SHUFFLE_MODEL=qwen3 OLLAMA_HOST=http://localhost:11434 \
 *         RUNS=5 node bench/findings-shuffle.mjs
 *       AF_SHUFFLE_VERBOSE=1 prints every run's order, answer and claim set.
 *       Plain JS on node, the package's own doors by self-reference — `npm run
 *       build` must be current (the build deletes dist/ first: build BEFORE any
 *       suite that walks dist/esm, never beside it).
 */
// The package's own doors, by self-reference (the built dist — this is an
// ES module and the sources are CommonJS-typed): run `npm run build` first.
import { Agent, defineTool } from 'agentfootprint';
import { mock, ollama } from 'agentfootprint/providers';

const PROVIDER = process.env.AF_SHUFFLE_PROVIDER ?? 'mock';
const MODEL = process.env.AF_SHUFFLE_MODEL;
const SEED = Number(process.env.AF_SHUFFLE_SEED ?? 20260916);
const RUNS = Number(process.env.RUNS ?? 5);
const FACTS = Number(process.env.FACTS ?? 6);
const NOISE = Number(process.env.NOISE ?? 12);
const VERBOSE = process.env.AF_SHUFFLE_VERBOSE === '1';
const N = FACTS + NOISE;

const CONDITIONS = [
  { label: 'findings off', armed: false },
  { label: 'ledger-and-facts', armed: true, serve: 'ledger-and-facts' },
  { label: 'ledger-only', armed: true, serve: 'ledger-only' },
];

const QUESTION =
  `A survey of ${N} records is available through next_record. Read every record — call ` +
  'next_record with cursor 0, then with the `next` cursor each result names, until it says the ' +
  'survey is exhausted. Then answer: what is the p95 latency reading of every node in the survey? ' +
  'Name each node id and its reading.';

// ─── The planted evidence ──────────────────────────────────────────────

/**
 * The records: FACTS readings the question is about, NOISE rows it is not.
 * Nothing in a record's text says which it is — the harness knows by
 * construction, a model has to tell.
 */
function plantRecords() {
  const records = [];
  for (let i = 1; i <= FACTS; i++) {
    const value = String(1000 + i * 7);
    records.push({
      kind: 'fact',
      node: `node-${i}`,
      value,
      text: `p95 latency reading — node-${i}: ${value}us (survey probe)`,
    });
  }
  for (let j = 1; j <= NOISE; j++) {
    const sku = `SKU-${8000 + j * 13}`;
    records.push({
      kind: 'noise',
      sku,
      text: `inventory row — ${sku}, qty ${j * 5}, bin B${j} (warehouse ledger)`,
    });
  }
  return records;
}

/** mulberry32 — a small seeded PRNG, so every order is reproducible from the printed seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run r's order: a Fisher–Yates shuffle of the record indices from (seed, r).
 * The SAME order for run r in every condition, so the conditions are compared
 * on the same evidence in the same sequence.
 */
function orderFor(run) {
  const rng = mulberry32((SEED ^ Math.imul(run + 1, 0x9e3779b1)) >>> 0);
  const order = Array.from({ length: N }, (_, k) => k);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The paging tool: cursor k serves the k-th record OF THIS RUN'S ORDER, so the
 * model reads the same records every run and meets them in a different
 * sequence. Out of range = exhausted; it never serves a record twice under
 * one cursor and never serves anything the plant does not hold.
 */
function pagingTool(records, order) {
  return defineTool({
    name: 'next_record',
    description:
      'Reads one record of the survey. Pass cursor 0 for the first record, then the `next` ' +
      'cursor the previous result names; the result says when the survey is exhausted.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: {
          type: 'integer',
          description: "The record to read: 0 first, then the previous result's `next`.",
        },
      },
    },
    execute: async (a) => {
      const k = Number(a.cursor ?? 0);
      if (!Number.isInteger(k) || k < 0 || k >= N) {
        return `survey exhausted: no record at cursor ${String(
          a.cursor,
        )}; the ${N} records are at cursors 0 to ${N - 1}`;
      }
      const r = records[order[k]];
      return `${r.text}\nnext: ${k + 1}; records remaining after this one: ${N - k - 1}`;
    },
  });
}

// ─── Reading a reading ─────────────────────────────────────────────────

/** A node id and a value in ONE line of served text — a record, or a ledger-piece fact line. */
function readingIn(line) {
  const node = /node-(\d+)\b/.exec(line);
  const value = /\b(\d+)\s*us\b/.exec(line);
  return node && value ? { node: `node-${node[1]}`, value: value[1] } : undefined;
}

// ─── The scripted model (mock) ─────────────────────────────────────────

/**
 * The `_findings` value the scripted call k carries: a basis for THIS call
 * (a paging read expects its record: `direct` / `medium` on every call) and,
 * from the second call on, the standing of the PREVIOUS result — read off the
 * last `role: 'tool'` message the model was served (always verbatim: a result
 * is undeclared until this very declaration). A reading is stood on with one
 * assertion; anything else is `noise`. The last result is never named: no
 * output schema, so no answer-turn declaration (the last-batch law).
 */
function declarationFor(req, k) {
  const basis = { basis: 'direct', expect: 'medium' };
  if (k === 1) return basis;
  const last = [...req.messages].reverse().find((m) => m.role === 'tool');
  if (last === undefined || last.toolCallId === undefined) return basis;
  const reading = readingIn(last.content);
  const previous = reading
    ? {
        toolCallId: last.toolCallId,
        standing: 'fact',
        sought: true,
        assertions: [
          {
            subject: { kind: 'node', id: reading.node },
            predicate: 'p95',
            value: `${reading.value}us`,
          },
        ],
      }
    : { toolCallId: last.toolCallId, standing: 'noise', sought: false };
  return { ...basis, previous: [previous] };
}

/**
 * The scripted answer: every reading and every SKU visible in what the model
 * was SERVED — the system prompt (where the ledger piece lands once the wire
 * serves it) and the tool messages (verbatim results; a collapsed ticket
 * carries no value). An echo, so the columns say what the wire served.
 */
function echoAnswer(req) {
  const served = [
    req.systemPrompt ?? '',
    ...req.messages.filter((m) => m.role === 'tool').map((m) => m.content),
  ].join('\n');
  const claims = new Map();
  const skus = new Set();
  for (const line of served.split('\n')) {
    const reading = readingIn(line);
    if (reading) claims.set(reading.node, reading.value);
    for (const m of line.matchAll(/SKU-\d+/g)) skus.add(m[0]);
  }
  const parts = [...claims].map(([node, value]) => `${node}: ${value}us`);
  if (skus.size > 0) parts.push(`also seen: ${[...skus].join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : 'no readings were served';
}

/** A fresh scripted provider per run: N paging calls (declaring when armed), then the echo. */
function scriptedMock(armed) {
  let calls = 0;
  return mock({
    respond: (req) => {
      if (calls < N) {
        calls += 1;
        const args = { cursor: calls - 1 };
        if (armed) args._findings = declarationFor(req, calls);
        return { toolCalls: [{ id: `c${calls}`, name: 'next_record', args }] };
      }
      return { content: echoAnswer(req) };
    },
  });
}

/** Refuses a provider selection the harness cannot honour BEFORE anything is printed or built. */
function assertProviderEnv() {
  if (PROVIDER !== 'mock' && PROVIDER !== 'ollama') {
    throw new Error(`AF_SHUFFLE_PROVIDER must be 'mock' or 'ollama', saw '${PROVIDER}'`);
  }
  if (PROVIDER === 'ollama' && !MODEL) {
    throw new Error('AF_SHUFFLE_PROVIDER=ollama needs AF_SHUFFLE_MODEL=<model>');
  }
}

/** A fresh provider per run — the mock keeps a call counter, and a real one keeps nothing across runs. */
function providerFor(armed) {
  return PROVIDER === 'mock'
    ? { provider: scriptedMock(armed), model: 'mock' }
    : { provider: ollama(MODEL), model: MODEL };
}

// ─── Scoring the answer ────────────────────────────────────────────────

/**
 * The claim set of an answer: every `node-<i>` it names with the first
 * 3+-digit number that follows it before the next node or any SKU (its
 * stated value, right or wrong — `?` when none; `1007us` and `1,007 us`
 * both read as 1007), plus every SKU it cites; both de-duplicated and
 * sorted. This is the NORMAL FORM drift is measured on: two answers with
 * the same claim set are the same answer, whatever the wording or order.
 */
function claimsOf(answer) {
  const a = answer.toLowerCase().replace(/(\d),(\d)/g, '$1$2');
  const claims = new Set();
  for (const seg of a.split(/(?=node[-_ ]?\d+\b)/)) {
    const id = /^node[-_ ]?(\d+)\b/.exec(seg);
    if (!id) continue;
    const rest = seg.slice(id[0].length).split(/sku/)[0];
    const v = /(?<!\d)(\d{3,})(?!\d)/.exec(rest);
    claims.add(`node-${id[1]}=${v ? v[1] : '?'}`);
  }
  const skus = new Set([...a.matchAll(/sku[-_ ]?(\d+)\b/g)].map((m) => `SKU-${m[1]}`));
  return { claims: [...claims].sort(), skus: [...skus].sort() };
}

function score(answer, records) {
  const { claims, skus } = claimsOf(answer);
  const facts = records.filter((r) => r.kind === 'fact');
  const found = facts.filter((r) => claims.includes(`${r.node}=${r.value}`));
  const cited = records.filter((r) => r.kind === 'noise' && skus.includes(r.sku));
  return {
    factsInAnswer: found.length / facts.length,
    noiseCited: cited.length > 0 ? 1 : 0,
    normal: JSON.stringify({ claims, skus }),
  };
}

// ─── One run, one condition ────────────────────────────────────────────

async function runOnce(condition, run, records) {
  const order = orderFor(run);
  const { provider, model } = providerFor(condition.armed);
  let b = Agent.create({ provider, model, maxIterations: N + 3, temperature: 0 }).tool(
    pagingTool(records, order),
  );
  if (condition.armed) b = b.findings({ serve: condition.serve });
  const agent = b.build();
  const out = await agent.run({ message: QUESTION });
  if (typeof out !== 'string') {
    throw new Error(`${condition.label} run ${run}: the agent paused instead of answering`);
  }
  // The ledger, through the public door (`Agent.findings`): undefined when
  // the agent is unarmed or the model declared nothing — never an empty array.
  const ledger = agent.findings() ?? [];
  const standings = ledger.filter((r) => r.kind === 'standing');
  const named = new Set(standings.filter((r) => r.unknownId !== true).map((r) => r.toolCallId));
  const unknown = new Set(standings.filter((r) => r.unknownId === true).map((r) => r.toolCallId));
  return {
    ...score(out, records),
    declared: named.size / N,
    unknownIds: unknown.size,
    order,
    answer: out,
  };
}

async function measure(condition, records) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const r = await runOnce(condition, run, records);
    runs.push(r);
    if (VERBOSE) {
      console.log(`  [${condition.label} · run ${run}] order ${r.order.join(' ')}`);
      console.log(`    answer: ${r.answer.replace(/\s+/g, ' ').slice(0, 400)}`);
      console.log(`    claims: ${r.normal}`);
    }
  }
  const mean = (key) => runs.reduce((s, r) => s + r[key], 0) / runs.length;
  return {
    label: condition.label,
    armed: condition.armed,
    runs: runs.length,
    factsInAnswer: mean('factsInAnswer'),
    noiseCited: mean('noiseCited'),
    declared: condition.armed ? mean('declared') : undefined,
    unknownIds: runs.reduce((s, r) => s + r.unknownIds, 0),
    drift: new Set(runs.map((r) => r.normal)).size / runs.length,
  };
}

// ─── The table ─────────────────────────────────────────────────────────

const fmt = (x, d = 3) => (x === undefined ? '-' : x.toFixed(d));

function printTable(rows) {
  console.log(
    'condition          runs  facts-in-answer  noise-cited  declared  drift   unknown-id-standings',
  );
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(18)} ${String(r.runs).padStart(4)}  ${fmt(r.factsInAnswer).padStart(
        15,
      )}  ` +
        `${fmt(r.noiseCited).padStart(11)}  ${fmt(r.declared).padStart(8)}  ${fmt(
          r.drift,
          2,
        ).padStart(5)}   ` +
        `${String(r.unknownIds).padStart(20)}`,
    );
  }
}

/**
 * What the MOCK run pins — the harness's own smoke test. The echo answers
 * from what it was SERVED, so every armed-row number is a fact about the
 * step 3 WIRE, and each expectation is COMPUTED from the orders and the
 * last-batch law rather than pinned as a constant:
 *
 *   - facts-in-answer 1 on every row (facts verbatim by default; under
 *     ledger-only the scripted declarations carry every fact into the piece);
 *   - declared (N-1)/N on the armed rows (the last result is never named —
 *     no output schema, so no answer-turn declaration);
 *   - noise-cited on an armed row = the share of orders that END on a noise
 *     record: every earlier noise result was declared and collapsed to a
 *     ticket, and the last one is undeclared by law and served in full, so
 *     the echo cites its SKU exactly then;
 *   - drift: off = 1/runs (an echo of everything is order-independent);
 *     armed = the distinct claim sets the last records imply — one per
 *     distinct SKU at the last position, plus one if any order ends on a
 *     fact (all such runs claim every fact and no SKU) — over runs.
 *
 * A wire that collapsed the undeclared last result, or stopped collapsing
 * declared noise, moves these off their law and the harness exits 1. The
 * first cut pinned drift 1/runs on the armed rows too — written while the
 * dial was inert, and red the moment the wire landed, because an echo's
 * claim set DOES depend on the order through that one undeclared record.
 */
function smokeCheck(rows, records) {
  const problems = [];
  const off = rows.find((r) => !r.armed);
  if (off.factsInAnswer !== 1)
    problems.push(
      `findings off: facts-in-answer ${off.factsInAnswer}, expected 1 (every fact is served verbatim)`,
    );
  if (off.noiseCited !== 1)
    problems.push(
      `findings off: noise-cited ${off.noiseCited}, expected 1 (every SKU is served verbatim)`,
    );
  // The last record of every order — undeclared by the last-batch law, served
  // in full — is the ONE order-dependent thing an armed echo can cite.
  const lasts = Array.from({ length: RUNS }, (_, run) => records[orderFor(run)[N - 1]]);
  const lastNoise = lasts.filter((r) => r.kind === 'noise');
  const armedNoiseCited = lastNoise.length / RUNS;
  const armedDrift =
    (new Set(lastNoise.map((r) => r.sku)).size + (lastNoise.length < RUNS ? 1 : 0)) / RUNS;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const r of rows) {
    if (r.runs !== RUNS) problems.push(`${r.label}: ${r.runs} runs, expected ${RUNS}`);
    const expectedDrift = r.armed ? armedDrift : 1 / RUNS;
    if (!near(r.drift, expectedDrift))
      problems.push(
        `${r.label}: drift ${r.drift}, expected ${expectedDrift} (${
          r.armed
            ? 'the claim set moves only with the undeclared last record of each order'
            : "an echo's claim set does not depend on the order"
        })`,
      );
    if (r.armed && !near(r.noiseCited, armedNoiseCited))
      problems.push(
        `${r.label}: noise-cited ${r.noiseCited}, expected ${armedNoiseCited} (${lastNoise.length} of ${RUNS} orders end on a noise record, undeclared and served in full; every other noise result is a ticket)`,
      );
    if (r.armed && r.factsInAnswer !== 1)
      problems.push(
        `${r.label}: facts-in-answer ${r.factsInAnswer}, expected 1 (facts are served verbatim by default; under ledger-only the scripted declarations carry every fact)`,
      );
    if (r.armed && Math.abs(r.declared - (N - 1) / N) > 1e-9)
      problems.push(
        `${r.label}: declared ${r.declared}, expected ${
          (N - 1) / N
        } (the last result is undeclared by law — no output schema)`,
      );
    if (r.unknownIds !== 0) problems.push(`${r.label}: ${r.unknownIds} standings named no result`);
  }
  return problems;
}

async function main() {
  assertProviderEnv();
  const records = plantRecords();
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const who = PROVIDER === 'mock' ? 'mock (scripted)' : `ollama ${MODEL} at ${host}`;
  console.log(
    `findings-shuffle — provider ${who}, seed ${SEED}, ${RUNS} runs per condition, ` +
      `${N} records (${FACTS} facts + ${NOISE} noise), the same ${RUNS} orders in every condition, temperature 0`,
  );
  if (!VERBOSE) {
    console.log(
      `order (run 0): ${orderFor(0).join(
        ' ',
      )}   — AF_SHUFFLE_VERBOSE=1 prints every run's order, answer and claims`,
    );
  }
  const rows = [];
  for (const condition of CONDITIONS) rows.push(await measure(condition, records));
  printTable(rows);
  console.log(
    'read: drift 1/runs = the same claims under every order; a higher drift under ledger-only than ' +
      'under ledger-and-facts means the served ledger is NOT a sufficient statistic of the evidence',
  );
  if (PROVIDER === 'mock') {
    console.log('mock: compliance is scripted, this measures the harness, not a model');
    const problems = smokeCheck(rows, records);
    if (problems.length > 0) {
      console.error(`harness smoke test FAILED:\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log(
        'harness smoke test: green (off echoes everything; armed rows declare N-1 of N, cite noise ' +
          'exactly when the order ends on an undeclared noise record, and drift by that record alone)',
      );
    }
  } else {
    console.log(
      `real model (${MODEL}): these are this model's numbers on this seed — nothing is claimed until ` +
        'the design page records the run; the serve default changes only on such a record',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
