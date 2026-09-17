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
 * (`node-<i>: <value>us`), NOISE of them are inventory rows (`SKU-<n>`) that
 * each carry a latency-looking value NEAR one fact (within 5%, never equal —
 * `nearValue`), so a model that cites a noise value for a node is caught by
 * `facts-in-answer`, not hidden by it; the question asks for every node's
 * reading. Every run serves the SAME records in an order drawn from a seeded
 * PRNG — run r's order is the same in every condition (a paired comparison;
 * the seed is printed, and `AF_SHUFFLE_SEED` reproduces it) — and the model
 * answers. Three conditions, RUNS runs each:
 *
 *   findings off       `.findings()` not called — the wire as it is today
 *   ledger-and-facts   `.findings({ serve: 'ledger-and-facts' })` — the default dial
 *   ledger-only        `.findings({ serve: 'ledger-only' })` — the bench-gated dial
 *
 * THE AXES (env; the real-model page's matrix — docs/design/2026-09-findings-ledger-real-model.md):
 *
 *   FACTS        planted readings (default 6)
 *   NOISE        planted inventory rows (default 12)
 *   NOISE_AT     where the noise sits in the served order — `spread` (default:
 *                the plain seeded shuffle, the order every earlier run used),
 *                `end` (the recency case: every noise record AFTER every fact)
 *                or `start` (every noise record BEFORE every fact). Applied
 *                AFTER the seeded shuffle as a stable partition (`orderFor`):
 *                the fact/noise split is positional, the order WITHIN each
 *                group is still run r's shuffle, so `end` and `start` on the
 *                same seed meet the same facts in the same sequence.
 *   NOISE_SIZE   approximate tokens per noise record (`250`, `1000`, `4000`;
 *                unset = the one-line record, about 15 tokens). A padded
 *                record keeps its header line and gains stock-movement rows
 *                for the SAME SKU (`paddingRows`) — deterministic per record,
 *                the same bytes every run — sized at 4 chars per token. No
 *                padding row and no noise header ever holds a fact's value or
 *                a fact's node id: `assertDistinguishable` refuses the plant
 *                before any call otherwise, and checks that `score` reads an
 *                answer citing every near value as 0 facts.
 *
 * Each final answer is scored on the record, with no model as judge:
 *
 *   facts-in-answer     planted facts whose node id AND value the answer states,
 *                       over FACTS; the mean over runs. A near value cited for a
 *                       node is a miss here (the value differs), and a real one.
 *   noise-cited         1 when the answer names ANY planted noise value (an SKU),
 *                       else 0; the mean over runs = the share of runs that cited noise
 *   declared            results with a `standing` row on `agent.findings()` that
 *                       named a real result, over the records served; armed rows only.
 *                       The compliance signal without which the other columns cannot
 *                       be read: a model that never declares serves an empty ledger
 *                       under `'ledger-only'`. Standing rows whose id named no result
 *                       (`unknownId`) are counted apart and printed when non-zero —
 *                       the design page's second provider assumption (the model sees
 *                       tool_result ids) is what that count tests on a real wire.
 *   standing-accuracy   of the results the model's standings NAME (a known id, the
 *                       LAST row per id — the ledger's own rule, `foldLedger`), the
 *                       share whose standing agrees with the planted truth: a fact
 *                       record called `fact`; a noise record called `noise` or
 *                       `ruled-out`; `open` disagrees with both. Pooled over runs
 *                       (agreements / named results). The harness knows the truth
 *                       from the paging tool itself (`pagingTool` files which record
 *                       each `toolCallId` served — `ToolExecutionContext.toolCallId`
 *                       is the id the tool message carries), so no judge is needed;
 *                       `-` when no standing named a known id, and a result that
 *                       served no record (an exhausted-cursor reply) has no planted
 *                       truth and is left out of the denominator.
 *   drift               distinct NORMALISED answers over runs. The normal form is
 *                       the CLAIM SET the answer makes — every `node-<i>` it names
 *                       with the value it gives, plus every SKU it cites, sorted —
 *                       so wording and order do not count and content does.
 *                       1/runs = every order gave the same claims.
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
 * THE MATRIX. `--matrix` (or `AF_SHUFFLE_MATRIX=1`) runs every cell of
 * NOISE 2/4/8/16 × NOISE_AT end/start × NOISE_SIZE 250/1000/4000 (24 cells)
 * for the three conditions with the same FACTS, SEED and RUNS: one table per
 * cell, then ONE summary table (cell × condition → facts-in-answer,
 * noise-cited, declared, standing-accuracy, drift). The cost is stated in the
 * header BEFORE the first call: nominal model calls for this invocation's
 * model = Σ over cells of 3 conditions × RUNS × (FACTS + NOISE + 1) — one
 * call per record read plus the answer — and the ceiling every run is capped
 * at, `maxIterations` = FACTS + NOISE + 3. On the mock RUNS defaults to 1 in
 * matrix mode (the whole matrix in under a minute); a real model runs at the
 * RUNS you set (default 5). The mock matrix runs the same smoke laws per cell.
 *
 * Planting duplicates `bench/findings-context.mjs`'s shape (a node's p95 as
 * the fact, an inventory row as the noise) rather than importing it: that
 * bench runs its `main()` at module load and exports nothing.
 *
 * Run:  npm run build && node bench/findings-shuffle.mjs
 *       AF_SHUFFLE_SEED=7 RUNS=10 FACTS=6 NOISE=12 node bench/findings-shuffle.mjs
 *       NOISE=16 NOISE_AT=end NOISE_SIZE=1000 node bench/findings-shuffle.mjs
 *       node bench/findings-shuffle.mjs --matrix            (the mock: RUNS=1 by default)
 *       AF_SHUFFLE_PROVIDER=anthropic AF_SHUFFLE_MODEL=claude-haiku-4-5 node bench/findings-shuffle.mjs
 *         (the key comes from ANTHROPIC_API_KEY; a hosted model, so this is the run that decides)
 *       AF_SHUFFLE_PROVIDER=anthropic AF_SHUFFLE_MODEL=claude-sonnet-5 AF_SHUFFLE_TEMPERATURE=none \
 *         node bench/findings-shuffle.mjs --matrix          (the full matrix; read the cost line first)
 *       AF_SHUFFLE_PROVIDER=ollama AF_SHUFFLE_MODEL=qwen3 OLLAMA_HOST=http://localhost:11434 \
 *         RUNS=5 node bench/findings-shuffle.mjs
 *       AF_SHUFFLE_VERBOSE=1 prints every run's order, answer, claim set and standings.
 *       Plain JS on node, the package's own doors by self-reference — `npm run
 *       build` must be current (the build deletes dist/ first: build BEFORE any
 *       suite that walks dist/esm, never beside it).
 */
// The package's own doors, by self-reference (the built dist — this is an
// ES module and the sources are CommonJS-typed): run `npm run build` first.
import { Agent, defineTool } from 'agentfootprint';
import { anthropic, mock, ollama } from 'agentfootprint/providers';

const PROVIDER = process.env.AF_SHUFFLE_PROVIDER ?? 'mock';
const MODEL = process.env.AF_SHUFFLE_MODEL;
const SEED = Number(process.env.AF_SHUFFLE_SEED ?? 20260916);
const MATRIX = process.argv.includes('--matrix') || process.env.AF_SHUFFLE_MATRIX === '1';
// The mock matrix is a smoke test of 24 cells: one run per cell keeps it
// under a minute. A real model runs at the RUNS you set, default 5.
const RUNS = Number(process.env.RUNS ?? (MATRIX && PROVIDER === 'mock' ? 1 : 5));
const FACTS = Number(process.env.FACTS ?? 6);
const NOISE = Number(process.env.NOISE ?? 12);
const NOISE_AT = process.env.NOISE_AT ?? 'spread';
const NOISE_SIZE =
  process.env.NOISE_SIZE === undefined ? undefined : Number(process.env.NOISE_SIZE);
const VERBOSE = process.env.AF_SHUFFLE_VERBOSE === '1';
// `AF_SHUFFLE_TEMPERATURE=none` sends no temperature at all: the Claude 5
// family refuses the parameter ("`temperature` is deprecated for this
// model"), so a run there rests on the model's own default.
const TEMPERATURE =
  process.env.AF_SHUFFLE_TEMPERATURE === 'none'
    ? undefined
    : Number(process.env.AF_SHUFFLE_TEMPERATURE ?? 0);

const NOISE_AT_VALUES = ['spread', 'end', 'start'];
/** The matrix's axes, in the order the cells are run (noise outermost). */
// The full matrix, or a subset named by env: MATRIX_NOISE=4,16 MATRIX_AT=end
// MATRIX_SIZE=250,1000 — the cost line names the cells this invocation runs.
const listEnv = (name, fallback, parse) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const picked = raw.split(',').map((v) => parse(v.trim()));
  const bad = picked.find((v) => !fallback.includes(v));
  if (bad !== undefined) throw new Error(`${name}: '${bad}' is not one of ${fallback.join('/')}`);
  return picked;
};
const MATRIX_NOISE = listEnv('MATRIX_NOISE', [2, 4, 8, 16], Number);
const MATRIX_AT = listEnv('MATRIX_AT', ['end', 'start'], String);
const MATRIX_SIZE = listEnv('MATRIX_SIZE', [250, 1000, 4000], Number);
/** The token estimate the padding is sized by: chars per token. */
const CHARS_PER_TOKEN = 4;

const CONDITIONS = [
  { label: 'findings off', armed: false },
  { label: 'ledger-and-facts', armed: true, serve: 'ledger-and-facts' },
  { label: 'ledger-only', armed: true, serve: 'ledger-only' },
];

// ─── The cell ──────────────────────────────────────────────────────────

/**
 * One point of the axes: how many facts and noise records, where the noise
 * sits, how big each noise record is. The single-table run is one cell (the
 * env); the matrix is 24 of them with the env's FACTS.
 */
function cellOf(facts, noise, noiseAt, noiseSize) {
  return { facts, noise, n: facts + noise, noiseAt, noiseSize };
}

/** The cell's name as the tables print it: `noise <n> · at <where> · size <tokens|1-line>`. */
function cellLabel(cell) {
  return `noise ${cell.noise} · at ${cell.noiseAt} · size ${
    cell.noiseSize === undefined ? '1-line' : cell.noiseSize
  }`;
}

function questionFor(n) {
  return (
    `A survey of ${n} records is available through next_record. Read every record — call ` +
    'next_record with cursor 0, then with the `next` cursor each result names, until it says the ' +
    'survey is exhausted. Then answer: what is the p95 latency reading of every node in the survey? ' +
    'Name each node id and its reading.'
  );
}

// ─── The planted evidence ──────────────────────────────────────────────

/** Fact i's reading — 7 apart, so a near value (±2..4) never lands on another fact. */
const factValue = (i) => 1000 + i * 7;

/**
 * Noise record j's latency-looking value: one fact's reading moved by 2, 3
 * or 4 (alternating sign) — under 0.5% of any reading, so "within 5%", and
 * never equal to ANY fact (the readings are 7 apart). A model that answers a
 * node with this value has cited noise, and `score` says so.
 */
function nearValue(facts, j) {
  const base = factValue(((j - 1) % facts) + 1);
  const offset = 2 + ((j - 1) % 3);
  return base + (j % 2 === 0 ? offset : -offset);
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
 * The stock-movement rows that pad noise record j to about `noiseSize`
 * tokens: the same SKU, a date, a movement, a bin, a lot, an operator. Every
 * number is drawn from a range no fact reading can reach (qty < 100,
 * op < 1000, lot ≥ 30000; a fact is 1000 + 7i) and the rows name no node —
 * `assertDistinguishable` still checks the bytes rather than trusting the
 * construction. Seeded by j alone: the same rows every run and every seed.
 */
function paddingRows(j, noiseSize, headerChars) {
  if (noiseSize === undefined) return [];
  const rng = mulberry32((0x5eed0000 + j) >>> 0);
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const rows = [];
  let chars = headerChars;
  const target = noiseSize * CHARS_PER_TOKEN;
  while (chars < target) {
    const month = int(1, 9);
    const day = int(1, 28);
    const verb = rng() < 0.5 ? 'receive' : 'pick';
    const row =
      `  2026-0${month}-${String(day).padStart(2, '0')} · ${verb} ${verb === 'pick' ? '-' : '+'}` +
      `${int(1, 99)} → bin B${j}-${int(1, 9)}, lot L${int(30000, 39999)}, op #${int(100, 999)}`;
    rows.push(row);
    chars += row.length + 1;
  }
  return rows;
}

