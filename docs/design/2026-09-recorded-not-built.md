# Recorded, not built — ten defects, real and deliberately unfixed

Ten things are **real, reproduced, and deliberately not fixed here** — five
found by the tool-divergence walk, one (entry 6) found from the other side while
building the receipt at the llm-turn stop, three (entries 7-9) left standing by
the receipt's sixth review round, and one (entry 10) left standing by its
seventh, where the job was to make every printed sentence true rather than to
close every hole. Each is a behaviour change:
fixing it either emits events in runs that emit none today, changes a shipped
event's payload or a shipped record's meaning, or refuses a configuration that
builds today. That is a decision, not a patch, so each gets its own round. This
note exists so none of them has to be rediscovered — and so the reason each one
is tolerated is a sentence somebody wrote, rather than an omission somebody
inherited.

Entries 1-5 were written 2026-09-03, against 9.84.0 plus the uncommitted walk;
their line numbers are against that working tree. Entries 6-10 were written
2026-09-07/08 against 9.88.0 and cite `file` · `symbol`, which is the house rule
now.

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

`toolCalls.ts` · `lookupTool` then resolves that map **first**, and the provider
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
  not otherwise cover: **`claim-swallowed`**, 22 baseline rows — 18 where a
  provider's or a skill's tool whose name a registry-list holder already owns
  loses the wire *and* dispatch and is simply dead, and 4 where the
  FRAMEWORK's own `run_overview` is the dead claimant (entry 4). (This bullet
  said *16 rows* until 9.86.1; the widening that added entries 4 and 5 added
  six rows to this family, and this sentence was not on the list of the ones it
  corrected.) `reportShadowedTools` cannot see those either,
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
put on the wire. Ten baseline rows carry it.

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
(`toolCalls.ts` · `lookupTool`) reads `registryByName` first, where the framework's
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
`buildToolsSlot.ts` · "`buildToolRegistry` already throws on that pair at build time"
carries the same claim a second time
("`buildToolRegistry` already throws on that pair at build time") and is stale
in the same way. The claim's *substance* — the pair is refused at build, which
is why the report does not cover it — is true; only the address is wrong.

---

# Appended 2026-09-05 — two more, found by widening the walk

The three entries above were written when `frameworkCases()` crossed the
framework's auto-attach names against **three** of the seven claimants —
`static`, `provider`, `skill-active`. The filter was a leftover, not a
decision: the framework's four reservations each read a different build-time
list, so *which source* holds the contested name is precisely what decides
whether a reservation can see it. Filtering sources filtered answers.

Dropping the filter took the walk from 60 configurations to 76 and from 36
divergence rows to 46. Ten rows are new (eighteen keys are new; eight of those
are the misattributed-report rows re-keyed to carry their attribution). Four
of the ten reach seams already recorded above through a source that had not
been crossed before — an MCP-served catalog, a never-activated scoped skill —
and their `tolerated` reasons say so and point back up this page. **Six
record the two defects below**: four for entry 4 and two for entry 5. (Until
9.86.1 this paragraph said *eight* and *two* — a count of defects presented as
a count of rows.)

Three sentences above were WRONG once entries 4 and 5 landed, and all three
are now corrected in place. The record of what changed is this list — a reader
who opens a file and reads its title must not be told the wrong count and then
corrected three hundred lines later:

- the title said *three defects*; it records **five**, and now says so;
- entry 2's closing line said *"Eight baseline rows carry it"*; the
  misattributed-report family is **ten** rows, and entry 5 is about the two
  that are new;
- entry 1's fourth bullet said *"`claim-swallowed`, 16 baseline rows, where a
  provider tool … is simply dead"*; the family is **22** rows and in four of
  them the framework is the victim (corrected in 9.86.1).

Written against 9.85.0 plus the uncommitted Packet A and this packet. Line
numbers are against that working tree and have moved since the entries above
were written — `buildToolsSlot.ts`'s report loop, cited as `:722` in entry 1
and `:720-737` in entry 2, is at `:743-762` here. Entry 4's table cited
`buildToolRegistry.ts` lines that 9.86.0 itself moved by ~29 lines; since
9.86.1 that table and the baseline rows name the symbols instead.

