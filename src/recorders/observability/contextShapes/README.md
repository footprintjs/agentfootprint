**Fold** — Converts policy-served initial values and committed write paths into a history of recorded types and array lengths.

`value.ts` describes one value without walking its contents. `book.ts` updates the observed paths at each commit and drops facts when their source is hidden or replaced. The recorder's explicit full-scan option enables nested discovery.

`redactions.ts` tracks scopes that remain hidden after a partial write. It drops element facts when a masked array operand cannot identify its final positions.

`read.ts` reads a recorded shape at a commit for consumers of `agentfootprint/observe`.
