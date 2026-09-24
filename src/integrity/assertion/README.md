**Fold** — one typed claim about one subject, and the pure comparison that says
which current readings cannot all satisfy their declared single-valued predicate.

## Shared implementation

`contextfootprint` supplies assertion types, value participation, comparison and
subject equality. `conflicts.ts` delegates to that implementation with Agent's
existing key encoding from `types.ts`; recorded keys and witness objects keep
their existing shape. A recording-key migration is separate work.

The comparator reads a finite assertion set and writes nothing. Quoted history,
unknown values, different epochs and multi-valued predicates keep their existing
exclusions. Values retain the existing sorted-key JSON comparison limits. Own JSON fields
such as `__proto__` remain comparison data, including inside nested objects;
normalization must not turn them into prototype operations or drop them. The
shared-boundary regression also exercises the existing post-call claim checker
so this dependency fix cannot disappear behind an unchanged recording key.

## Consumer responsibilities

Agent still collects and stamps evidence, runs checks at its existing boundaries,
records findings and determines dispositions. `.claims()` stays diagnostic;
`.answerValidation()` retains its configured enforce/observe behavior. No conflict
is not a passed validation: evidence may be missing or incomparable.

The dependency is the exact published `contextfootprint: "0.1.1"`, with registry
integrity recorded in the source lockfile. It is installed normally rather than
vendored or bundled. A consumer's own package manager creates its lockfile.
`npm run test:context-package` checks clean online and cached offline installation
of source and packed consumers, then CJS, ESM and both TypeScript modes after
`npm run build`. Offline installation requires a populated npm cache.

## Waiting for its reader: the provenance tier (not shipped, 9.113.0)

The honest-answer design (`docs/design/2026-09-honest-answer-ledger.md` § 5.1;
the decisions memo § 2.1) gives every assertion row a TYPED tier saying who put
the value on the record:

```ts
type ProvenanceTier =
  | 'claimed'   // the caller said so (an HTTP body, a form field) — before authentication
  | 'answered'  // a person, through a declared field of a pause the run raised
  | 'given'     // app code decided it: a grounder, a resolver verdict, a declaration
  | 'observed'  // a tool returned it: a result, an absent() / coverage() envelope
  | 'checked'   // ONE owner: a passed enforce AnswerValidationReport for these bytes
  | 'judged';   // a model or a classifier said it: _findings, score_skills, a judgment row
```

ONE writer would carry the tier and RENDER ContextFootprint's `provenance`
string as `<tier>:<source>` (`'observed:tool:c1'`, `'given:estate-naming-rule'`),
so the string can never disagree with the tier — never two provenance fields on
one row. `'checked'` is never read off `AgentState.answerGuarantee` (a shape
fact: the output schema parsed the text), only off
`../../answer-validation/types.ts · AnswerValidationReport`.

**Why it waits.** A field ships with the reader that reads it, and none reads a
tier in this release. The provenance strings the library writes today
(`../../core/agent/findings/ledger.ts · standingRowsFrom`: `tool:<id>` or
`artifact:<ref>`; each integrity check's prose witness) are quoted to people;
no code decides anything on them — `conflicts.ts · conflictsOf` compares
subject, predicate, value, stratum and epoch. The 9.113.0 ledger rule
(`../../core/agent/findings/unsettled.ts · unsettledRowOf`) reads the standing
word, the result as the model was served it, and the dispatch door's own record
that the tool returned an absence (a `kind: 'absence'` row on `coverageDeclared`
— a tool's return is `observed` by construction, so a tier there would restate
the door), the served piece reads the rows' own fields, and
the lens-facing projections copy what the rows hold. A tier nothing reads would
be a second spelling of the source string that nothing keeps honest.

**What earns it.** The minimum-strength rule (design § 5.1): a subject kind
used to SELECT a skill or KEY a collector must be `given`, `observed` or
`answered` (a `judged` placement never selects), and a value the answer labels
checked must be `checked` — with its sibling, a winner DECLARED per predicate
(`given` beats `judged` for selection) instead of a silent one. Both belong to
the gated step 3 of that design. The tier ships in the same release as that
rule, with a test that fails without it. One pin is decided before the first
row from another copy is joined (memo Q10): this wrapper compares on the legacy
delimiter key (`types.ts · assertionKey`), while ContextFootprint's default —
and the host's copy — use the tuple key.
