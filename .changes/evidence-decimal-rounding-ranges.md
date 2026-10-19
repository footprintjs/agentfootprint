---
type: added
---
**Opt-in decimal rounding and separately grounded numeric range endpoints.**
`namesAndNumbersFromEvidence({ decimalRounding: true })` checks plain decimals
and accepts only a carried number rounded at the answer's written precision,
recording `computed` with `derivation: 'rounded'` and `from`. It is off by
default; whole numbers and identifiers keep exact matching, and no new
unitless sums or ratios are accepted. Exactly-two-number hyphen or en-dash
ranges now check their endpoints independently, after app-declared ID shapes.
Dates, clock ranges, dotted versions and multipart IDs stay intact. Short
bare endpoints below `minDigits` remain unchecked prose, documented explicitly.
