# Recorded, not built — the divergence walk's three defects

Three things the tool-divergence walk found are **real, reproduced, and
deliberately not fixed here**. Each is a behaviour change: fixing it either
emits events in runs that emit none today, changes a shipped event's payload,
or refuses a configuration that builds today. That is a decision, not a patch,
so each gets its own round. This note exists so none of them has to be
rediscovered — and so the reason each one is tolerated is a sentence somebody
wrote, rather than an omission somebody inherited.

Written 2026-09-03, against 9.84.0 plus the uncommitted walk. Line numbers are
against that working tree.

The machine-checked half of this record already ships:
`test/core/agent/toolDivergenceWalk.baseline.json` holds every divergence row
with its configuration, its mechanically-derived cause, and a hand-written
`tolerated`. A row that disappears fails the walk as loudly as a new one. This
note is the part a baseline cannot carry: what a fix would cost.

Every block below was produced by driving a real agent run — a `mock` provider
that records `req.tools` per iteration, and every mounted tool stamping
`[contract:X]` in its description and `[impl:X]` in its result, so identity is
witnessed by a token rather than by a name.

---

## 1. An inactive skill's tool shadows in silence

**The reproduction.** A `ToolProvider` and a skill both claim `shared_tool`.
The agent is `.toolsFromActiveSkill()`, and the skill is **never activated** —
its tool is offered on no iteration of the run:

```
epoch 1  wire[shared_tool] = "shared_tool tool [contract:provider]"
epoch 2  wire[shared_tool] = "shared_tool tool [contract:provider]"
answer  e1:shared_tool -> "shared_tool ran [impl:skill-inactive]"
agentfootprint.tools.shadowed fired 0x
```

The model read the provider's contract, and a tool it was **never offered, on
any epoch**, answered the call. Nothing is on the record.

**The cause.** Two halves that were written against different pictures of the
same map.

`buildToolRegistry.ts:339-343` backfills the dispatch map from every skill tool
that is not already in it, with no activation gate — activation is a runtime
fact and this is build time, so there is nothing here that could gate it:

```ts
for (const [name, tool] of sharedSkillTools.entries()) {
  if (!registryByName.has(name)) {
    registryByName.set(name, tool);
  }
}
```

`toolCalls.ts:2087-2093` then resolves that map **first**, and the provider
cache only if the name missed:

```ts
const lookupTool = (toolName: string): Tool | undefined => {
  const fromRegistry = registryByName.get(toolName);
  if (fromRegistry) return fromRegistry;
  if (!externalToolProvider) return undefined;
  const cached = providerToolCache?.current ?? [];
  return cached.find((t) => t.schema.name === toolName);
};
```

So an inactive skill's `execute` wins from iteration 1. Meanwhile the report
that exists to name this seam walks a different set —
`buildToolsSlot.ts:722` iterates `activeInjections`, and an inactive skill is in
neither the offer nor that list:

```ts
for (const inj of activeInjections) {
```

The comment on `buildToolRegistry`'s shadow bullet says the seam is "reported
rather than refused". For an ACTIVE skill that is true. For an inactive one it
is neither: the framework will not refuse the pair (it cannot see a provider's
list at build), and it does not report it either.

**Why it is not fixed here.** The fix is to widen the report's input from the
active set to the dispatch map, which is where the implementation that actually
answers lives. That makes runs that emit no `agentfootprint.tools.shadowed`
today start emitting it — for a consumer whose agent mounts a provider and a
never-activated scoped skill sharing one name, on every iteration. Anyone
alerting or asserting on that event's absence is affected. That is a behaviour
change, and it belongs in a release note rather than in a walk.

**What deciding to fix it would involve.**

- Deciding the report's *subject*: today it answers "which two ACTIVE sources
  disagree", and the honest question is "did the contract on the wire and the
  implementation that answered come from different places". Those are different
  checks with different inputs — `activeInjections` versus `registryByName`
  crossed with the merged wire list.
