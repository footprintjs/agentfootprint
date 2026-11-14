**Map** — validates the per-run resolver and iteration-budget declarations.

# Builder run settings

`configure.ts` declares the single per-run configuration resolver.
`iterations.ts` validates and records a positive integral iteration limit.
Both mutate only their named field on the original builder receiver.