---

## 4. `.selfExplain()` reserves its tool names against nothing a skill can hold

**The reproduction.** Three cells, one shape: a consumer skill declares a tool
named `run_overview`, and the agent calls `.selfExplain()`. Every one of them
builds. Each block below is a real run — the framework's trace pack stamps no
token, so an unstamped description is the framework's own and
`[contract:skill-*]` is the consumer's.

*An always-visible skill (`framework/run_overview-vs-skill-static`):*

```
epoch 1  wire[run_overview] = "run_overview tool [contract:skill-static]"
epoch 2  wire[run_overview] = "run_overview tool [contract:skill-static]"
answer  e1:read_skill    -> "Skill 'self-explain' activated for the next iteration."
answer  e2:run_overview  -> "run_overview ran [impl:skill-static]"
agentfootprint.tools.shadowed fired 0x
```

`.selfExplain()` is mounted, its skill activates, and its `run_overview` never
reaches the wire on any epoch and answers no call. The self-explain skill body
is in the system prompt telling the model to start with `run_overview`; the
model does, and gets somebody else's function. Baseline row:
`framework/run_overview-vs-skill-static::run_overview::claim-swallowed(framework)`.

*A never-activated scoped skill (`framework/run_overview-vs-skill-inactive`) —
the same configuration under `.toolsFromActiveSkill()`:*

```
epoch 1  wire[run_overview] = ABSENT
epoch 2  wire[run_overview] = "Start here. One bounded summary of the completed run: status, step counts, …"
answer  e1:read_skill    -> "Skill 'self-explain' activated for the next iteration."
answer  e2:run_overview  -> "run_overview ran [impl:skill-inactive]"
agentfootprint.tools.shadowed fired 0x
```

This is the worse half. The wire carries the **framework's own** trace-tool
description — the model reads "Start here. One bounded summary of the completed
run" — and a skill that was offered on no epoch of the run answers it. Baseline
row: `framework/run_overview-vs-skill-inactive::run_overview@e2::contract-swap`.

*A stepped skill (`framework/run_overview-vs-step-skill`)* swallows it the same
way the always-visible one does, and additionally draws two shadow events that
name the wrong source — that is entry 5.

**The cause.** `AgentBuilder.ts:2620-2637` searches one list:

```ts
const reserved: readonly string[] = this.selfExplainConfig.delegate
  ? ['explain_run']
  : TRACE_TOOL_NAMES;
const clash = this.registry.find((entry) => reserved.includes(entry.name));
```

`this.registry` is the static `.tool()` list. `this.injectionList` — every
mounted skill and its `tools:[]` — is right there on the same object and is not
consulted. So the reservation refuses `.tool()` and nothing else, which the
walk records: `framework/run_overview-vs-static` is `refused`, and all three
skill shapes build.

The other three auto-attach names each have a net that catches a skill, and
they were written independently, which is why they catch different subsets:

| name | what its reservation reads | skill tool refused? |
|---|---|---|
| `present` | static registry **+ `skillToolEntries` + `sharedSkillTools`** (`buildToolRegistry.ts`, the `holders.includes(PRESENT_TOOL_NAME)` check) | always-visible, scoped, stepped — all three |
| `skip_step` | `registryByName`, after skill tools were merged into it (`buildToolRegistry.ts`, the `registryByName.has(SKIP_STEP_TOOL_NAME)` check) | all three |
| `read_skill` | `staticNames` only (`validators.ts:92-98`) — but always-visible and stepped skill tools then hit the duplicate-name throw in `buildToolRegistry.ts` (the `seenNames` loop) | always-visible and stepped; a scoped one slips (recorded above as `read_skill-vs-skill-active` / `-vs-skill-inactive`) |
| `run_overview` | `this.registry` only (`AgentBuilder.ts:2628`) | **none** — and there is no downstream net, because the trace tools ride a `skillScopedTools` provider and never enter `augmentedRegistry`, so the duplicate-name throw never sees them |