- Deciding whether the event's `dispatchTo`/`dispatchToId` should be able to
  name a source the model was never offered. `dispatchToId` is a skill id
  today; an inactive skill's id is a truthful answer but a surprising one.
- The same widening decides a fourth family the walk found and this note does
  not otherwise cover: **`claim-swallowed`**, 16 baseline rows, where a provider
  tool whose name a registry-list holder already owns loses the wire *and*
  dispatch and is simply dead. `reportShadowedTools` cannot see those either,
  and for the same reason as above — the only loop it has is over
  `activeInjections` (`buildToolsSlot.ts:722`), so when the name's other holder
  is a static `.tool()`, a framework auto-attach, or an inactive skill, there is
  no active injection to match and the provider's dead claim is never mentioned.
  A decision that only widens to inactive skills leaves those 16 unreported; one
  that reports "the offer and the dispatch disagree" covers both. Worth taking
  as one round rather than two.
- Whichever is chosen, the walk's baseline rows must be re-recorded and their
  `tolerated` reasons rewritten — a row that stops appearing fails, which is
  the point.

**Cost of waiting.** A same-epoch identity swap with no event. The `active`
half of the seam is still reported, so an operator watching that event is not
told the report is a subset — which is the part that misleads.

---

## 2. The shadow report names the wrong source

**The reproduction.** A `ToolProvider` and a **stepped** skill both claim
`shared_tool`. A stepped skill's tools are always visible, so they ride the
static registry list:

```
epoch 1  wire[shared_tool] = "shared_tool tool [contract:step-skill]"
epoch 2  wire[shared_tool] = "[Step 1 of 1 — the only step] shared_tool tool [contract:step-skill]"
epoch 3  wire[shared_tool] = "shared_tool tool [contract:step-skill]"
answer  e1:read_skill -> "Skill 'desk-stepped' activated for the next iteration."
answer  e2:shared_tool -> "shared_tool ran [impl:step-skill]"
agentfootprint.tools.shadowed fired 2x
   {"toolName":"shared_tool","iteration":2,"schemaFrom":"provider","schemaFromId":"static","dispatchTo":"skill","dispatchToId":"desk-stepped"}
   {"toolName":"shared_tool","iteration":3,"schemaFrom":"provider","schemaFromId":"static","dispatchTo":"skill","dispatchToId":"desk-stepped"}
```

There is **no identity divergence in this epoch at all**. The contract on the
wire is the skill's (`[contract:step-skill]`) and the implementation that
answered is the skill's (`[impl:step-skill]`). The only wrong thing in the run
is the report — it says the model read the provider's schema, and names the
provider (`schemaFromId: "static"` — `staticTools` names itself `'static'`,
`staticTools.ts:30`) as the file to go look at. The provider's schema was
deduped away before the request was built.

**The cause.** `reportShadowedTools` compares the **pre-merge**
`providerSchemas` array against the active injections and then asserts the
winner instead of deriving it — `buildToolsSlot.ts:720-737`:

```ts
if (providerSchemas.length === 0) return;
const providerNames = new Set(providerSchemas.map((s) => s.name));
for (const inj of activeInjections) {
  for (const tool of inj.inject.tools ?? []) {
    const toolName = tool.schema.name;
    if (!providerNames.has(toolName)) continue;
    // … (a comment about the event's delivery channel)
    typedEmit(scope, 'agentfootprint.tools.shadowed', {
      toolName,
      iteration,
      schemaFrom: 'provider',
```

`merged` — the list actually put on the wire — is built at
`buildToolsSlot.ts:571-577`, and the call at `:636` hands the report
`providerSchemas` instead. The winner is never consulted:

```ts
for (const t of [...tools, ...providerSchemas, ...dynamicSchemas, ...stepSchemas]) {
```