/**
 * The records: FACTS readings the question is about, NOISE rows it is not.
 * Facts come first (indices 0..facts-1), noise after — `orderFor` relies on
 * that split. Nothing in a record's text says which it is — the harness
 * knows by construction, a model has to tell.
 */
function plantRecords(cell) {
  const records = [];
  for (let i = 1; i <= cell.facts; i++) {
    const value = String(factValue(i));
    records.push({
      kind: 'fact',
      node: `node-${i}`,
      value,
      text: `p95 latency reading — node-${i}: ${value}us (survey probe)`,
    });
  }
  for (let j = 1; j <= cell.noise; j++) {
    const sku = `SKU-${8000 + j * 13}`;
    const near = String(nearValue(cell.facts, j));
    const header = `inventory row — ${sku}, qty ${
      j * 5
    }, bin B${j}, pick-path latency ${near}us (warehouse ledger)`;
    const rows = paddingRows(j, cell.noiseSize, header.length);
    records.push({
      kind: 'noise',
      sku,
      near,
      text: rows.length > 0 ? `${header}\n${rows.join('\n')}` : header,
      paddingRows: rows.length,
      chars: header.length + rows.reduce((s, r) => s + r.length + 1, 0),
    });
  }
  return records;
}

/**
 * The plant must be tellable apart on the record, or the columns lie: no
 * noise byte holds a fact's node id or a fact's value as a whole number, no
 * near value equals a fact, and `score` reads an answer that cites every
 * near value for its node as 0 facts. Refused before any call.
 */