The comment directly above the check says it "mirrors the read_skill rule". It
mirrors the *weakest* of the three, and then loses the backstop that makes even
that one hold for two of the three skill shapes.

**Why it is not fixed here.** Widening the search from `this.registry` to
`this.registry` plus every injection's `tools:[]` turns eleven names into
build-time throws for agents that build and run today — `run_overview`,
`find_in_trace`, `backtrack`, `get_value` and the rest of `TRACE_TOOL_NAMES`
are ordinary English and a consumer skill may well hold one. That is a refusal
of a shipped configuration, which is a major-version conversation, not a patch.

**What deciding to fix it would involve.**

- Deciding whether all eleven `TRACE_TOOL_NAMES` deserve the same reservation
  strength. `run_overview` and `backtrack` are plausible consumer names in a
  way `inspect_tool_run` is not, and the blast radius of the fix is entirely a
  function of that list's length.
- Deciding refuse-vs-win. `present` and `skip_step` refuse; making the trace
  pack **win the wire** instead — hoisting its schemas ahead of the skill lists
  in the merge — removes the divergence without refusing anybody, at the cost
  of silently taking a name from a skill that has it today. That is the same
  fork entry 3 reaches for `skip_step`, and it should be answered once for all
  four families rather than four times.
- Deciding what `.selfExplain()` should do when it cannot have its own name.
  Today it mounts a skill whose body instructs the model to call a tool the
  framework does not own. A reservation is one answer; not mounting the body
  for a name it lost is another, and is not a refusal of anything.
- Whether the scoped `read_skill` gap (`read_skill-vs-skill-active`, recorded
  before this pass) is the same decision. It is: both are a reservation that
  reads a list narrower than the set of things that can hold a name.

**Cost of waiting.** `.selfExplain()` can be mounted, activate, put its
methodology in the system prompt, and route every question in it to a consumer
skill's function — including a skill the model was never offered. Four baseline
rows carry it. There is no event, so nothing distinguishes it from a trace
tool that simply returned something unexpected.

---

## 5. A misattributed report can now name the framework's own provider

**The reproduction.** A stepped skill declares a tool named `run_overview`; the
agent calls `.selfExplain()`; the model activates the procedure, then activates
self-explain:

```
epoch 3  wire[run_overview] = "[Step 1 of 1 — the only step] run_overview tool [contract:step-skill]"
answer  e3:run_overview -> "run_overview ran [impl:step-skill]"
agentfootprint.tools.shadowed fired 2x
   {"toolName":"run_overview","iteration":3,"schemaFrom":"provider",
    "schemaFromId":"skill-scoped:self-explain","dispatchTo":"skill","dispatchToId":"desk-stepped"}
   {"toolName":"run_overview","iteration":4,"schemaFrom":"provider",
    "schemaFromId":"skill-scoped:self-explain","dispatchTo":"skill","dispatchToId":"desk-stepped"}
```

Baseline rows:
`framework/run_overview-vs-step-skill::run_overview@e3::report-misattributed[provider(skill-scoped:self-explain)->skill(desk-stepped)]`
and its `@e4` twin.

**The cause.** Entry 2's, exactly — `reportShadowedTools` asserts
`schemaFrom: 'provider'` (`buildToolsSlot.ts`, the literal in `reportShadowedTools`) instead of reading the
winner off `merged`, and the always-visible skill's schema beat the provider to
the wire. What is new is *which* provider gets named. `skillScopedTools` builds
its id as `` `${SKILL_SCOPED_TOOLS_ID_PREFIX}${skillId}` ``
(`skillScopedTools.ts:78`), and `.selfExplain()` mounts its trace pack through
that helper (`selfExplain.ts:332`). So `schemaFromId` is
`skill-scoped:self-explain` — a provider the consumer did not write, did not
name, and cannot open.

