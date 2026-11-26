**Fold** — checks a scoped claim against the exact result admitted by its citation.

The authored scope and the claim's entity, field and value come from the answer
span and explicit host bindings. The checker receives them separately from the
accepted offer's result locator and evidence snapshot. It reuses claim binding
for lineage, scope and coverage, and the assertion comparator for exact typed
values. The verdict carries an outcome and, when unverified, a reason code.

`checkCitationColumn` reads an independently requested column and one complete,
authorized schema tied to the accepted result. An open `resultColumns`
declaration cannot establish absence. A missing, incomplete or malformed
schema yields no finding. This check covers columns only. Its inputs are
limited to 128 names of 128 UTF-16 code units each. For an absent name it
returns the requested name and a unique nearest visible name when there is
one. Distance uses Unicode code points. An equally close name suppresses the
suggestion. The output includes neither row values nor the schema list.

The terminal observer passes the complete declared column list only when the caller's recording policy allows the schema and its provenance. The final fold reads the report projected under the terminal writer's recording rule. This keeps the same reason and authorized names used in replay even when unrelated private values cross the Final mapper.
