# RunStepRecorder — Event Structure Contract

This file documents EXACTLY what `BoundaryRecorder` sees for each
composition primitive, so the `RunStep[]` projection can be derived
deterministically. **Update this file before touching the projection.**

The contract has two channels:

- **Flow events** — emitted by footprintjs's `FlowRecorder` when the
  executor traverses subflow / fork / decision / loop transitions.
  BoundaryRecorder hears them via its `CombinedRecorder` interface.
- **Typed events** — emitted by agentfootprint's domain dispatcher
  (LLM calls, tool calls, context injections, composition lifecycle).
  BoundaryRecorder hears them via `subscribe(dispatcher)`.

A single run interleaves both. The shape varies per composition.

---

## A. Single LLMCall (one-shot, no tools)

```
run.entry                               { isRoot: true }
subflow.entry sf-system-prompt          depth=1, primitiveKind=undefined, slotKind='system-prompt'
subflow.exit  sf-system-prompt
subflow.entry sf-messages               depth=1, slotKind='messages'
subflow.exit  sf-messages
subflow.entry sf-tools                  depth=1, slotKind='tools'
subflow.exit  sf-tools
llm.start                               actorArrow='user→llm'
llm.end                                 actorArrow='llm→user'
run.exit
```

Root primitiveKind: NONE recorded as a domain event. The Run itself
has primitiveKind='Run' (not in KNOWN_PRIMITIVES).

Detection: ZERO sibling subflow.entry events with primitiveKind set.
But the `llm.start` events fire → `react` slider steps:

```
RunStep[0] = { kind: 'react', meta.actorArrow: 'user→llm' }
RunStep[1] = { kind: 'react', meta.actorArrow: 'llm→user' }
```

---

## B. Sequence as outermost runner (Sequence(LLMCall a, LLMCall b))

```
run.entry
subflow.entry step-classify             depth=1, primitiveKind='LLMCall'
  subflow.entry sf-system-prompt        depth=2 (slot, no primitiveKind)
  subflow.exit  sf-system-prompt
  subflow.entry sf-messages
  subflow.exit  sf-messages
  subflow.entry sf-tools
  subflow.exit  sf-tools
  llm.start                             rid=step-classify/call-llm#X
  llm.end
subflow.exit  step-classify
subflow.entry step-respond              depth=1, primitiveKind='LLMCall'
  ... same shape ...
subflow.exit  step-respond
run.exit
```

Detection: 2 primitive subflow.entry events at depth=1, INTERLEAVED
with subflow.exit (entry → exit → entry → exit → ...).

```
RunStep[0] = { kind: 'sequential', label: 'asks',     transitions: [User → step-classify] }
RunStep[1] = { kind: 'sequential', label: 'forwards', transitions: [step-classify → step-respond] }
RunStep[2] = { kind: 'sequential', label: 'answers',  transitions: [step-respond → User] }
```

---

## C. Parallel as outermost runner (Parallel(LLMCall × N))

KEY INSIGHT: each branch is mounted DIRECTLY via `addSubFlowChart`
with the branch runner's own chart (`branch.runner.getSpec()`). There
is NO wrapper subflow and NO nested executor. The runner's own
description prefix carries the `primitiveKind` (e.g. `LLMCall`,
`Agent`, `Sequence`) into the parent's BoundaryRecorder, so each
branch boundary is observed as the appropriate primitive — the
behaviour `BoundaryAggregate` and Lens rely on.

Every event the branch fires (typed and structural) flows through the
parent executor's dispatcher: no `scope.$emit` re-emission is needed.
The execution counter is shared with the parent, so step ids are
globally unique across branches.

```
run.entry
TYPED  composition.fork_start           subflowPath=[], branches=['legal','ethics','cost']
subflow.entry legal                     depth=1, primitiveKind='LLMCall'  ← the runner's own kind
subflow.entry ethics                    depth=1, primitiveKind='LLMCall'
subflow.entry cost                      depth=1, primitiveKind='LLMCall'
TYPED  llm.start                        rid='legal/call-llm#X', subflowPath=['legal']
TYPED  llm.start                        rid='ethics/call-llm#Y', subflowPath=['ethics']
TYPED  llm.start                        rid='cost/call-llm#Z',   subflowPath=['cost']
TYPED  llm.end                          subflowPath=['legal']
TYPED  llm.end                          subflowPath=['ethics']
TYPED  llm.end                          subflowPath=['cost']
subflow.exit  cost
subflow.exit  legal
subflow.exit  ethics
TYPED  composition.merge_end            subflowPath=[]
run.exit
```

