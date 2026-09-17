/**
 * tool-choice — model-led against classifier-led tool selection, on the record.
 *
 * `.toolChoice({ classifier, serve })` (9.105.0) files a classifier's pick
 * beside every model call and, under `serve: { top: N }`, narrows the served
 * tool list to the top-N plus the doors. This harness measures both dials
 * against the unarmed twin with NO model as judge: every number is read off
 * `AgentState.toolChoices` and the receipts, so the cost and the agreement
 * come from the record and nowhere else.
 *
 * WHAT IT DOES. One skill of eight tools (`tool_1` … `tool_8`, each with a
 * one-line description), a scripted model that at step k calls `tool_k` for
 * k = 1 … STEPS and then answers, and a scripted classifier ranking the
 * offered tools three ways:
 *
 *   right-first    the right tool ranked first (the classifier agrees)
 *   right-second   the right tool ranked second (still inside a top-2)
 *   wrong-pair     two other tools ranked first (outside any top-2)
 *
 * under two conditions — `advisory` (`serve: 'all'`) and `top-2`
 * (`serve: { top: 2 }`) — plus the unarmed twin (no `.toolChoice()`), which
 * is the baseline every column is read against.
 *
 * THE MOCK MODEL NAMES WHAT IT WANTS. At step k it calls `tool_k` whether or
 * not `tool_k` is on the served list. That is the one behaviour a hosted API
 * does not allow — a real wire constrains `tool_use` to the served schemas —
 * and it is chosen on purpose: it is the only way a MISS (a call outside the
 * narrowed set) can occur at all, so the after-miss law (the next call serves
 * the full wire) is exercised, and the dispatcher's off-wire path answers the
 * call exactly as it did before this release (`tools.answered_off_wire`). On
 * a real model a wrong ranking shows up as a wrong pick or an answer instead,
 * which `first-agrees` measures and `misses` cannot; the README says so.
 *
 * The columns, per row:
 *
 *   first-agrees      calls where the model's first call equals the classifier's
 *                     pick, over calls that had both (the outcome rows'
 *                     `firstAgrees`); `-` on the unarmed twin
 *   misses            outcome rows carrying `miss` — a narrowed call whose reply
 *                     named an unserved tool
 *   extra-calls       model calls beyond the unarmed twin's — what a miss COSTS
 *                     in calls (0 here: the off-wire dispatch answers the call, so
 *                     the step still advances; on a wire that refuses unserved
 *                     names the model re-asks and this column is where it shows)
 *   tools-slot-bytes  mean `receipt.requestMeasurement.slots.tools.jsonBytes` over
 *                     the calls that served tools — what narrowing saves
 *   pick-tokens       Σ `usage.inputTokens + outputTokens` over the pick rows
 *                     (`-` when the classifier reported none — the mock reports none)
 *   pick-latency-ms   Σ `latencyMs` over the pick rows (the mock's is 0)
 *
 * TWO LAWS THE BENCH ENFORCES (exit code 1 when either fails):
 *
 *   the byte law       the unarmed twin's tools-slot bytes equal today's
 *                      (`UNARMED_TOOLS_SLOT_BYTES`, measured on the 9.105.0 tree)
 *                      on every call, and every advisory row's equal the twin's
 *   the miss law       under `top-2` with `right-first` or `right-second` no call
 *                      misses; under `wrong-pair` every narrowed call whose reply
 *                      called a tool misses, and the call after each serves the
 *                      full wire (`after-miss`) — so the top-2 row narrows every
 *                      other call and its tools-slot bytes land between the two
 *
 * Run:  npm run build && npm run bench:tool-choice
 *       STEPS=6 (default) — the mock's steps; AF_TOOL_CHOICE_CLASSIFIER=typesafe
 *       swaps the scripted classifier for the hosted one (TYPESAFE_API_KEY;
 *       `first-agrees` then measures a real ranking against the scripted calls —
 *       the scripts become labels only). Never run by the suite.
 */
// The package's own doors, by self-reference (the built dist — this is an
// ES module and the sources are CommonJS-typed): run `npm run build` first.
import { Agent, defineTool, epochLocations, receiptAt } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { defineSkill } from 'agentfootprint/context';
import { mockClassifier, typesafe } from 'agentfootprint/classify';

const STEPS = Number(process.env.STEPS ?? 6);
const TOOL_COUNT = 8;
const TOP = 2;
/**
 * The unarmed twin's `slots.tools.jsonBytes` on every call that served tools,
 * measured on the 9.105.0 tree: eight skill tools + `read_skill`. A change
 * here is a change to what an unarmed agent puts on the wire — the byte law.
 */
const UNARMED_TOOLS_SLOT_BYTES = 1745;