Entry 2's cost sentence is "it sends an operator to the provider's file to fix
a name the provider never put on the wire." Here there is no such file. The
address is inside the framework, and the honest reading of the event — "the
framework's self-explain pack shadowed your skill" — is the reverse of what
happened: the skill shadowed the pack, which is entry 4.

**Why it is not fixed here.** It is entry 2's fix, and entry 2's reasons: the
event's payload changes in runs that fire it today.

**What deciding to fix it would involve.** Entry 2's list, plus one addition
that only this pair makes visible:

- Deciding whether `schemaFromId` may name a framework-internal provider at
  all. A consumer cannot act on `skill-scoped:self-explain`; if the payload is
  a call to action, an internal id is a dead end and the event should either
  say `schemaFrom: 'framework'` or not fire. If it is a diagnostic, the id is
  the most useful field on it and should stay. The two readings want opposite
  changes, so the answer decides the shape of the fix rather than following
  from it.

**Cost of waiting.** The only event that reaches production about this seam
reports the framework as the shadowing party in the one configuration where
the framework is the victim. Two baseline rows carry it.

---

# Appended 2026-09-07 — the receipt pass: one more, found from the other side

The five above were found by walking tool DIVERGENCE. This one was found by
walking what a RECORD contains, while building the receipt at the llm-turn stop
(9.88.0). It belongs here for the same reason they do: it is real, reproduced,
and fixing it is a behaviour change rather than a patch.

---

## 6. A kept inner recording carries the secret in `sharedState`

> **Built in 9.89.1 (2026-09-10).** The decision below was taken the third
> way nobody listed: neither scrub after the fact nor refuse the combination,
> but serve the view footprintjs already builds for serving. Both tools now
> take every state-bearing thing they hand outward — the result string, the
> envelope's state, the recording, the kept record — from ONE owner,
> `src/core/servableSnapshot.ts` · `servableSnapshot`, which is
> `getSnapshot({ redact: true })` under a policy (plus, until 9.89.3, each
> subflow's final state refolded from its own scrubbed `history` — the level
> footprintjs did not mirror before 9.20.0) and the raw `getSnapshot()`
> without one. A kept record is
> therefore a TRANSPORT: what it may contain is governed by the policy, and it
> no longer disagrees with its own log. The cost named below is paid on
> purpose: under a policy the record omits `initialState` (footprintjs's own
> law for the redacted view), so a fold of it reports `basis: 'log-only'`.
> Three places where the substrate left plaintext IN the log — `fields`
> dot-path redaction, an `outputMapper`'s merge-back, an `inputMapper`'s
> seed (with its narrated `Input:` line; a tracked read's `stageReads` was
> the fifth) — were outside what a served view could scrub and were pinned
> as they were in `test/core/flowchartAsTool.redact.test.ts`.
> **Closed by footprintjs 9.19.1 (2026-09-10; agentfootprint 9.89.2 requires
> `^9.19.1`)**: one `RedactionRule` per run now decides every staged write
> and every tracked read, so the same file asserts each of the five ABSENT
> from the record (red on 9.18). The one limit that remained was
> `subflowResults[*].treeContext.globalContext` (and its `#n` twin) — the
> subflow's raw heap under `getSnapshot({ redact: true })` — which the refold
> above answered, pinned beside the answer.
> **The subflow limit closed by footprintjs 9.20.0 (2026-09-10; agentfootprint
> 9.89.3 requires `^9.20.0`)**: a subflow keeps its own redacted mirror
> whenever the run does, and the redacted view serves it as one object under
> both keys — so the refold is deleted from `servableSnapshot`, which is now
> the substrate's view exactly as served, the one owner of the rule; §7 of the
> same test file pins the placeholder in footprintjs's own view (red on
> 9.19.x) and the identity. The reproduction test named below now asserts
> `'REDACTED'`. The record is kept as written.

**The claim it contradicts.** `flowchartAsTool.ts` · `FlowchartAsToolOptions.redact`
said, until this pass edited it:

