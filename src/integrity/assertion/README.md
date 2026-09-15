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
