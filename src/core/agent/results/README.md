**Walker** — the results layer (honesty layer 3): the subflow at the loop head that reads what the batch just run declared about the period its reads covered, and files one verdict per call on the one ledger.

**The law.** A result says what it covered, its period included; silence about a declared period is recorded as silence.

This folder holds only the subflow — `subflow.ts`: Declare → Verify → Record → Resolve. Its
rules stay with their data: the period's shape, its one rule set, the verdict and the row are
`coverage/period.ts`'s; the doors that carry a period are `coverage/absent.ts` · `absent`,
`coverage/ledger.ts` · `coverage` and `lib/semantics/described.ts` · `describedResult`; the
mount is `honesty/mounts.ts` · `mountResultsLayer`; the ledger's merge and emit halves are
`findings/ledger.ts` · `appendRows` and `findings/ledger.ts` · `emitRow`. Design page:
`docs/design/honesty/results.md` (§ 3, § 5, § 7 step 7b).

```ts
import { Agent, absent, defineTool, describedResult } from 'agentfootprint';

const backupRuns = defineTool({
  name: 'backup_runs',
  description: 'Failed backup runs for one host, read from the nightly backup export.',
  inputSchema: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] },
  execute: async ({ host }) => {
    const snap = await loadExport(); // { exportedAt, heldFrom, rows } — the export's own times
    const rows = snap.rows.filter((r) => r.host === host && !r.ok);
    const period = {
      queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' }, // what the read asked for
      held: { from: snap.heldFrom, to: snap.exportedAt },                    // what the store holds
    };
    return rows.length
      ? describedResult({ facts: rows, provenance: { measuredAt: snap.exportedAt, source: 'nightly export' }, period })
      : absent({ what: `failed backup runs for ${host}`, checked: ['every job in the export'],
                 provenance: { measuredAt: snap.exportedAt, source: 'nightly export' }, period });
  },
});

const agent = Agent.create({ provider, model }).tool(backupRuns).resultsLayer().build();
await agent.run({ message: 'Any failed backups on host-103 in the last hour?' });
agent.findings();     // [{ kind: 'period', toolName: 'backup_runs', verdict: 'not-held', … }]
(await agent.assessment())?.reasons; // [{ reason: 'declared-absent', … }, { reason: 'period-not-held', layer: 3, … }]
```

The runnable example is `examples/features/78-result-period.ts`: a nightly export asked about
the last hour reads "not sure — the store does not hold the period asked about", the same
question inside the export's period reads with no period reason, and a tool that declares a
period argument but whose result says nothing reads `period-undeclared`.

## The seven clauses

