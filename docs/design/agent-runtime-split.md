# Agent runtime split

This change splits `src/core/Agent.ts` without changing its public paths,
run results, recorded values, refusals or microtask ordering. It covers the
whole file through helper extraction, internal responsibility extraction and
the remaining documented facade. Other oversized files have separate work.

## Current responsibilities and dependencies

The file declares run options, constructs the runner, admits run and resume
doors, assembles recording and observer resources, carries conversations,
projects terminal results, and builds the cached chart. The chart mounts the
existing seed, request, routing, tool and final-branch implementations.

Imports reach provider contracts, tools and credentials, memory and skills,
artifact storage, time, redaction, integrity, observation and native runner
contracts. Construction imports `AgentBuilder`, which in turn constructs
`Agent`. New internal owners must not import either class back. The existing
public import paths remain the only public doors.

The important temporal coupling is between the once-built chart and the native
component executing it. A build-time closure may retain configuration; a run
fact must come from its captured component or invocation. A latest-selected
run is not a substitute for the component whose stage is still executing.

## Module rules

All new owners live inside `src/core/agent/runtime/`, below the existing
internal agent folder. This path differs from `Agent.ts` by more than case on
every supported file system. There is no `index.ts`: `./Agent` continues to
resolve to the facade file. Each owner has a README and adjacent tests.
Imports point towards contracts and plain functions; sibling owners never
depend on each other both ways.

| Owner | Rule |
| --- | --- |
| Run options | Declare the existing run options, preserving their public path and documentation. |
| Configuration | Resolve static constructor inputs and reject invalid configurations in the current evaluation order. No run state. |
| Native bindings | Expose only the runner services each owner needs through captured closures. No independent execution identity. |
| Turn admission | Preserve run/resume validation, funnel, execution and finalizer order. No extra async boundary. |
| Conversation | Project detached checkpoints and restore continuation state without borrowing another invocation. |
| Recording | Start, stop and file recordings for their captured run, with the current reverse-finalizer order. |
| Observations | Read the existing snapshots, detached reports and terminal verdicts in the current precedence. |
| Seed wiring | Keep the seed factory's late-bound catalog and per-run state accessors. |
| Catalog wiring | Build the registry and perform the existing ontology, artifact and composed-tool refusals. |
| Request wiring | Bind the existing request and window stages with per-run memoization. |
| Routing wiring | Bind the existing route decorators, tool handler and conditional branches. |
| Chart assembly | Wire the existing stages in their current order and choose the same flat or grouped shape. |

## Extraction order

1. Move whole independent declarations, constants and snapshot folds first.
2. Extract plain business functions behind explicit, small typed ports.
3. Keep public wiring and documentation together in the facade.
4. Leave real decisions in the existing stage owners and chart wiring free of
   new business logic. This split does not redesign the stages' behavior.

Steps 2 and 3 require design and behavior review. They are not presented as a
token-identical helper move. Configuration does not gain new defaults,
freezing or validation; run functions do not gain wrapper promises; accessors
do not become cached copies. Existing public methods retain their contracts.

The documented facade may itself exceed the source line limit: the current
public documentation and signatures already occupy more than that limit
before implementation. Comments will not be shortened to pass the check.
The facade may retain exactly public documentation, public signatures and
one-line delegation or wiring to owners. Branches, loops, validation and state
belong to the internal owners. If that documented facade still exceeds the
limit, its ratchet entry drops to the measured facade size. No baseline will
increase. Run-option declarations move together with their documentation.

## Validation

Existing goldens stay unmodified. Adjacent behavior tests cover captured
invocations, refusal order, pause/resume, checkpoint detachment, recording
teardown and conditional chart mounts. The existing full checks run in hosted
CI, including lint, types, build, tests, package contracts, generated files,
documentation truth, layering and file size. Unrun checks are reported plainly.

Path-literal readers and source citations move with their actual owners.
There are no new public aliases, package exports, version changes or release
effects in this split.

## Implemented owners

The documented `Agent` facade extends `RunnerBase` directly and binds its protected
native capabilities through `native/host.ts`. A module-private non-enumerable
Symbol carries the context through a transparent Proxy without reserving an
application method or string field. The narrative projection retains its original
borrowable native-runner contract.
`context.ts` assembles the private owners; it creates no executor, lease, run
ID or selected-run substitute. Every owner function names the subset of that
context it reads. Public runner calls still dispatch through the original
runner, including subclass overrides. The original public documentation stays
on the facade once; the implementation does not duplicate it in its owners.

- `configuration/`: constructor declarations, defaults and ordered validation.
- `native/`: captured capabilities and the existing initialization wiring.
- `turn/`, `resume/`, `continuation/`: the existing admission and execution doors.
- `conversation/`: checkpoint, restoration, clock and pending-question folds.
- `recording/`, `resources/`, `integrity/`: the original captured-run effects.
- `info/`, `observations/`, `typedOutput/`, `terminal/`: public projections and settlement.
- `catalog/`, `skills/`, `slots/`: declared capabilities and their offers.
- `seed/`, `request/`, `toolCalls/`, `routing/`, `chart/`: existing stage factories and chart wiring.

The measured facade is 941 lines, with no private state or control flow. Its
size-ratchet entry drops from 6014 to 941 under Claude's named facade ruling.
Every new runtime TypeScript file is at most 600 lines. The public wrappers
return their owner's result directly; an async owner does not gain a second
async wrapper. Existing behavior suites move beside their owners with the
same assertions and fixtures. No golden or package export changes belong here.
