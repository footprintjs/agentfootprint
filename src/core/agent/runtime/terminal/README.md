**Fold** — `verdicts.ts` reads a run's terminal records in their existing precedence.

The caller supplies the run's state and the declarations that arm its checks.
These functions neither select a run nor emit, mutate state or throw terminal
errors. The native run boundary owns those effects. A mounted chart uses the
same readers, so a refusal cannot become a successful answer in composition.

`verdicts.test.ts` covers precedence, inactive declarations, optional policy
fields, withheld answers and incomplete validation. No import reaches the
Agent facade or builder.
