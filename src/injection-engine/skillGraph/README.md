# Mixed — skill graph declarations and projections
Map: the public graph contracts and metadata, decision-node declaration, trigger/tree compilation, routing provenance and drawing. Fold: reachability, entry scores, cursor resolution, entry suppression and per-pass memoization.

`../skillGraph.ts` remains the canonical entry and retains the existing factory, its overloads and the reference-equal `defineSkillMap` alias. These leaves own complete existing declarations and helpers; mutable builder state stays in that factory, and helper-local caches stay in their original functions.

`graphContracts.ts` groups linked public contracts with their metadata markers so their JSDoc targets remain in declaration scope. `graphRoutes.ts` owns the internal `EntryDecl` and `RouteDecl` types; the canonical entry does not export them. `SkillMap` retains its public alias.

Leaves use original external owners and sibling helpers. They do not import the canonical factory. The existing graph walker and evaluation pass remain outside this folder.
