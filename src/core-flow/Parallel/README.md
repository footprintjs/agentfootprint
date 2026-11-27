Mixed
Map: `chart.ts` wires the branches. Support: `types.ts`, `builder.ts` and
`mapper.ts` own contracts and attribution. Walker: `merge.ts` performs the
existing model merge call.

# Parallel composition internals

The existing `../Parallel.ts` facade owns the runner lifecycle. This sealed folder owns its unchanged public declarations and fluent builder, branch mapper attribution, chart wiring and merge strategies. Only the facade and this folder import these internals. The LLM merge admits the same safe provider intervention before reading or emitting content. Masked responses remain usable; blocked and unknown responses raise distinct terminal errors.
