**Fold** — one typed claim about one subject, and the pure comparison that says
which current readings cannot all satisfy their declared single-valued predicate.

## Shared implementation

`contextfootprint` supplies assertion types, value participation, comparison and
subject equality. `conflicts.ts` delegates to that implementation with Agent's
existing key encoding from `types.ts`; recorded keys and witness objects keep
their existing shape. A recording-key migration is separate work.

The comparator reads a finite assertion set and writes nothing. Quoted history,
unknown values, different epochs and multi-valued predicates keep their existing
exclusions. Values retain the existing sorted-key JSON comparison limits.

## Consumer responsibilities

Agent still collects and stamps evidence, runs checks at its existing boundaries,
records findings and determines dispositions. `.claims()` stays diagnostic;
`.answerValidation()` retains its configured enforce/observe behavior. No conflict
is not a passed validation: evidence may be missing or incomparable.

The dependency is commit-pinned and bundled; see `vendor/contextfootprint/README.md`.
`npm run test:context-package` verifies a packed offline consumer in CJS, ESM and
both TypeScript modes after `npm run build`.
