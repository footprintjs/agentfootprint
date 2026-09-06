**Mixed** — the authoring vocabulary, and the one factory that composes its own
model-facing sentence.
Map: `defineInjection.ts`, `defineSkill.ts`, `defineSteering.ts`,
`defineInstruction.ts`, `defineFact.ts`, `defineMenuHint.ts`,
`defineStepsHint.ts` — declarations that turn what an author writes into an
`Injection`.
Lens: `defineRelevanceHint.ts` · `defineRelevanceHint` — it composes the
near-tie note ("an offline relevance scorer found two or more starting skills
nearly tied for this request…") inline as the injection's own `content`, and
that string is joined into the system prompt. `test/modelFacingScan.test.ts`
files it `kind: 'ephemeral'`.

## What it reads / what it writes
- Reads the author's literal declaration at build time.
- Writes an `Injection` value.
- The trigger predicates DO read run state at walk time: the evaluator calls
  each `activeWhen` on every pass, and they read `InjectionContext` —
  `ctx.entryScores` and `ctx.iteration` (`defineRelevanceHint.ts` ·
  `defineRelevanceHint`), `ctx.turnRoute` (`defineMenuHint.ts` ·
  `defineMenuHint`), `ctx.stepPointer` (`defineStepsHint.ts` ·
  `defineStepsHint`).

## The one law here
A declaration is still. If a value has to be true AT a moment, it belongs to the
evaluator (a fold) or to a composer (a lens), not to a factory.
`defineMenuHint.ts` and `defineStepsHint.ts` say their body is static
instruction while "the DATA rides the tools slot" — that data is rendered by
`../skillToolDescriptors.ts` and `../skillSteps.ts`, which are the composers.
`defineRelevanceHint.ts` is the exception the law does not cover: its whole
sentence is composed here and rides no other composer, which is why the folder
is Mixed rather than Map.

## Files
- `defineInjection.ts` — the unified factory; the rest are sugar over it.
- `defineSkill.ts`, `defineSteering.ts`, `defineInstruction.ts`,
  `defineFact.ts` — the four content flavours.
- `defineMenuHint.ts`, `defineStepsHint.ts` — advisory notes whose data another
  module renders.
- `defineRelevanceHint.ts` — the advisory note that renders its own.
