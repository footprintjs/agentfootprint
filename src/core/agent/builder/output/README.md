# Output setup

Output retry validation. Preserve the zero default, integer refusal and stated ten-turn ceiling. The helper and constant are moved together; adjacent tests cover the boundaries.

# Output configuration owners

`schema.ts` records the terminal declaration and its existing instruction provenance. `fallback.ts` records a fallback and checks coherence at build. `enforcement.ts` resolves its transport and whole-agent refusals. Each receives the original builder object through a narrow structural port; no state is copied. `retries.ts` is the unchanged Stage A sibling.

Public method signatures, default evaluation and comments remain on AgentBuilder. Behavior proof should cover duplicate declarations, provenance order, fallback/schema call ordering, forced-tool refusals, native/auto fallback and typed-negative-claim retry caps.
