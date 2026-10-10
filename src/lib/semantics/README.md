**Mixed** — the caveats that make a tool's numbers honest.
Map: `types.ts` (the declared vocabulary), `envelope.ts` (mints and recognises
it), plus the build-time gate `check.ts` / `format.ts` / `cli.ts`.
Lens: `semanticsForModel()` in `envelope.ts` is the model's compact projection
of the envelope, and `composeNotCovered` writes the absence prose — a served
view that must not overclaim coverage.

# semantics — the semantic tool-result envelope + `check:semantics`

A tool that answers with numbers owes the reader the caveats that make the
numbers honest: the collection interval, whether the values are counters that
must never be summed, when the world was actually measured, and which ground
was NOT covered. Before this module those caveats were re-implemented by hand
inside every disciplined tool and held in place by review — culture, which
scales to one author and not to a hundred tools. This module makes them typed
data that travel with the values, and a build gate that refuses a tool that
forgot them.

## The pieces

| file | one job |
|---|---|
| `types.ts` | the vocabulary, as a PURE leaf (the `toolOutcome.ts` precedent): marker, field types, the closed `ToolResultClass` set, the counter-word list, the static note. Type-only imports of the coverage vocabulary — absorbed, never duplicated |
| `envelope.ts` | `mintSemantics` (the ONE mint behind the canonical declaration door, refuses at the call site), `readSemantics()` (strict recognition — the zero-cost guarantee), `semanticIssues()`/`explainSemantics()` (ONE rule set for mint, recognition and the gate), `semanticsForModel()` (the model's compact rendering-free projection), `coverageOfSemantics()` (the absorb seam `readCoverageResult` uses) |
| `described.ts` | `describedResult()` — the camelCase door: it says how its author spells the declaration and respells `grain`/`provenance`/`render` to the wire; it judges nothing itself |
| `check.ts` | `checkSemantics(entries)` — the gate core over sample results; severity follows provability (the skillGraph check-up law) |
| `projection.ts` | bounded metadata preservation shared by `withDatasetArtifacts` and optional paired gate fixtures; no row scan or fact validation |
| `format.ts` | terminal rendering; every finding names its tool and its field |
| `cli.ts` | the humble-shell CLI core behind `bin/agentfootprint-check-semantics.mjs` (exit codes 0/1/2, the tool-lint convention) |

## Two views of one envelope

- **The model** reads `semanticsForModel()`: series/facts/edges + grain +
  provenance + the composed `not_covered` prose + a non-null `clarify` + the
  static note. It never sees the marker, the `render` hints, or the
  three-list coverage detail.
- **The record** gets everything: the full envelope rides
  `agentfootprint.tools.semantics_declared` BEFORE the result ceiling is
  measured, so grain and provenance survive to recordings even when the
  content is refused as oversized. The `coverage` field is additionally
  declared through the same channel `coverage()` uses.

## One authoring door, unchanged wire

`describedResult()` takes camelCase declarations and passes them to the one
`mintSemantics` implementation. `DeclarationDoor` describes the authoring
spelling; the rule set stays shared with wire recognition and the build gate.
The input type `DescribedResultDeclaration` is separate from the wire types
`SemanticProvenance`, `SemanticGrain` and `SemanticRender`. A malformed
object reaches that shared rule set unchanged and is refused, not repaired.

```ts
describedResult({ facts: rows, provenance: { measuredAt: exportTime, source: 'RVTools export' } });
// The wire still carries provenance.measured_at, never measuredAt.
```

### Migration from the removed declaration door

The deprecated `semantic()` function and `SemanticDeclaration` type have been
removed. Use `describedResult()` and `DescribedResultDeclaration`. In declarations,
rename `is_counter` → `isCounter`, `measured_at` → `measuredAt`,
`age_seconds` → `ageSeconds`, `source_export_date` → `sourceExportDate`,
`filter_note` → `filterNote` and `chart_hint` → `chartHint`. Coverage
declarations already use `notChecked` and `cannotCover`; keep those names.
Series and facts require provenance in the declaration type as well as at runtime.

Do **not** rename keys in saved records or foreign-language wire envelopes:
`ToolSemantics`, its snake_case fields, the marker, note and model projection
are unchanged. `readSemantics()` continues to recognize valid saved envelopes.

Pinned by `test/lib/semantics/described-result.test.ts`: six independently
captured historical envelopes and model projections, unchanged inline goldens,
and the original seeded generator checked against 3,000 ordered legacy outcomes.
The provenance, wire-type and removed-export compile contracts are pinned by
`test/type-regressions/DescribedResult.assignability.test.ts`.

## A refusal reads as a refusal; an unknown key is never dropped

The declaration door shares the coverage helpers' law
(`src/core/agent/coverage/README.md` § 5, the owner `refusal.ts`): every key
the declaration — or its `grain`, `provenance`, `coverage`, `clarify` or
`render` — carries is one the mint reads, or a refusal naming the spelling
meant; and every refusal starts `refused: `, never with a helper's name.
Thrown inside `execute`, that text is the call's error result the model
reads. The rule set is judged ONCE, over the wire-spelled candidate, and
each field is named back the way the door's author spelled it
(`envelope.ts` · `issuesIn` takes the door's `Spelling`):

```ts
describedResult({ facts: rows }); // no provenance (from plain JS — TypeScript refuses it first)
// refused: this result carries series/facts with no `provenance` —
// `provenance.measuredAt` and `provenance.source` are required whenever the
// envelope carries data: a number with no age and no source cannot be trusted
// or audited. (field: provenance)

describedResult(JSON.parse('{"facts":[{"entity":"vm-01"}],"provenance":{"measured_at":"now","source":"s"}}'));
// refused: 'provenance.measured_at' is not a field this vocabulary has — did
// you mean `measuredAt`? The fields of `provenance` are: measuredAt,
// ageSeconds, source, sourceExportDate.

describedResult(JSON.parse('{"facts":[{"entity":"vm-01"}],"coverage":{"not_checked":["vCenter"]}}'));
// refused: 'coverage.not_checked' is not a field this vocabulary has — did you
// mean `notChecked`? The fields of `coverage` are: checked, notChecked, cannotCover.
```

The four `semanticIssues` messages that had no subject start "this result …",
so the same text reads whole after the prefix, in `explainSemantics` and in
the gate's findings — which recognize the WIRE, so they always speak
snake_case.

## An empty list names the one door for "nothing matched" (honesty step 7a′)

**The law.** A data list (`series`, `facts`, `edges`) is never empty, so
"nothing matched" has exactly one door — `absent()` — and the refusal says so.
It used to say "omit the field to say nothing", which on the found branch's only
data field led straight to the next refusal ("this result declares nothing").
And the fault is data-dependent: a tool with no empty branch passes every test
that has rows and meets it on its first empty read in production, where the
MODEL reads the refusal instead of "nothing matched". So it names the branch to
write (`envelope.ts` · `emptyDataList`, one core for declaration, recognition and the gate):

```ts
execute: async ({ host }) => {
  const rows = (await loadExport()).rows.filter((r) => r.host === host);
  // describedResult({ facts: [] , … }) would be refused:
  //   refused: `facts` is empty — if nothing matched, return absent({ what, checked }) instead. (field: facts)
  return rows.length
    ? describedResult({ facts: rows, provenance: { measuredAt: exportedAt, source: 'backup export' } })
    : absent({ what: `backup runs for ${host}`, checked: [`every job in the export of ${exportedAt}`] });
},
```

A value that is not a list at all (a string, a plain object, a number) reaches
the rule set untouched and is refused as one — "`facts` must be a non-empty
array of rows" — where a spread used to crash on an object (a `TypeError`, which
does not read as a refusal) or refuse a string's characters as malformed rows;
any other iterable still mints, copied into a fresh array (`envelope.ts` ·
`copyDataList`). Pinned by `test/lib/semantics/empty-data-refusal.test.ts`,
and the refusal is a registered model-facing sentence
(`test/modelFacingSurfaces.test.ts`).

## The period (honesty step 7b)

`describedResult({ …, period })` — what the READ behind the data covered in
time: `queried` (the instants it asked for), `held` (what the store holds, or
`'unknown'`) and `readAt`, every value an ISO 8601 instant with a zone. A
top-level field on `af_semantics` (after `provenance`), minted by the ONE period
rule set (`core/agent/coverage/period.ts` · `mintPeriod`) and refused there in
camelCase; `semanticsForModel` serves it as declared; the recognizer holds a
foreign envelope's period to the same rule set (`period.ts` · `periodProblem`,
wire spelling) — a fault is one more `semanticIssues` fault, so the envelope
stays data. `readCoverageResult` absorbs it into the coverage channel like
`coverage`: an envelope with a period and no coverage files a `'ledger'` row
whose three lists are empty. Historical envelopes without a period remain valid;
the reader never invents a period for them.
The results layer (`core/agent/results/`) files the verdict. The provenance
rule is shared with `absent()` the same way (`described.ts` · `mintProvenance`,
`envelope.ts` · `provenanceIssues`).

