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
| `envelope.ts` | `semantic()` (mint, refuses at the call site), `readSemantics()` (strict recognition — the zero-cost guarantee), `semanticIssues()`/`explainSemantics()` (ONE rule set for mint, recognition and the gate), `semanticsForModel()` (the model's compact rendering-free projection), `coverageOfSemantics()` (the absorb seam `readCoverageResult` uses) |
| `check.ts` | `checkSemantics(entries)` — the gate core over sample results; severity follows provability (the skillGraph check-up law) |
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

## The marker and the note cross a language boundary (9.70.0)

`SEMANTICS_MARKER` and `SEMANTICS_NOTE` are bytes a foreign process must
reproduce exactly to mint an envelope this library will recognize. They are
published as data alongside the coverage/absence family in
`canonical-notes.json` at the package root — GENERATED from the built barrel
by `scripts/gen-canonical-notes.mjs`, never hand-maintained. See
`src/core/agent/coverage/README.md` for the argument.

## Composition

`{ content: semantic({…}), effects: […], status }` — the effects envelope
wraps, the semantic envelope is the content. `absent()` stays the answer for
"I looked and found nothing". A semantic envelope carries its own `coverage`
field; do not wrap it in `coverage()`.
