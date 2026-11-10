**Mixed** — settle the records a native run ends on.
`verdicts.ts` is the **Fold** that reads refusal precedence; `owner.ts` is the
**Walker** that applies the existing pause, consent and terminal boundary.

The pure readers neither select a run nor emit, mutate or throw. The boundary
uses its captured invocation for those effects, including the existing public
output-refusal fact. Mounted charts use the same readers, so refusal records
cannot become successful answers in composition. `verdicts.test.ts` covers
precedence and incomplete validation; broader composed-boundary tests remain
in `test/core-flow`.