function assertDistinguishable(records) {
  const facts = records.filter((r) => r.kind === 'fact');
  const noise = records.filter((r) => r.kind === 'noise');
  const problems = [];
  for (const n of noise) {
    if (/node-\d+/.test(n.text)) problems.push(`${n.sku} names a node`);
    for (const f of facts) {
      if (new RegExp(`(?<!\\d)${f.value}(?!\\d)`).test(n.text))
        problems.push(`${n.sku} holds ${f.node}'s value ${f.value}`);
      if (n.near === f.value) problems.push(`${n.sku}'s near value equals ${f.node}'s`);
    }
  }
  const nearAnswer = facts
    .map((f, i) => `${f.node}: ${noise[i % noise.length]?.near ?? f.value}us`)
    .join('; ');
  if (noise.length > 0 && score(nearAnswer, records).factsInAnswer !== 0)
    problems.push(`score read a near value as a fact: "${nearAnswer}"`);
  if (problems.length > 0)
    throw new Error(`the plant cannot be told apart:\n  ${problems.join('\n  ')}`);
}

/**
 * Run r's order: a Fisher–Yates shuffle of the record indices from (seed, r),
 * then the cell's NOISE_AT as a STABLE partition — `spread` keeps the shuffle
 * as it is; `end` moves every noise index after every fact index and `start`
 * before, each group in the order the shuffle gave it. The SAME order for run
 * r in every condition, so the conditions are compared on the same evidence
 * in the same sequence.
 */