const toolName = (k) => `tool_${k}`;
const tools = Array.from({ length: TOOL_COUNT }, (_, i) =>
  defineTool({
    name: toolName(i + 1),
    description: `Step ${i + 1} of the procedure: reads record ${i + 1} and returns its fields.`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => `record ${i + 1}: ok`,
  }),
);

/** The scripted model: `tool_k` at step k, then an answer. */
function scriptedModel() {
  let k = 0;
  return mock({
    respond: () => {
      k += 1;
      if (k <= STEPS) return { toolCalls: [{ id: `c${k}`, name: toolName(k), args: { q: 'x' } }] };
      return { content: 'done' };
    },
  });
}

/** The ranking a script gives at step k over the offered names (the wire minus the doors). */
function rankingFor(script, k, offered) {
  const wrap = (n) => toolName(((n - 1) % TOOL_COUNT) + 1);
  const right = toolName(Math.min(k, STEPS));
  const lead =
    script === 'right-first'
      ? [right, wrap(k + 1)]
      : script === 'right-second'
      ? [wrap(k + 1), right]
      : [wrap(k + 2), wrap(k + 3)];
  const rest = offered.filter((n) => !lead.includes(n));
  return [...lead.filter((n) => offered.includes(n)), ...rest];
}

/** A scripted classifier: the distribution is the script's, highest first, no cost reported. */
function scriptedClassifier(script) {
  return mockClassifier((request, index) => {
    const offered = Object.keys(request.questions.tool.criteria);
    const ranked = rankingFor(script, index + 1, offered);
    const probabilities = Object.fromEntries(
      ranked.map((n, i) => [n, Math.max(0.05, 0.6 - i * 0.1)]),
    );
    return {
      model: 'mock',
      answers: { tool: { type: 'choice', choice: ranked[0], confidence: 0.7, probabilities } },
      latencyMs: 0,
    };
  });
}

function buildAgent({ arm, script, classifier }) {
  let b = Agent.create({ provider: scriptedModel(), model: 'mock', maxIterations: STEPS + 2 })
    .system('Follow the procedure one step at a time.')
    .skill(
      defineSkill({ id: 'procedure', description: 'the procedure', body: 'PROCEDURE', tools }),
    );
  if (arm !== 'off') {
    b = b.toolChoice({
      classifier: classifier ?? scriptedClassifier(script),
      serve: arm === 'top-2' ? { top: TOP } : 'all',
    });
  }
  return b.build();
}

async function measure(config) {
  const agent = buildAgent(config);
  let calls = 0;
  agent.on('agentfootprint.stream.llm_start', () => (calls += 1));
  await agent.run({ message: 'Run the procedure and report every record.' });
  const snapshot = agent.getSnapshot();
  const rows = snapshot.sharedState.toolChoices ?? [];
  const picks = rows.filter((r) => r.kind === 'pick');
  const outcomes = rows.filter((r) => r.kind === 'outcome');
  const agreed = outcomes.filter((o) => o.firstAgrees !== undefined);
  const slotBytes = [];
  for (const { epoch } of epochLocations(snapshot)) {
    const bytes = receiptAt(snapshot, epoch)?.requestMeasurement?.slots?.tools?.jsonBytes;
    if (bytes !== undefined) slotBytes.push(bytes);
  }
  const tokens = picks.reduce(
    (sum, p) =>
      p.usage === undefined ? sum : (sum ?? 0) + p.usage.inputTokens + p.usage.outputTokens,
    undefined,
  );
  return {
    calls,
    firstAgrees:
      agreed.length === 0 ? undefined : agreed.filter((o) => o.firstAgrees).length / agreed.length,
    misses: outcomes.filter((o) => o.miss !== undefined).length,
    slotBytes,
    meanSlotBytes:
      slotBytes.length === 0 ? 0 : slotBytes.reduce((a, b) => a + b, 0) / slotBytes.length,
    pickTokens: tokens,
    pickLatencyMs: picks.reduce((sum, p) => sum + p.latencyMs, 0),
    classifierCalls: picks.length + rows.filter((r) => r.kind === 'pick-error').length,
    narrowedCalls: picks.filter((p) => p.narrowed).length,
    // Narrowed calls whose reply CALLED a tool — the only ones that can miss.
    narrowedToolCalls: picks.filter(
      (p) => p.narrowed && outcomes.some((o) => o.iteration === p.iteration && o.called.length > 0),
    ).length,
    skipped: picks.filter((p) => p.narrowedSkipped !== undefined).map((p) => p.narrowedSkipped),
  };
}

