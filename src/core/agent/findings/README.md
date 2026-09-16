**Mixed** — the model's own findings, on the record: a basis before each tool
call, a standing on each previous result after.
Map: `types.ts` (the reserved name, the vocabularies, the row shapes).
Walker: `reserved.ts` — the decorator that adds `_findings` to a served
schema and the two peels that take it back off before anything else reads
the model's words.
Trace: `ledger.ts` — one writer for one committed key
(`AgentState.findingsLedger`), plus the fold that reads it.

# `findings/` — ride-along findings

## Which "findings"

These are the **model's** findings: what it says it stands on (`fact`), keeps
open (`open`), ruled out (`ruled-out`) or found to be nothing (`noise`). The
word is `standing`. They are not the Context Integrity rail's findings —
`core/agent/integrityFindings.ts` files `ContextError`s the **library**
detected — and not `integrity/disposition`'s verdicts, which own the word
'disposition'. Nothing in this folder is detected; everything is declared,
and every row names the call or answer that declared it.

## Why

A tool result the model has already judged is served to it again on every
later call, at full size, with no mark saying what the model made of it. The
model knows — it acted on the result — but the record does not, so nothing
downstream (a window strategy, a lens, a check) can tell a fact the answer
rests on from a probe that found nothing. Asking a second model to judge
would cost a call per result and put a second voice on the record.

So the ask rides along. Every served tool schema gets one reserved optional
property, `_findings`, and the model declares on each call why it makes it
(`basis`) and, on the next call or on a JSON answer, what each previous
result **is** to it. Zero extra calls. The library peels the property off
before the tool, the middleware or the validator sees the args, files the
rows, and leaves the assistant turn in history verbatim — the declaration is
the emission, hashed by the receipt like any other argument.

## The laws here

- **Never infer.** A call without `_findings` files no row; a result no call
  names has no standing (undeclared, never `open`); a field that fails its
  enum check is dropped and counted, never defaulted.
- **Append only, last wins.** A second standing on one result is a second
  row; `foldLedger` takes the last. Two disagreeing standings are two rows,
  not a conflict — the algebra sees assertions only.
- **The stratum is a mapping, not a reading.** `fact` → `asserted`;
  `open` / `ruled-out` → `quoted`; `noise` → no assertions. `epoch` is never
  set. A conflict row is written once per key from `conflictsOf`'s output,
  witnesses as identities only.
- **The emission is never rewritten; only what stands is peeled.** History
  keeps `toolCalls[].args` verbatim, and a re-ask exit (`output-retry`,
  `step-nudge`, `evidence-recheck`) quotes the answer as the provider sent
  it; the answer that stands, and everything a call RUNS with — `callArgs`,
  the pause and halt carriers — is the peeled form.
- **A tool that owns the name keeps it.** `ownsReservedArgument` is the one
  predicate: a registry schema declaring `_findings` is refused at build
  (armed only); a provider or MCP schema declaring it is served undecorated,
  and a call to that tool is not peeled — the value is the author's
  argument, and it files no row.
- **Nothing here is served differently.** The ledger is a record; what the
  wire does with it is a later step, bench-gated.

## One example

```ts
import { splitFindings } from './reserved.js';
import { basisRowFrom, foldLedger, recordFindings, standingRowsFrom } from './ledger.js';

// The model's second call, carrying its basis and a standing on the first result.
const tc = {
  id: 'call_2',
  name: 'lookup_port',
  args: {
    port: 'fc1/7',
    _findings: {
      basis: 'direct',
      previous: [
        {
          toolCallId: 'call_1',
          standing: 'fact',
          assertions: [{ subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state', value: 'up' }],
        },
      ],
    },
  },
};

const { args, findings } = splitFindings(tc.args); // args = { port: 'fc1/7' } — what the tool runs with
recordFindings(scope, standingRowsFrom(previousBatch, findings!, { toolCallId: tc.id }, iteration));
recordFindings(scope, [basisRowFrom(tc, findings!, iteration)]);

foldLedger(scope.findingsLedger!).standingOf.get('call_1')?.standing; // 'fact'
```

## What it reads / what it writes

- Reads a tool call's args (`splitFindings`), a JSON answer
  (`peelAnswerFindings`), the previous batch's `toolResults` entries, and a
  placed result's ticket through `artifacts/placement.ts · isPlacedToolResult`
  — the one guarded parse, of a string the library minted.
- Writes `findingsLedger` through `recordFindings` only, a fresh array per
  write; emits `agentfootprint.findings.declared` and
  `agentfootprint.findings.standing` — identities, enums and counts, never a
  value or a line of model text.

## Proved on the wire, measured on the record

- **The name survives every adapter.** `_findings` is public forever once a
  model has seen it, so `test/adapters/reservedArgumentSurvives.test.ts`
  landed before the name did: the property crosses each provider's
  `inputSchema` mapping byte-for-byte with `required` untouched and the served
  schema never mutated — Anthropic (`input_schema`), OpenAI
  (`function.parameters`), Gemini (`parametersJsonSchema`), Bedrock
  (`toolSpec.inputSchema.json`), Ollama, Foundry hosted and local, and the two
  browser providers. A new adapter joins that file before it ships.
- **An unarmed agent records the bytes it recorded before.** The 15
  byte-identity references under `test/core/tools/reference/` pass untouched;
  `agent-findings.json` is the one armed reference, generated alone, and its
  delta against an unarmed twin is on that test file's header.
- **The bench decides.** `npm run bench:findings` (`bench/findings-context.mjs`)
  runs each configuration unarmed and armed with the mock's scripted calls
  carrying `_findings`, and exits non-zero if any of the six baseline columns
  moves under the arm — the step-2 law: the ledger is a record, nothing is
  served differently. The mock scripts compliance and its usage estimate does
  not count tool-call args, so what a real model declares and what the ask
  costs are real-model numbers; the design page has the printed table.

## Files

- `types.ts` — `RESERVED_ARGUMENT`, the vocabularies, `FindingsDeclaration`
  (the wire), `BasisRow` / `StandingRow` / `ConflictRow` (the record).
- `reserved.ts` — `FINDINGS_ARGUMENT_SCHEMA`, `withFindingsArgument`,
  `splitFindings`, `peelAnswerFindings`, `FINDINGS_INSTRUCTION`.
- `ledger.ts` — `recordFindings`, `foldLedger`, `standingRowsFrom`,
  `basisRowFrom`.

Design: `docs/design/2026-09-findings-ledger.md`; the spec of record is
`docs/design/2026-09-findings-ledger-spec.md`.
