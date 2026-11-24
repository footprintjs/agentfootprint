**Fold** — evaluates what a citation can establish about a prose answer.

`collect/` resolves span markers against the accepted request's offer only.
`check/` compares an independently scoped claim with admitted evidence and
checks explicitly requested column names against a complete visible schema.
Unknown or unavailable evidence gives no support. Helpers return associations
and verdicts as plain data, without editing the answer or copying result bodies.

`assessCitedAnswer.ts` extracts a separate authored claim from each eligible prose span
before reading retained evidence. The report includes offsets, eligible slots
and verdicts. Offer identifiers, result identities and body digests stay
private. The column check runs once when one accepted source clearly governs
the request. Multiple cited sources alone cannot prove a column was absent.

`record.ts` reads the bounded terminal report for live and saved assessment.
A contradicted claim or proven missing column can lower standing. A supported
span never establishes the standing of the whole answer. The warning uses
retained field names and omits names or hints that were kept out.

Cross-tool comparisons also examine uncited results in that same accepted
offer. They use explicit comparison groups and exact typed scope. The public
comparison supplies only a completeness verdict and the two eligible slots.