Detection signals:
- `composition.fork_start` typed event at top-level (subflowPath=[]) — DECISIVE for Parallel.
- N sibling subflow.entry events at depth=1, each carrying the branch runner's `primitiveKind`, all entered before any exit.

```
RunStep[0] = { kind: 'fork',  transitions: [User → legal, User → ethics, User → cost] }
RunStep[1] = { kind: 'merge', transitions: [legal → User, ethics → User, cost → User] }
```

---

## D. Conditional as outermost runner (Conditional with chosen='billing')

```
run.entry
TYPED  composition.route_decided        chosen='billing', rationale='...'
subflow.entry sf-billing                depth=1, primitiveKind='LLMCall' or 'Agent'
  ... branch internals ...
subflow.exit  sf-billing
run.exit
```

Detection signals:
- `composition.route_decided` typed event at top-level — DECISIVE for Conditional.
- 1 sibling subflow.entry event (only the chosen branch ran).

```
RunStep[0] = { kind: 'decide',     meta: { chosen: 'billing' }, transitions: [User → billing] }
RunStep[1] = { kind: 'sequential', label: 'answers',            transitions: [billing → User] }
```

(Or alternatively — model decide as wrapping asks+answers into a
single 'route' step. Keep 2 steps for now: decide entry, decide exit.)

---

## E. Loop as outermost runner (Loop(body, maxIter=3))

```
run.entry
TYPED  composition.iteration_start      iteration=1
subflow.entry body                      depth=1
TYPED  llm.start                        ...
TYPED  llm.end
subflow.exit  body
TYPED  composition.iteration_exit       iteration=1, reason='continue'
TYPED  composition.iteration_start      iteration=2
subflow.entry body                      depth=1, ts > prior body's exit
... etc ...
run.exit
```

Detection signals:
- `composition.iteration_start` typed events at top-level.

```
RunStep[0..N] = one 'iteration' step per iter
```

(Body's react steps appear when DRILLED into the body; not at top-level.)

---

## F. Agent as outermost runner (Agent + tools, ReAct loop)

```
run.entry
TYPED  agent.turn_start
subflow.entry sf-route                  depth=1, isAgentInternal=true
subflow.exit  sf-route
subflow.entry sf-tool-calls             depth=1, isAgentInternal=true
  subflow.entry sf-system-prompt        slot
  subflow.exit  sf-system-prompt
  subflow.entry sf-messages
  subflow.exit  sf-messages
  subflow.entry sf-tools
  subflow.exit  sf-tools
  TYPED llm.start                       actorArrow='user→llm'
  TYPED llm.end                         actorArrow='llm→tool'  (toolCallCount > 0)
  TYPED tool.start
  TYPED tool.end
subflow.exit  sf-tool-calls
... another iteration of sf-route → sf-tool-calls / sf-final ...
TYPED  agent.turn_end
run.exit
```

Detection: NO primitive subflow.entry at depth 1 (only Agent-internal
routing wrappers). Root is implicitly an Agent → `react` steps drive
the slider.

```
RunStep[0] = { kind: 'react', meta.actorArrow: 'user→llm' }
RunStep[1] = { kind: 'react', meta.actorArrow: 'llm→tool' }
RunStep[2] = { kind: 'react', meta.actorArrow: 'tool→llm' }
RunStep[3] = { kind: 'react', meta.actorArrow: 'llm→user' }
```

---

## Detection priority (read in order)

1. `composition.fork_start` typed event at root → Parallel
2. `composition.route_decided` typed event at root (non-Agent-internal) → Conditional
3. `composition.iteration_start` typed event at root → Loop
4. ≥2 primitive subflow.entry siblings at shallowest depth, INTERLEAVED with exits → Sequence
5. ≥2 sibling subflow.entry events at shallowest depth (any kind), CONCURRENT (entries before any exit) → Parallel (fallback when fork_start missed)
6. 1 primitive subflow.entry → that primitive (Agent / LLMCall standalone)
7. 0 primitive subflow.entry, only typed llm events → Agent / LLMCall (whichever, treat as leaf)

The slider total is `runSteps.length` after the kind-specific projection.