| # | Clause | The results layer |
|---|---|---|
| 1 | DECLARE | the tool author, in the result: `period` on all three doors — `{ queried, held \| 'unknown', readAt? }`, ISO 8601 instants WITH a zone (`coverage/period.ts` · `DeclaredPeriod`) — and `provenance` on `absent()`, the shape `describedResult()` already carries (`lib/semantics/described.ts` · `mintProvenance`). On the tool: a `ToolPeriod` (the inputs layer's declaration — `arguments/declare.ts` · `ToolPeriod`), which names the argument that sets the period. A malformed period is REFUSED at the mint (`coverage/period.ts` · `mintPeriod`); an envelope minted elsewhere is READ, never repaired (`coverage/period.ts` · `readPeriod` drops it from the record with one dev warning per tool; on `af_semantics` it is one more fault of `lib/semantics/envelope.ts` · `semanticIssues`, so the envelope stays data) |
| 2 | VERIFY | `coverage/period.ts` · `periodVerdict` — one pure rule over the instants the tool declared, bounds inclusive: `covered`, `partly-held`, `not-held`, `unknown` (`held: 'unknown'`); the least held when one call declared two (`coverage/period.ts` · `leastHeld`); `undeclared` when the tool declares a `ToolPeriod` and the result declared no period. No clock is read and no duration is parsed |
| 3 | RECORD | one `period` row per judged call (`coverage/period.ts` · `PeriodRow`: `turn`, `toolCallId`, `toolName`, `iteration`, `verdict`, the `ToolPeriod`'s `argument`), merged into `findingsLedger` by the mount's output mapping in ONE write; one `agentfootprint.findings.period` per row, fired inside the subflow — the tool, the call, the stamps and the verdict word, never an instant. The declared period itself rides the coverage channel (`coverageDeclared` rows, `tools.absent` / `tools.coverage_declared`), whatever the agent armed; the row never copies it |
| 4 | RESOLVE | flag — the only verb a result that already ran admits (`subflow.ts` · `resolveResultsStage`): the rows are the flags |
| 5 | FOLD | `assessment/assess.ts` · `assessAnswer`: `period-not-held`, `period-partly-held`, `period-unknown` (adopted Q33: on a non-empty result too) and `period-undeclared`, all "not sure"; under `.time()` (step T8) also `period-differs-from-asked` and `period-beyond-retention`, both "not sure" (below); `covered` fires none; `result-period` on `checked`; no period row can support "known". A period reason's witnesses are the `period` row AND the inputs layer's `argument` row for the same call — who chose the period beside what the read covered |
| 6 | SERVE | the model: the period in the result it read, as declared (`lib/semantics/envelope.ts` · `semanticsForModel` passes a described result's through; `absent()` and `coverage()` serve theirs in the envelope) — plus, since bench round 1, when the store did not hold all of the time asked, the verdict word inside it (`period.verdict`: `not-held`, `partly-held`, `unknown`) and that word's ONE static note clause (`coverage/period.ts` · `PERIOD_VERDICT_CLAUSES`), added by the SERVE door (`coverage/read.ts` · `servedToModel`, `semanticsForModel`), never by this layer and never minted into the tool's output; an absence then reads `coverage/absent.ts` · `ABSENCE_NOTE_HELD_ONLY` in place of the note that claims a complete answer. A `covered` period gains nothing. The word and clause never ground (`coverage/evidence.ts` · `absenceEvidenceProjection` reads through `coverage/read.ts` · `withoutServedPeriod`). The person, under the existing `.limitsTravelWithTheAnswer()` only: one `Period:` line per declaring call (`coverage/period.ts` · `periodLine`, composed by `coverage/answer.ts` · `composeAnswerWithCoverage`), and `periods` in a typed answer's limits (`coverage/answer.ts` · `coverageOfAnswer`). The lens: the rows and the events |
| 7 | ARM + MEASURE | a REGISTERED tool that declares a `ToolPeriod` arms the mount (`core/Agent.ts`, "The results layer (honesty layer 3, step 7b) — armed ONCE, here"); `AgentBuilder.resultsLayer()` arms it for tools a ToolProvider serves and for tools that declare a period only on their results. A period declared with no layer mounted is still recorded, and one dev warning per tool says no verdict is filed; a `ToolPeriod` a ToolProvider served (which the build cannot see) on an agent without the layer is dev-warned the same way, once per tool, at dispatch (`stages/toolCalls.ts` · `warnToolPeriodUnjudged`). Nothing declared → nothing mounted, read or written: every run is byte-identical. The bench: cells R1–R3 of `docs/design/honesty/results.md` § 8 |

## Under `.time()`: what was read against what was asked (step T8)

**The law.** A read that is not the window asked about answers a different question: asked but
not read is `missing`, read but not asked is `extra`, and either makes the answer "not sure"
(TQ8: a wider read too — unless the result declares that it read exactly what was asked).

With `.time()` armed, the mount also hands the layer each call's time rows (`honesty/mounts.ts` ·
`timeOfBatch`: its `call-window` row and its `call` row's `drift`) and the clock's `now`; Verify
asks `core/time/check.ts` · `periodTimeCheck` and Record files what holds on the call's `period`
row — `differs { against, asked, read, source, stepMs?, missing, extra }`, `shifted { byMs }`,
`beyondRetention`, `partlyBeyondRetention` — and names them (never a range) on the
`findings.period` event's `timeChecks`. What was read: the result's declared `queried` (inclusive,
read back as `[from, to + step)`, `step` the tool's `granularity`, else 1 ms), else a widened fill's
`sent`, else a look-back shifted by its drift, else the asked range. A window the model chose is
judged against the person's window.

```ts
const clientActivity = defineTool({
  name: 'client_activity',
  /* …inputSchema, askOrAssume… */
  period: { forms: [{ kind: 'bounds', from: { argument: 'start_time', as: 'epoch-ms' },
                      to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' } }] },
  // The store clamps any read to the last 7 days — and says so:
  execute: (args) => describedResult({ facts, provenance, period: { queried: lastSevenDays, held } }),
});
const agent = Agent.create({ provider, model }).tool(clientActivity)
  .time({ zone: 'America/Los_Angeles' }).limitsTravelWithTheAnswer().build();
await agent.run({ message: 'activity this month', time: { window: lastThirtyDays } });
agent.findings();  // … { kind: 'period', verdict: 'covered', differs: { missing: [<the first 23 days>], extra: [] } }
(await agent.assessment())?.reasons; // [{ reason: 'period-differs-from-asked', layer: 3, … }]
```

Without `.time()` the layer is handed none of this, and every row, event and line is the bytes it
was. The runnable example is `examples/features/88-time-result-checks.ts`.

## Where it runs

At the LOOP HEAD, before the window strategy's `Compact`, and the loop target: ToolCalls'
`loopTo` lands on it, so it reads the batch just run before any window strategy folds it away
(`buildAgentChart.ts` and `buildDynamicAgentChart.ts`, through the one helper). It is handed
identities only — the batch's call ids and tool names (`toolResults`, never a result's bytes),
the periods those calls' results declared (their `coverageDeclared` rows of the batch's
iteration), and the stamps. On the first iteration there is no batch.

**Each batch is judged once per run — told apart by its iteration, never by a call id.** A
re-entry that ran no tool — the schema re-ask, the step nudge, the evidence recheck, the
wrap-up — leaves the batch in place and loops back here. ToolCalls stamps the batch it
dispatches with its iteration (`AgentState.toolResultsIteration`, under the arm only) and
advances the iteration by one; every other way back advances it again. So the batch is new
exactly when the loop head is one iteration past the stamp, and only then is it handed to the
layer (`honesty/mounts.ts` · `batchToJudge`). A batch paused before anything stamped it — a
checkpoint from an older build, or from an agent without the layer — is stamped as it completes
on resume, so it is still judged once. A call id cannot say it: a provider's synthetic
ids restart with each provider instance (`<prefix>-call-${++toolCallSeq}`), so a leg resumed
with `resumeOnError` repeats the ids of the leg that failed — whose rows the checkpoint
carries — and nothing stops a provider reusing an id across batches. For the same reason the
standing reads EVERY `period` row of the turn, never "the last per call": a later `covered`
under a reused id must not hide an earlier `not-held`.

```ts
// Leg 1: 'gemini-call-1' read inside the export (covered) — then the model call throws (503).
// Leg 2, a fresh process: resumeOnError(checkpoint) — the provider's counter restarts, and
// 'gemini-call-1' now reads an hour after the export ends.
agent.findings(); // [{ kind: 'period', toolCallId: 'gemini-call-1', verdict: 'covered', … },
                  //  { kind: 'period', toolCallId: 'gemini-call-1', verdict: 'not-held', … }]
(await agent.assessment())?.standing; // 'not-sure' — period-not-held
```

A `ToolPeriod` is read off the implementation that ANSWERED the call — the shared dispatch
resolver, which at the loop head still answers for the epoch that dispatched the batch — by the
inputs layer's own reader (`arguments/declare.ts` · `rulesOf`).

## Not covered

- **A call that never ran** (denied, refused, errored) and whose tool declares a `ToolPeriod`
  reads `undeclared`: `toolResults` does not say which calls ran, so the layer files a verdict
  per call in the batch. It may over-report; it never hides. Honesty step 8's outcome row per
  call closes it.
- **A period the tool misstates.** The declaration is trusted: a store that says it holds what
  it does not produces an honest-looking verdict. The study checks that from outside.
- **A tool that clamps its period silently** (`narrower-than-asked`) — not in v1 (adopted Q39):
  catching it would bend "the library never parses '2h'".
- **JSON-text envelopes** (an `mcpClient` in its default text mode) are not recognized at the
  door, so their period is neither recorded nor judged — use `resultMode: 'structured'`
  (adopted Q40).
- **An older reader** serves a period on `af_absent` / `af_coverage` to the model as tool
  knowledge and files nothing, and REFUSES a whole `af_semantics` envelope that carries one
  (its strictness law) — the changelog names the floor; the lens must learn `period` before a
  tool mints one.

## What it lets you measure

From the record alone, per tool, per model, per prompt or skill version: the period
declaration rate among tools that declare a period argument (a verdict other than
`undeclared`, of all `period` rows); the period verdict mix (covered · partly held · not held ·
unknown · undeclared); the held-unknown share (stores their tools cannot vouch for); answers
that claim past their period (a flat claim on an answer with `period-partly-held` or
`period-not-held` among its reasons); and, from `tools.absent`, the provenance rate on absences
— how often "nothing" names its source and time. It measures claims within what the record
covered — not whether a tool's own declaration is true.
