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

All new owners live inside `src/core/Agent/`, beside the facade. Each owner
has a README and adjacent tests. Imports point towards contracts and plain
functions; sibling owners never depend on each other both ways.

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
Completion requires either a facade within the limit or an explicit ruling
naming its remaining documentation and wiring. No baseline will increase.

## Validation

Existing goldens stay unmodified. Adjacent behavior tests cover captured
invocations, refusal order, pause/resume, checkpoint detachment, recording
teardown and conditional chart mounts. The existing full checks run in hosted
CI, including lint, types, build, tests, package contracts, generated files,
documentation truth, layering and file size. Unrun checks are reported plainly.

Path-literal readers and source citations move with their actual owners.
There are no new public aliases, package exports, version changes or release
effects in this split.