Provider schemas merge ahead of skill injections, which is what makes
`schemaFrom: 'provider'` right in the documented case. It is wrong whenever the
name was already taken by something in `tools` — the static registry list —
because that list merges first. An always-visible skill's tools are in it:
`buildToolRegistry.ts:263` pushes them into `skillToolEntries`, which
`buildToolRegistry.ts:304-309` concatenates into `augmentedRegistry`. So the
skill's own schema beats the provider to the wire, and the report still names
the provider.

**Why it is not fixed here.** Deriving the winner from `merged` instead of
asserting it changes what a shipped event's payload says, in runs that fire it
today. `schemaFrom` would start reporting `'registry'` (or `'skill'`, depending
on the vocabulary chosen) where it reports `'provider'` now, and in the
configuration above the event arguably should not fire at all. Both are
behaviour changes for anyone consuming the event.

**What deciding to fix it would involve.**

- Deciding whether the event means "two sources claim this name" or "the
  contract and the implementation came apart". The reproduction above is the
  first and not the second, and only the second is worth an event by the law
  the framework states: `with stable identity` is the clause the event exists
  to defend.
- Fixing the source: pass `merged` into `reportShadowedTools` and read the
  winner off it, rather than passing `providerSchemas` and asserting. This is
  the small half.
- The vocabulary. `schemaFrom` is `'registry' | 'provider' | 'skill' |
  'framework'`, and an always-visible skill tool riding the static registry
  list is honestly *both* `registry` (the channel) and `skill` (the owner).
  Pick one and say why; `schemaFromId` already carries the owner.
- Whether a fired-then-silent transition needs a note. A consumer with an
  alert on this event will see it stop firing for a configuration that has not
  changed.

**Cost of waiting.** A false report of the seam, which is worse than no report:
it sends an operator to the provider's file to fix a name the provider never
put on the wire. Eight baseline rows carry it.

---

## 3. `skip_step` is shadowable

**The reproduction.** A stepped skill is mounted, and a `ToolProvider` serves a
tool called `skip_step`:

```
epoch 1  wire[skip_step] = "skip_step tool [contract:provider]"
epoch 2  wire[skip_step] = "skip_step tool [contract:provider]"
epoch 3  wire[skip_step] = "skip_step tool [contract:provider]"
answer  e1:read_skill -> "Skill 'desk-proc' activated for the next iteration."
answer  e2:skip_step -> "Step 1 skipped: not applicable to this input. That was the last step — the 'desk-proc' procedure is complete (1 step(s) skipped)."
agentfootprint.tools.shadowed fired 0x
```

The model read a third party's contract and the **framework** answered: the
procedure advanced and completed, on a call the model believed was somebody
else's tool. Nothing reported it.

**The cause.** `skip_step` is the one framework auto-attach that is
dispatch-only — deliberately, so its schema is offered only while a tenure is
open. That is exactly what puts it out of reach of its own name reservation.
`buildToolRegistry.ts:356-367`:

```ts
const hasSteps = injections.some((i) => i.flavor === 'skill' && stepsOf(i) !== undefined);
if (hasSteps) {
  if (registryByName.has(SKIP_STEP_TOOL_NAME)) {
    throw new Error(
      `Agent: tool name '${SKIP_STEP_TOOL_NAME}' is reserved when any skill declares ` +
      // … (the rest of the message)
  registryByName.set(SKIP_STEP_TOOL_NAME, buildSkipStepTool());
}
```

`registryByName` holds static `.tool()` registrations, `read_skill`, `present`
and every skill tool. It never holds provider tools — a `ToolProvider` resolves
per iteration (`list(ctx)`) and is invisible at build. So the reservation
refuses a static tool and a skill tool of that name (the walk records both
refusals) and cannot see a provider at all.

On the wire, `stepSchemas` merges **last** (`buildToolsSlot.ts:573`), so the
provider's schema wins first-occurrence-wins. At dispatch, `lookupTool`
(`toolCalls.ts:2087-2093`) reads `registryByName` first, where the framework's
own `skip_step` was just installed. The two rules point in opposite directions
by construction.