const fmt = (v, digits = 3) =>
  v === undefined ? '-' : typeof v === 'number' ? v.toFixed(digits) : String(v);
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const hosted = process.env.AF_TOOL_CHOICE_CLASSIFIER === 'typesafe';
  const classifierOf = () => (hosted ? typesafe() : undefined);
  const twin = await measure({ arm: 'off' });
  const cells = [];
  for (const arm of ['advisory', 'top-2']) {
    for (const script of ['right-first', 'right-second', 'wrong-pair']) {
      cells.push({ arm, script, ...(await measure({ arm, script, classifier: classifierOf() })) });
    }
  }
  const totalClassifierCalls = cells.reduce((s, c) => s + c.classifierCalls, 0);
  const totalTokens = cells.reduce((s, c) => s + (c.pickTokens ?? 0), 0);
  const totalLatency = cells.reduce((s, c) => s + c.pickLatencyMs, 0);
  console.log(
    `cost: ${totalClassifierCalls} classifier calls across ${cells.length} cells (${
      hosted ? 'typesafe' : 'mock'
    }), ` +
      `${hosted ? totalTokens : '-'} pick tokens, ${totalLatency} ms pick latency; ${
        twin.calls
      } model calls per run unarmed`,
  );
  console.log('');
  const header = [
    'condition',
    'script',
    'first-agrees',
    'misses',
    'extra-calls',
    'tools-slot-bytes',
    'pick-tokens',
    'pick-latency-ms',
  ];
  const widths = [11, 13, 13, 7, 12, 17, 12, 16];
  console.log(header.map((h, i) => pad(h, widths[i])).join(' '));
  console.log(
    ['unarmed', '-', '-', '0', '0', fmt(twin.meanSlotBytes, 1), '-', '-']
      .map((v, i) => pad(v, widths[i]))
      .join(' '),
  );
  for (const c of cells) {
    console.log(
      [
        c.arm,
        c.script,
        fmt(c.firstAgrees),
        String(c.misses),
        String(c.calls - twin.calls),
        fmt(c.meanSlotBytes, 1),
        c.pickTokens === undefined ? '-' : String(c.pickTokens),
        String(c.pickLatencyMs),
      ]
        .map((v, i) => pad(v, widths[i]))
        .join(' '),
    );
  }
  console.log('');
  console.log(
    `narrowed calls per top-2 cell: ${cells
      .filter((c) => c.arm === 'top-2')
      .map(
        (c) =>
          `${c.script} ${c.narrowedCalls}/${c.classifierCalls} (skipped: ${
            c.skipped.join(',') || 'none'
          })`,
      )
      .join(' · ')}`,
  );

  // ── the laws ────────────────────────────────────────────────────────
  let failed = false;
  const fail = (line) => {
    failed = true;
    console.error(`LAW BROKEN: ${line}`);
  };
  // The byte law: the unarmed twin against today's number, on every call.
  for (const [i, bytes] of twin.slotBytes.entries()) {
    if (bytes !== UNARMED_TOOLS_SLOT_BYTES) {
      fail(
        `unarmed twin's tools-slot bytes on call ${
          i + 1
        } are ${bytes}, today's are ${UNARMED_TOOLS_SLOT_BYTES}`,
      );
    }
  }
  // …and the advisory rows against the twin: advisory changes nothing on the wire.
  for (const c of cells.filter((c) => c.arm === 'advisory')) {
    if (JSON.stringify(c.slotBytes) !== JSON.stringify(twin.slotBytes)) {
      fail(
        `advisory/${c.script} tools-slot bytes ${JSON.stringify(
          c.slotBytes,
        )} differ from the twin's ${JSON.stringify(twin.slotBytes)}`,
      );
    }
    if (c.misses !== 0)
      fail(`advisory/${c.script} recorded ${c.misses} misses; an un-narrowed call cannot miss`);
  }
  // The miss law (scripted classifier only — a hosted ranking is not a script).
  if (!hosted) {
    for (const c of cells.filter((c) => c.arm === 'top-2')) {
      if (c.script !== 'wrong-pair' && c.misses !== 0)
        fail(`top-2/${c.script} missed ${c.misses} times`);
      if (c.script === 'wrong-pair' && c.misses !== c.narrowedToolCalls) {
        fail(
          `top-2/wrong-pair: ${c.misses} misses over ${c.narrowedToolCalls} narrowed tool calls — every one should miss`,
        );
      }
      if (c.script === 'wrong-pair' && !c.skipped.every((s) => s === 'after-miss')) {
        fail(`top-2/wrong-pair: skips ${c.skipped.join(',')} — only after-miss expected`);
      }
    }
    const rf = cells.find((c) => c.arm === 'top-2' && c.script === 'right-first');
    if (rf && rf.firstAgrees !== 1)
      fail(`top-2/right-first first-agrees ${fmt(rf.firstAgrees)}, expected 1.000`);
    if (rf && rf.meanSlotBytes >= twin.meanSlotBytes) {
      fail(
        `top-2/right-first tools-slot bytes ${fmt(rf.meanSlotBytes, 1)} not below the twin's ${fmt(
          twin.meanSlotBytes,
          1,
        )}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