```ts
return describedResult({
  facts: rows,
  provenance: { measuredAt: snap.exportedAt, source: 'nightly export' },
  period: { queried: { from, to }, held: { from: snap.heldFrom, to: snap.exportedAt } },
});
```

## The marker and the note cross a language boundary (9.70.0)

`SEMANTICS_MARKER` and `SEMANTICS_NOTE` are bytes a foreign process must
reproduce exactly to mint an envelope this library will recognize. They are
published as data alongside the coverage/absence family in
`canonical-notes.json` at the package root — GENERATED from the built barrel
by `scripts/gen-canonical-notes.mjs`, never hand-maintained. See
`src/core/agent/coverage/README.md` for the argument.

## Composition

`{ content: describedResult({…}), effects: […], status }` — the effects
envelope wraps, the semantic envelope is the content. `absent()` stays the
answer for "I looked and found nothing". A semantic envelope carries its own
`coverage` field; do not wrap it in `coverage()`.

## Check an adapter's before/after projection

An optional `projections` list on each `SemanticsCatalogEntry` adds paired fixtures
to the existing gate. Existing catalogs stay unchanged. The CLI carries the same
pairs through from JSON; both `before` and `after` keys are required, including
when their value is null.

```ts
const before = coverage({ rows: [{ id: 'one', value: 0 }] }, {
  checked: ['snapshot A'], notChecked: ['live state'],
});
const after = { ...before, result: { dataset: { ref: 'fixture-ticket' } } };
const report = checkSemantics([{ name: 'lookup', results: [before],
  projections: [{ before, after }],
}]);
if (!report.ok) throw new Error(formatSemanticsReport(report));
```

The paired check uses the same `projection.ts` helper as `withDatasetArtifacts`.
It compares only existing reserved absence/coverage/semantic declarations and
recognized effect-envelope status/effects through documented wrapper locations.
An erased or changed declaration is an error naming the tool, pair and field;
unsafe or over-limit metadata is an unreadable-declaration error without values.
Inherited reserved declarations are refused rather than silently omitted.
Object key order does not matter; array order does. New unrelated metadata is
allowed. Empty arrays, null and arbitrary legacy application fields imply nothing.
The guard snapshots declarations before the adapter can mutate them, using at
most 16 wrapper levels, 16 nested metadata containers, 10,000 metadata values/keys
and 65,536 string/key UTF-16 characters; it invokes no getters or `toJSON` hooks.

`semanticIssues` still owns full semantic schema validation. This guard does not
scan data rows, establish factual truth, require a universal outcome taxonomy,
or prove that every later renderer or middleware preserves declarations. A build
gate checks the fixtures supplied to it; include absence, clarification, partial
coverage and ordinary success samples from the actual adapter. Capture the
`before` fixture before executing a mutating adapter rather than keeping two
aliases to the same object. `requestInput` is an exception-based pause and travels
through the wrapper unchanged, before any result projection takes place.