> footprintjs scrubs at COMMIT time, so a redacted key never reaches the
> inner commit log at all — which is what makes a kept record safe to
> serve back to a model.

The first clause is true. The second does not follow from it, and is false for
the object the option's neighbour (`keepRecord`) retains.

**The reproduction.** A chart that writes a key, wrapped with both options on,
invoked once; then the kept record is opened. This is
`test/lib/time-travel/receipt-conformance.test.ts` ·
`'redaction is EXECUTOR-level and reaches an inner tool run, not an agent log'`,
which asserts the whole shape rather than only the half that is reassuring:

```ts
const tool = flowchartAsTool({
  name: 'inner_chart',
  flowchart: chart,          // sets scope.apiKey = 'sk-inner-secret'
  keepRecord: true,
  redact: { keys: ['apiKey'] },
});
await tool.execute({}, { toolCallId: 'c1' } as never);
const snapshot = innerRunsOf(tool)!.get('c1')!.recording!.snapshot;

JSON.stringify(snapshot.commitLog).includes('sk-inner-secret');  // false — scrubbed
JSON.stringify(snapshot.commitLog).includes('REDACTED');         // true
snapshot.sharedState.apiKey;                                     // 'sk-inner-secret'
```

**The cause.** Two mechanisms that are correct on their own and were never
composed. `executor.setRedactionPolicy` makes footprintjs scrub at COMMIT time,
so the value is `'REDACTED'` in every bundle. The live state view is not a
commit: it is the run's own heap, and the *redacted mirror* of it is served only
by `getSnapshot({ redact: true })`. `flowchartAsTool.ts` · `keepRecordOf` calls
`executor.getSnapshot()` with no argument, so the retained
`recording.snapshot.sharedState` is the unredacted view. Every fold in
`src/lib/time-travel/` reads the commit log and is therefore clean; anything
that reads `sharedState` — a debugger, a serializer, `inspect_tool_run` — is
not.

**Why it is not fixed here.** It is a different subsystem from this packet, and
every available fix changes behaviour for runs that work today:

- Passing `{ redact: true }` at `keepRecordOf` changes what `inspect_tool_run`
  and every consumer of `innerRunsOf` can see, on runs that set a policy today
  and read state out of the kept record.
- Scrubbing `sharedState` after the fact would make a kept record disagree with
  the run's own state at the same instant, which is a second, quieter lie.
- Refusing `keepRecord: true` together with `redact` removes a combination that
  builds today, and is the only option that cannot be made to look like a
  patch.

Which of the three is right depends on whether a kept record is EVIDENCE (the
run as it was, governed by who may open it) or a TRANSPORT (something handed
on, governed by what it may contain). That is a decision, not an implementation.

**What was done here instead.** The JSDoc no longer claims what it cannot
deliver. `FlowchartAsToolOptions.redact` now says, in its own "what it does NOT
govern" list, that a kept record holds the plaintext on
`recording.snapshot.sharedState` while its commit log holds `REDACTED`, and
points here. The conformance test already asserted it; the words now match the
assertion.

**Cost of waiting.** A consumer who sets `redact` because a chart handles
secrets, and `keepRecord` because they want the record, is told by the option's
own documentation that the combination is safe to serve back to a model. It is
safe in the commit log and unsafe in the state view, and nothing at runtime says
so.

---

# Appended 2026-09-07 — the receipt's FOURTH review round: three more

Entries 1-6 are behaviour changes somebody has to decide on. These three came
out of the last review round on `servedAt` / `SERVED_GAPS` (9.88.0), where the
round's job was to make every printed sentence true. Each is a place where the
account is now HONEST about a limit rather than fixed — which is the outcome the
house law asks for (a Lens may omit, never deny), and the reason each one is
here instead of in the diff.

---

## 7. `cache-transform` does not name `tools.forced` or `tools.withheld`

