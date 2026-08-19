# `recipes/` — the declared unit of agent configuration

Every capability an agent needs already ships. What did not was a **named,
versioned, inspectable unit of configuration**.

So an agent's setup lived as prose in an example, was copy-pasted into an app,
drifted there — and afterwards nothing on the run could say which composition
produced the agent that answered. Two runs of "the support agent" could differ
in every tool and every instruction and be indistinguishable on the record.

A recipe is the missing noun:

```ts
import { defineAgentRecipe } from 'agentfootprint/recipes';

export const supportDesk = defineAgentRecipe({
  id: 'support-desk',
  version: '1.2.0',
  description: 'Order lookup + refund policy, the way support runs it.',
  configure: (agent) => {
    agent.system('You answer support questions.').tool(lookupOrder);
  },
});

const agent = Agent.create({ provider, model })
  .recipe(supportDesk)
  .tool(escalate)
  .build();
```

…and the run manifest (`agentfootprint.agent.run_configured`) now carries
`recipes: [{ id: 'support-desk', version: '1.2.0' }]`, beside the provider, the
model and the strategies it already named.

## It is deliberately thin

`configure` calls **builder methods that already exist**. There is no second
configuration format, no schema for "an agent", no class to extend. The repo's
own instruction is that named patterns are recipes over primitives, and this is
that instruction taken literally.

Which means the limits are the point, not omissions:

| | |
|---|---|
| **Nothing is registered** | You import the object and hand it to `.recipe()`. No global map, no discovery, no "which version of `support-desk` is installed". |
| **Nothing is closable** | A recipe holds no connection, no handle, no process. It never gets a `close()`, and it is never awaited — an `async configure` is refused by name rather than silently not awaited. |
| **Nothing is deferred** | Every call `configure` makes happens at the position in the chain where you wrote `.recipe()`. A later builder call still wins, exactly as it always has. |

A composition that also owned a resource would be a component wearing a
composition's name — the shape that makes "who closed the pool?" unanswerable
two releases later.

## Conflicts name both sides

The builder has always refused a duplicate tool name: the model dispatches by
name, so two tools called `search` is a coin flip whose loser is never called
and never mentioned. What it could not say was **where each one came from**.
With one recipe in the chain that stops being obvious ("I never registered a
`search` tool"); with two it is unrecoverable without reading both recipes.

```
Agent.tool(): duplicate tool name 'search' — already registered by
recipe 'support-desk' 1.2.0, and now by recipe 'crm-basics' 0.4.0.
```

Recipes that apply recipes are attributed innermost-first, so the chain reads
`recipe 'crm-basics' 0.4.0 ← applied by recipe 'house-standard' 2.1.0`.

Two more refusals sit beside it, and they are deliberately DIFFERENT sentences
because they are different mistakes: applying one composition twice ("already
applied to this agent"), and a composition that applies itself ("is applying
itself", printing the cycle). Telling an author their recursion is a duplicate
would send them to the wrong line.

A recipe whose `configure` was refused half-way gets **no manifest row**. Some of
its calls landed and the throw is the record of that; a row claiming a completed
composition would be the manifest asserting something that did not happen.

**The honest edge of the attribution.** Provenance is recorded at the two doors a
recipe registers through — `.tool()` / `.injection()` (and `.outputSchema()`,
which mounts an instruction of its own). A tool that arrives *inside a skill's*
`inject.tools` is not registered there, so a collision between one of those and a
local tool is still caught — by `validateToolNameUniqueness` in the `Agent`
constructor, at `build()` — but **without** naming the recipe. Stated rather than
implied: that path refuses, it just refuses in the older words.

**`'error'` is the only conflict policy**, and it is the default.
`'skip'`, `'replace'` and automatic renaming are each a real design and none is
implemented — every one of them has to answer where the dropped registration is
RECORDED first. So `.recipe(r, { conflict: 'skip' })` is refused **by name**,
never quietly run as `'error'`.

## Two rules on the declaration, and both are about grouping

**The id is a plain name and carries no version.** `support-desk-2` is refused:
the version axis already exists as its own field, and an id that encodes one
produces two names for one composition — runs of `-2` read as an unrelated agent
while the field that exists to tell them apart says `1.0.0` on both. (The check
matches the version-suffix *shapes*; it cannot catch an id that merely ends in a
digit, because `oauth2` and `sha256` are real words. Stated, not implied.)

**The version is strict SemVer.** `'1.2'`, `'v1.2.3'` and `'latest'` are
refused rather than repaired — padding `'1.2'` to `'1.2.0'` would put a version
on the record that the author never wrote.

## What travels, and what does not

The manifest row is `{ id, version }`. Not the `description` (prose about the
composition, not something a consumer branches on), not the `configure`
function, and never the two joined into `'support-desk@1.2.0'` — a composed key
is one string that two different pairs can produce the moment either half may
contain the separator, which is the collision class this repo has fixed seven
times.

An agent that applies **no** recipe gets **no** `recipes` field: absent means
"none was applied", and stamping `[]` on every agent written before recipes
existed would put new bytes in every recording for a feature nobody used.

## Files

| file | one job |
|---|---|
| `types.ts` | `AgentRecipe`, `AppliedRecipe`, the conflict-policy type — and the no-lifecycle argument |
| `defineAgentRecipe.ts` | the factory + `assertAgentRecipe`, the ONE validator both doors run |
| `identifier.ts` | the plain-name rule for an id, and the version-suffix refusal |
| `version.ts` | strict SemVer 2.0.0, and a refusal that names the specific mistake |
| `provenance.ts` | who registered a name — `local`, a recipe chain, or (honestly) unattributed |
| `apply.ts` | the policy resolution and every sentence `.recipe()` raises |
| `index.ts` | the door — `defineAgentRecipe`, `InvalidAgentRecipeError`, four types |

The mutation lives in `AgentBuilder.recipe()`; everything here is pure, so each
refusal can be read and tested without building an agent.

**The door is narrower than the folder, deliberately.** `agentfootprint/recipes`
publishes the authoring vocabulary — declare a recipe, catch the refusal, name
the types — and nothing else. The validators, the provenance formatter and the
refusal sentences are internal: `AgentBuilder` imports them by module path, and
publishing them would be surface nobody imports and everybody has to keep
documented. A recipe's whole claim is that it is a composition over primitives,
not a second framework with an API of its own.