function orderFor(run, cell) {
  const rng = mulberry32((SEED ^ Math.imul(run + 1, 0x9e3779b1)) >>> 0);
  const order = Array.from({ length: cell.n }, (_, k) => k);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (cell.noiseAt === 'spread') return order;
  const facts = order.filter((k) => k < cell.facts);
  const noise = order.filter((k) => k >= cell.facts);
  return cell.noiseAt === 'end' ? [...facts, ...noise] : [...noise, ...facts];
}

/**
 * The paging tool: cursor k serves the k-th record OF THIS RUN'S ORDER, so the
 * model reads the same records every run and meets them in a different
 * sequence. Out of range = exhausted; it never serves a record twice under
 * one cursor and never serves anything the plant does not hold. It files
 * which record each invocation served under the invocation's own id
 * (`ToolExecutionContext.toolCallId` — the id the tool message carries) in
 * `served`: the planted truth `standing-accuracy` is read against.
 */
function pagingTool(records, order, served) {
  const n = records.length;
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
    execute: async (a, ctx) => {
      const k = Number(a.cursor ?? 0);
      if (!Number.isInteger(k) || k < 0 || k >= n) {
        return `survey exhausted: no record at cursor ${String(
          a.cursor,
        )}; the ${n} records are at cursors 0 to ${n - 1}`;
      }
      const r = records[order[k]];
      served.set(ctx.toolCallId, r);
      return `${r.text}\nnext: ${k + 1}; records remaining after this one: ${n - k - 1}`;
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
 * assertion; anything else is `noise` — a noise record carries a `us` value
 * but no node, so `readingIn` tells them apart and the script's standings
 * are the planted truth. The last result is never named: no output schema,
 * so no answer-turn declaration (the last-batch law).
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

/** A fresh scripted provider per run: n paging calls (declaring when armed), then the echo. */
function scriptedMock(armed, n) {
  let calls = 0;
  return mock({
    respond: (req) => {
      if (calls < n) {
        calls += 1;
        const args = { cursor: calls - 1 };
        if (armed) args._findings = declarationFor(req, calls);
        return { toolCalls: [{ id: `c${calls}`, name: 'next_record', args }] };
      }
      return { content: echoAnswer(req) };
    },
  });
}

/** Refuses a provider or axis selection the harness cannot honour BEFORE anything is printed or built. */
function assertEnv() {
  if (PROVIDER !== 'mock' && PROVIDER !== 'ollama' && PROVIDER !== 'anthropic') {
    throw new Error(
      `AF_SHUFFLE_PROVIDER must be 'mock', 'ollama' or 'anthropic', saw '${PROVIDER}'`,
    );
  }
  if (PROVIDER !== 'mock' && !MODEL) {
    throw new Error(`AF_SHUFFLE_PROVIDER=${PROVIDER} needs AF_SHUFFLE_MODEL=<model>`);
  }
  if (PROVIDER === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('AF_SHUFFLE_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment');
  }
  if (!NOISE_AT_VALUES.includes(NOISE_AT)) {
    throw new Error(`NOISE_AT must be one of ${NOISE_AT_VALUES.join('|')}, saw '${NOISE_AT}'`);
  }
  if (NOISE_SIZE !== undefined && !(Number.isInteger(NOISE_SIZE) && NOISE_SIZE > 0)) {
    throw new Error(
      `NOISE_SIZE must be a positive integer of tokens (250|1000|4000), saw '${process.env.NOISE_SIZE}'`,
    );
  }
  for (const [name, v] of [
    ['FACTS', FACTS],
    ['NOISE', NOISE],
    ['RUNS', RUNS],
  ]) {
    if (!(Number.isInteger(v) && v >= 1))
      throw new Error(`${name} must be a positive integer, saw '${v}'`);
  }
}

/** A fresh provider per run — the mock keeps a call counter, and a real one keeps nothing across runs. */
function providerFor(armed, n) {
  if (PROVIDER === 'mock') return { provider: scriptedMock(armed, n), model: 'mock' };
  if (PROVIDER === 'anthropic') {
    // The package's own Anthropic adapter; the key is read by the provider
    // (`AnthropicProvider` · `ANTHROPIC_API_KEY`), never by this script.
    return { provider: anthropic({ timeout: 120_000, maxRetries: 3 }), model: MODEL };
  }
  return { provider: ollama(MODEL), model: MODEL };
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

/**
 * The model's standings against the planted truth. The CURRENT standing per
 * named result (the last row per id — `foldLedger`'s rule) is right when a
 * fact record is called `fact`, or a noise record `noise` or `ruled-out`;
 * `open` is wrong for both. Counted only over ids the paging tool served a
 * record under — an unknown id names nothing, an exhausted-cursor reply has
 * no truth. Returns the counts, so runs can be pooled.
 */
function standingsAgainstTruth(standings, served) {
  const current = new Map();
  for (const row of standings) if (row.unknownId !== true) current.set(row.toolCallId, row);
  let named = 0;
  let right = 0;
  for (const [id, row] of current) {
    const record = served.get(id);
    if (record === undefined) continue;
    named += 1;
    const agrees =
      record.kind === 'fact'
        ? row.standing === 'fact'
        : row.standing === 'noise' || row.standing === 'ruled-out';
    if (agrees) right += 1;
  }
  return { named, right };
}

// ─── One run, one condition ────────────────────────────────────────────

/**
 * The slot budgets are a SIGNAL, never a limiter (`AgentOptions.contextBudget`:
 * nothing is ever truncated, and raising one is the answer when the slot is
 * legitimately that big) — and the harness is the one party that knows how
 * big its plant is. So each run sizes the three slots to the plant: messages
 * hold every record once plus the turns around it, the system prompt holds
 * the ledger piece's line per standing, the tools slot holds the reserved
 * argument's schema and its offer of ids. A warning under these budgets
 * means the wire grew past what the plant explains, not that a 4000-token
 * cell exists. The defaults (10000 / 4000 / 2000 chars) stay the floor.
 */
function budgetFor(cell, records) {
  const plantChars = records.reduce((s, r) => s + r.text.length, 0);
  return {
    messages: 10_000 + 2 * plantChars + 400 * cell.n,
    systemPrompt: 4_000 + 300 * cell.n,
    tools: 2_000 + 4_000 + 64 * cell.n,
  };
}

async function runOnce(condition, run, cell, records) {
  const order = orderFor(run, cell);
  const served = new Map();
  const { provider, model } = providerFor(condition.armed, cell.n);
  let b = Agent.create({
    provider,
    model,
    maxIterations: cell.n + 3,
    contextBudget: budgetFor(cell, records),
    ...(TEMPERATURE !== undefined && { temperature: TEMPERATURE }),
  }).tool(pagingTool(records, order, served));
  if (condition.armed) b = b.findings({ serve: condition.serve });
  const agent = b.build();
  const out = await agent.run({ message: questionFor(cell.n) });
  if (typeof out !== 'string') {
    throw new Error(`${condition.label} run ${run}: the agent paused instead of answering`);
  }
  // The ledger, through the public door (`Agent.findings`): undefined when
  // the agent is unarmed or the model declared nothing — never an empty array.
  const ledger = agent.findings() ?? [];
  const standings = ledger.filter((r) => r.kind === 'standing');
  const named = new Set(standings.filter((r) => r.unknownId !== true).map((r) => r.toolCallId));
  const unknown = new Set(standings.filter((r) => r.unknownId === true).map((r) => r.toolCallId));
  // The provider's own ids (a basis row carries the id the loop dispatched) beside the
  // ids the model wrote in `previous[]` that matched nothing — the binding the ask relies on.
  const basisIds = ledger.filter((r) => r.kind === 'basis').map((r) => r.toolCallId);
  const idSample =
    basisIds.length > 0 || unknown.size > 0
      ? `dispatched ${JSON.stringify(basisIds.slice(0, 3))} · unknown ${JSON.stringify(
          [...unknown].slice(0, 4),
        )} · named ${named.size}`
      : undefined;
  const truth = standingsAgainstTruth(standings, served);
  return {
    ...score(out, records),
    declared: named.size / cell.n,
    unknownIds: unknown.size,
    standingsNamed: truth.named,
    standingsRight: truth.right,
    order,
    answer: out,
    idSample,
  };
}

async function measure(condition, cell, records) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const r = await runOnce(condition, run, cell, records);
    runs.push(r);
    if (VERBOSE) {
      console.log(`  [${condition.label} · run ${run}] order ${r.order.join(' ')}`);
      console.log(`    answer: ${r.answer.replace(/\s+/g, ' ').slice(0, 400)}`);
      console.log(`    claims: ${r.normal}`);
      if (r.idSample) console.log(`    ids: ${r.idSample}`);
      if (r.standingsNamed > 0)
        console.log(
          `    standings: ${r.standingsRight} of ${r.standingsNamed} named results agree with the plant`,
        );
    }
  }
  const mean = (key) => runs.reduce((s, r) => s + r[key], 0) / runs.length;
  const sum = (key) => runs.reduce((s, r) => s + r[key], 0);
  const named = sum('standingsNamed');
  return {
    label: condition.label,
    armed: condition.armed,
    runs: runs.length,
    factsInAnswer: mean('factsInAnswer'),
    noiseCited: mean('noiseCited'),
    declared: condition.armed ? mean('declared') : undefined,
    unknownIds: sum('unknownIds'),
    standingAccuracy: named > 0 ? sum('standingsRight') / named : undefined,
    drift: new Set(runs.map((r) => r.normal)).size / runs.length,
  };
}

// ─── The tables ────────────────────────────────────────────────────────

const fmt = (x, d = 3) => (x === undefined ? '-' : x.toFixed(d));

function printTable(rows) {
  console.log(
    'condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings',
  );
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(18)} ${String(r.runs).padStart(4)}  ${fmt(r.factsInAnswer).padStart(
        15,
      )}  ` +
        `${fmt(r.noiseCited).padStart(11)}  ${fmt(r.declared).padStart(8)}  ${fmt(
          r.standingAccuracy,
        ).padStart(17)}  ${fmt(r.drift, 2).padStart(5)}   ` +
        `${String(r.unknownIds).padStart(20)}`,
    );
  }
}

/** The matrix's one summary: a row per cell × condition, the five columns the design page reads. */
function printSummary(cells) {
  console.log(
    'cell                            condition          facts-in-answer  noise-cited  declared  standing-accuracy  drift',
  );
  for (const { cell, rows } of cells) {
    for (const r of rows) {
      console.log(
        `${cellLabel(cell).padEnd(31)} ${r.label.padEnd(18)} ${fmt(r.factsInAnswer).padStart(
          15,
        )}  ` +
          `${fmt(r.noiseCited).padStart(11)}  ${fmt(r.declared).padStart(8)}  ${fmt(
            r.standingAccuracy,
          ).padStart(17)}  ${fmt(r.drift, 2).padStart(5)}`,
      );
    }
  }
}

/** What the plant is, as the header states it: counts, the near values, the padding. */
function plantLine(cell, records) {
  const noise = records.filter((r) => r.kind === 'noise');
  const padding =
    cell.noiseSize === undefined
      ? 'one line each (unpadded, about 15 tokens)'
      : `about ${cell.noiseSize} tokens each at ${CHARS_PER_TOKEN} chars/token (${
          noise[0]?.paddingRows ?? 0
        } stock-movement rows, ${
          noise[0]?.chars ?? 0
        } chars per record; no row holds a fact value or a node id)`;
  return (
    `${cell.n} records (${cell.facts} facts + ${cell.noise} noise), noise at ${cell.noiseAt}, ` +
    `noise values within 5% of a fact and never equal, noise records ${padding}`
  );
}

/**
 * What the MOCK run pins — the harness's own smoke test. The echo answers
 * from what it was SERVED, so every armed-row number is a fact about the
 * step 3 WIRE, and each expectation is COMPUTED from the orders and the
 * last-batch law rather than pinned as a constant:
 *
 *   - facts-in-answer 1 on every row (facts verbatim by default; under
 *     ledger-only the scripted declarations carry every fact into the piece);
 *   - declared (n-1)/n on the armed rows (the last result is never named —
 *     no output schema, so no answer-turn declaration);
 *   - noise-cited on an armed row = the share of orders that END on a noise
 *     record: every earlier noise result was declared and collapsed to a
 *     ticket, and the last one is undeclared by law and served in full, so
 *     the echo cites its SKU exactly then (under NOISE_AT=end that is every
 *     order; under NOISE_AT=start none);
 *   - standing-accuracy 1 on the armed rows (the script declares by the
 *     truth `readingIn` reads off the record) and `-` on the off row — the
 *     ids the paging tool filed are the ids the ledger named;
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
function smokeCheck(rows, cell, records) {
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
  if (off.standingAccuracy !== undefined)
    problems.push(
      `findings off: standing-accuracy ${off.standingAccuracy}, expected '-' (no ledger)`,
    );
  // The last record of every order — undeclared by the last-batch law, served
  // in full — is the ONE order-dependent thing an armed echo can cite.
  const lasts = Array.from({ length: RUNS }, (_, run) => records[orderFor(run, cell)[cell.n - 1]]);
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
    if (r.armed && Math.abs(r.declared - (cell.n - 1) / cell.n) > 1e-9)
      problems.push(
        `${r.label}: declared ${r.declared}, expected ${
          (cell.n - 1) / cell.n
        } (the last result is undeclared by law — no output schema)`,
      );
    if (r.armed && r.standingAccuracy !== 1)
      problems.push(
        `${r.label}: standing-accuracy ${fmt(
          r.standingAccuracy,
        )}, expected 1 (the script declares by the planted truth, and the paging tool's ids are the ledger's)`,
      );
    if (r.unknownIds !== 0) problems.push(`${r.label}: ${r.unknownIds} standings named no result`);
  }
  return problems;
}

/** Runs the three conditions on one cell and prints its table; returns the rows. */
async function measureCell(cell) {
  const records = plantRecords(cell);
  assertDistinguishable(records);
  const rows = [];
  for (const condition of CONDITIONS) rows.push(await measure(condition, cell, records));
  printTable(rows);
  return { cell, records, rows };
}

function providerLine() {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const who =
    PROVIDER === 'mock'
      ? 'mock (scripted)'
      : PROVIDER === 'anthropic'
      ? `anthropic ${MODEL} (hosted)`
      : `ollama ${MODEL} at ${host}`;
  return `provider ${who}, seed ${SEED}, ${RUNS} runs per condition, the same ${RUNS} orders in every condition, temperature ${
    TEMPERATURE === undefined ? 'not sent' : TEMPERATURE
  }`;
}

/** The mock's verdict on one cell's rows: exit 1 on any problem, named with the cell. */
function judgeMock(problems, cellName) {
  if (problems.length > 0) {
    console.error(
      `harness smoke test FAILED${cellName ? ` (${cellName})` : ''}:\n  ${problems.join('\n  ')}`,
    );
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function runSingle() {
  const cell = cellOf(FACTS, NOISE, NOISE_AT, NOISE_SIZE);
  const records = plantRecords(cell);
  assertDistinguishable(records);
  console.log(`findings-shuffle — ${providerLine()}, ${plantLine(cell, records)}`);
  if (!VERBOSE) {
    console.log(
      `order (run 0): ${orderFor(0, cell).join(
        ' ',
      )}   — AF_SHUFFLE_VERBOSE=1 prints every run's order, answer, claims and standings`,
    );
  }
  const rows = [];
  for (const condition of CONDITIONS) rows.push(await measure(condition, cell, records));
  printTable(rows);
  console.log(
    'read: drift 1/runs = the same claims under every order; a higher drift under ledger-only than ' +
      'under ledger-and-facts means the served ledger is NOT a sufficient statistic of the evidence; ' +
      'standing-accuracy is the share of named results the model judged as planted',
  );
  if (PROVIDER === 'mock') {
    console.log('mock: compliance is scripted, this measures the harness, not a model');
    if (judgeMock(smokeCheck(rows, cell, records))) {
      console.log(
        'harness smoke test: green (off echoes everything; armed rows declare n-1 of n by the planted truth, cite noise ' +
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

async function runMatrix() {
  const cells = [];
  for (const noise of MATRIX_NOISE)
    for (const at of MATRIX_AT)
      for (const size of MATRIX_SIZE) cells.push(cellOf(FACTS, noise, at, size));
  // The cost, before the first call: one model call per record read plus the
  // answer, per run, per condition, per cell — and the ceiling every run is
  // capped at (`maxIterations` = n + 3).
  const perRun = (cell) => cell.n + 1;
  const nominal = cells.reduce((s, c) => s + CONDITIONS.length * RUNS * perRun(c), 0);
  const ceiling = cells.reduce((s, c) => s + CONDITIONS.length * RUNS * (c.n + 3), 0);
  console.log(`findings-shuffle MATRIX — ${providerLine()}, FACTS ${FACTS}`);
  console.log(
    `cells: NOISE ${MATRIX_NOISE.join('/')} × NOISE_AT ${MATRIX_AT.join(
      '/',
    )} × NOISE_SIZE ${MATRIX_SIZE.join('/')} tokens = ${cells.length} cells × ${
      CONDITIONS.length
    } conditions × ${RUNS} runs`,
  );
  console.log(
    `cost: ${nominal} model calls for this model (nominal: n+1 per run, one per record read plus the answer; ` +
      `ceiling ${ceiling} at maxIterations n+3), none made yet`,
  );
  const results = [];
  let green = true;
  for (const cell of cells) {
    const label = cellLabel(cell);
    console.log(`\n── ${label}`);
    const done = await measureCell(cell);
    console.log(`   ${plantLine(cell, done.records)}`);
    results.push(done);
    if (PROVIDER === 'mock')
      green = judgeMock(smokeCheck(done.rows, cell, done.records), label) && green;
  }
  console.log('\n── summary (cell × condition)');
  printSummary(results);
  if (PROVIDER === 'mock') {
    console.log(
      green
        ? `mock matrix: ${cells.length} cells green (scripted compliance — the harness and the wire, not a model)`
        : 'mock matrix: RED (see the cells above)',
    );
  } else {
    console.log(
      `real model (${MODEL}): ${cells.length} cells on seed ${SEED} — commit this print to the real-model page before reading anything into it`,
    );
  }
}

async function main() {
  assertEnv();
  if (MATRIX) await runMatrix();
  else await runSingle();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
