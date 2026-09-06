**Mixed** — eleven published doors, each a header plus a re-export, cut by the
JOB a consumer has rather than by role. A door therefore usually publishes more
than one role, and this file says which.
Map + Fold: `skill-graph.ts` (the graph and its folds, with no framework
attached — the one door whose cut is proved by a test that walks its transitive
imports) and `recipes.ts` (declared configuration).
Map + Walker + Lens: `context.ts` re-exports the whole injection-engine barrel,
which carries the declarations, the folds, the per-iteration walk AND the
`read_skill` composers (`readSkillDescriptor`, `buildReadSkillTool`).
Trace + Fold: `observe.ts` (recorders, `recordRun`, ledger, bisect, toolpack).
Fold: `maps.ts` (the mount kernel's vocabulary).
Support: `memory.ts`, `providers.ts`, `hosting.ts`, `rag.ts`, `security.ts`,
`resilience.ts`.

## What it reads / what it writes
Nothing at runtime. Each file is a header stating the door's job plus one or two
`export *` lines.

## The one law here
A door is named for the consumer's question, not for the layer it exposes. When
one door publishes symbols of several roles, the header says so — importing
through a door tells you nothing about whether a symbol may compose a sentence.

## Files
One file per door: `skill-graph.ts`, `context.ts`, `observe.ts`, `maps.ts`,
`recipes.ts`, `memory.ts`, `providers.ts`, `hosting.ts`, `rag.ts`,
`security.ts`, `resilience.ts`.