**The reproduction.** `servedView.ts` · `SERVED_GAPS['cache-transform'].fields`
names eleven fields: the three `cache.*` that describe the rewrite, plus the
composition it was handed — `system.hash/chars/pieces`,
`messages.count/entries/requestOnly`, `tools.names`, `tools.schemaHashes`. It
does NOT name `tools.forced` or `tools.withheld`, and the entry's own stated
rule is "everything a rewrite could have changed".

A cache strategy is handed the whole `LLMRequest` and hands one back. A strategy
that dropped the synthetic answer tool from `request.tools`, or rewrote
`toolChoice`, would send a request whose forcing does not match the receipt —
and the receipt would not know, because `callLLM.ts` builds those two fields from
assembly's own decision (`deps.schemaTool?.name`, `scope.wrapUpAsked`) rather
than from `preparedRequest`. `params.toolChoice` IS read past the strategy, so a
strategy that rewrote the choice would leave the two halves of the same fact
disagreeing on one receipt.

**Why it is not fixed here.** Deciding it needs a measurement nobody has taken:
whether any strategy in the wild rewrites `tools` or `toolChoice` at all, and
whether the right answer is to widen the gap (cheap, weakens a caveat that is
already the weakest entry in the catalogue) or to read both fields off
`preparedRequest` at mint time (a behaviour change to a shipped receipt field,
which would then describe the wire rather than the decision — two different
facts, and the second is not obviously the more useful one). Widening it on a
guess would put two more fields under a caveat this library cannot show a run
for, which is the "gap that names a field for the wrong reason" this whole round
was about.

**Cost of waiting.** A reader who checks `tools.forced` against the wire on a run
with a rewriting cache strategy can find a mismatch the catalogue does not warn
about. No shipped strategy in this repo rewrites either field, so the exposure
today is a consumer's own strategy.

---

## 8. `cache-transform` is raised on every view, including charts with no strategy

**The reproduction.** `servedView.ts` · `viewOf` pushes `gapOf('cache-transform')`
unconditionally. On an `LLMCall` view the gaps read
`['no-receipt-on-chart', 'cache-transform']` — the first saying no cache strategy
runs on this chart, the second describing what a cache strategy may have done.
Two sentences on one view, one of them about a mechanism that cannot be present.

**What was done here instead.** The printed sentence was made honest about being
the WEAKEST claim on the view rather than about the mechanism that makes it one.
It says what reached the provider may differ from the fields below and that
*"where another gap on this view covers one of them, that gap is the stronger
claim"* — so a reader who also has `no-fold-base` or `no-receipt-on-chart` in
front of them knows which sentence governs. Two later rounds moved the rest out
of it: the sixth deleted the mechanism clause that named the charts (a printed
sentence names no chart), and the seventh removed the quoted `RECEIPT_BOUNDARY`,
because a sentence opening "A receipt describes the request…" was being printed
on the receipt-less views this very entry exists on. The condition now lives in
the comment beside the entry and in the qualifier on `ServedGap.fields`.

**Why the other option is not built.** Raising it only where a cache subflow is
mounted means INFERRING from a recording that no strategy ran, and absence of
evidence is exactly the inference this feature exists to refuse: a recording
that travelled without its fold base would read "no strategy" for the same
reason it reads "no system prompt". A conditional raise would therefore need its
own committed fact (the strategy's name at mount) before it could be honest, and
committing a new fact is a behaviour change to every run.

**Cost of waiting.** The weakest entry in the catalogue is on every view, so a
renderer that prints all gaps prints one line of boilerplate per epoch. It is
noise rather than a false statement, and the sentence says so by pointing at the
gap that outranks it; `test/lib/time-travel/gap-sentences.test.ts` asserts that
pointer on a base-less view, where both gaps name `system.chars` and the rebuild
really is short.

---

## 9. A slot's attention drops never reach the receipt

**The reproduction.** `Receipt.omittedForAttention` is declared, documented, and
supplied by no chart IN THIS LIBRARY — measured on 9.88.0 across both shapes,
and the walk re-takes that measurement on every run. It is a key of
`UNGAPPED_FIELDS` for exactly that reason: its absence is universal and says
nothing about any particular recording. `buildReceipt` is a pure exported mint,
so a consumer that calls it directly CAN hand it the fact — which is why the
claim is scoped to this library rather than to the world.

**The cause.** A slot writes its budget drops to `slotCompositions` INSIDE its
own subflow, and no boundary bubbles that record out, so the agent's request
assembly has nothing to pass and `buildReceipt` is never handed one. And there
is a second reason stacked under the first, found while writing the assertion
for the `UNGAPPED_FIELDS` sentence: the built-in slots never DROP anything.
`slotOverflow` answers an over-budget composition with `planAction: 'none'`, the
whole content goes to the model, and `droppedCount` is 0 on every run this
library can produce. So a run where something was dropped and the receipt is
silent — the run that would pin "never that nothing was dropped" outright —
cannot be driven here; `gap-sentences.test.ts` asserts the shape's half (hand
the mint a drop and it carries it) and says so beside the assertion.
`callLLM.ts` deliberately does not go looking for it: a tracked read of an
always-absent key put `slotCompositions` on every `call-llm` stage's read set,
which gave `trajectory.ts` a phantom context source per loop and moved the
localizer's ranking. The read alone was the defect.

