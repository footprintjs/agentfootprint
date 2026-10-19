---
type: added
---
**Opt-in precision-bounded rounding for plain decimals.**
`namesAndNumbersFromEvidence({ decimalRounding: true })` checks plain decimals
and accepts only a carried number rounded at the answer's written precision,
recording `computed` with `derivation: 'rounded'` and `from`. It is off by
default; whole numbers and identifiers keep exact matching, and no new
unitless sums or ratios are accepted.