**Why it is not fixed here.** Both available answers change behaviour. Refusing
at compose time turns a configuration that builds and runs today into a throw,
in the middle of a run rather than at build — a provider's list is not known
until an iteration. Reporting instead of refusing emits an event where none
fires today, and does not stop the procedure from advancing.

**What deciding to fix it would involve.**

- Choosing the posture: refuse, report, or make the framework win the wire.
  The third is the only one that removes the divergence rather than narrating
  it — hoist `stepSchemas` ahead of `providerSchemas` in the merge so the
  contract and the implementation are the same tool. It is also the one that
  silently takes a name away from a provider that has it today, so it needs
  the same "is this a major" conversation as the others.
- If refusal: deciding where. A compose-time throw is a run-time failure for a
  build-time mistake, which is the shape the framework generally refuses to
  ship. A dispatch-time refusal of `skip_step` when a provider also serves it
  is narrower and lands on the call, not the run.
- Whether `present` and `read_skill` need the same treatment. They reserve
  against the static registry too and are equally blind to a provider — the
  walk records `framework/present-vs-provider` and
  `framework/read_skill-vs-provider` as `claim-swallowed`, which is the less
  dangerous direction (the framework's tool is dead rather than secretly
  answering), but it is the same blind spot. `.selfExplain()`'s `run_overview`
  is a fourth family with the same reservation, and the walk records it too.
- A decision on procedure integrity specifically: `skip_step` is the tool whose
  entire job is that a skipped step is *recorded* as skipped. A silent advance
  on a misread contract is the failure that tool exists to prevent, which is an
  argument for treating this one as more urgent than its two siblings.

**Cost of waiting.** A stepped procedure can be advanced and completed by a
call the model made against a third party's contract, with nothing in the trace
saying so.

---

## Two sentences that are now stale

Not defects — prose that the code moved out from under. Both are cheap, and
both are left alone here only because this pass was not touching behaviour and
a comment edit in the same diff would blur which is which.

**`buildToolsSlot.ts:579-588` — "PROVIDER schemas merge unfiltered".** The
compose-seam backstop's header still describes the world before the park
hold-out reached the provider list:

> The park hold-out filters the registry and skill lists, but PROVIDER
> schemas merge unfiltered — a provider tool sharing a parked member's
> name stays on the wire …

It does filter them, at `buildToolsSlot.ts:481` — and the comment immediately
above that line says so explicitly ("used to merge here unfiltered … so
parking, whose whole contract is that a parked map contributes nothing by any
route, leaked through exactly one of the three"). The backstop is still worth
keeping; its stated reason for existing is the part that is out of date.

**`buildToolRegistry.ts:149-151` — "refused below".** The shadow bullet says
the pair this file *can* see is refused here:

> The pair this file CAN see — a static `.tool()` against a skill tool — is
> refused below, which is the better answer whenever the answer is available
> that early.

It is refused **upstream**, at `validators.ts:122-128`, from
`validateToolNameUniqueness` — which `Agent.ts:827` calls in the constructor,
while `buildToolRegistry` is not reached until chart build at `Agent.ts:3369`.
The walk records the message that actually comes out, and it is the validator's:

```
Agent: skill 'desk-static' tool 'shared_tool' collides with the static .tool()
registry. Either rename the skill's tool or remove the static registration.
```

`buildToolRegistry`'s own duplicate-name throw (`:322-328`, "Agent: duplicate
tool name") is belt-and-suspenders that this pair never reaches.
`buildToolsSlot.ts:704-706` carries the same claim a second time
("`buildToolRegistry` already throws on that pair at build time") and is stale
in the same way. The claim's *substance* — the pair is refused at build, which
is why the report does not cover it — is true; only the address is wrong.