**Why it is not fixed here.** The fix is an outputMapper change at the slot
subflow boundary — new state crossing out of every slot on every run, read by a
recorder that does not exist yet — and that is a behaviour change to the
composition path, not to the receipt.

**Cost of waiting.** "Why did the model not know that?" is the question the field
was declared for, and today the record cannot answer it from the receipt. The
`UNGAPPED_FIELDS` reason now says so in the words a reader meets: absent means
nobody recorded a drop, never that nothing was dropped.

---

## 10. An assertion can be weaker than the clause it checks

**The reproduction.** `test/lib/time-travel/gap-sentences.test.ts` binds every
printed gap sentence to a run: each sentence is decomposed into quoted clauses,
each clause carries an assertion, and the clauses must PARTITION the sentence,
so no printed word sits outside a checked claim. That closes "a claim with no
test". It does not close **a claim whose test checks less than the claim says**.

Written out, because it is the residue of seven review rounds and not a
hypothetical: `no-fold-base` says a value that could not be recovered "reads as
empty rather than as unknown". The assertion checks four such values on one
resumed run — the system text, its pieces, the tool names, the tool schemas.
The clause quantifies over every field the gap names. The difference between
"four, here" and "every, always" is real and nothing in the file measures it.

Two more instances, found by the verifier that approved the release and recorded
here rather than widened at the last minute: `cache-transform`'s "where another gap
on this view covers one of them, that gap is the stronger claim" is asserted for ONE
pairing (`no-fold-base` on `system.chars`) where the sentence quantifies over every
co-present gap; and `forced-tool-schema`'s "so the tool list is complete" is
asserted on the grouped chart shape only, where the sentence covers both. Each is
true where it was measured and unmeasured where it was not — which is exactly the
shape of this entry.

**The cause.** The partition is a TEXT operation over the sentence; the
assertion is a JUDGEMENT about what would prove the clause. No structure
available here can compare the two — that comparison is the reading a person
does, and it is the same reading that found the four false sentences this round
repaired.

**Why it is not fixed here.** Every candidate fix is a bigger claim than the
one it would check. Property-testing each clause over generated recordings would
assert against the same rebuild the clause describes, which proves the rebuild
agrees with itself; requiring N assertions per clause counts assertions rather
than strength; and a coverage threshold over `servedView.ts` would measure lines
executed, not claims established. None of those is machinery worth adding on the
last round of a release.

**Cost of waiting.** A clause can drift from its assertion without any test going
red — the failure mode is a sentence that is a little stronger than what was
measured. It is bounded by what the partition already guarantees (every clause
has a run behind it) and by the size of the surface — one short sentence per
catalogue entry, a handful of clauses each. The honest statement of it is in the
new file's header, in
`test/helpers/gapProseClaims.ts`, and in the CHANGELOG: **the blind spot is a
claim nobody wrote an assertion for.**
