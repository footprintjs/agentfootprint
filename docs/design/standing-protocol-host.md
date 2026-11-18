# Event protocols and conversation ownership

The native agent is the executable FootprintJS flowchart. Hosting composes its
existing invocation lifecycle; it does not run a second chart that coordinates
the same execution. The public AG-UI guide contains the architecture diagram.

## Independent strategies and lifetimes

`ProtocolAdapter` chooses request planning, event translation and framing.
`standingAgent` chooses a bounded conversation pool; `streamHandler` chooses a
fresh runner per request. Both require authoritative server state to continue
conversations. Instance retention is an optimization, not a substitute for a
restorable checkpoint. Provider connections can be shared when their contracts
allow it; mutable run state, credentials and translators cannot.

| Component | Responsibility and evidence |
| --- | --- |
| `httpHost` and `protocolRoute` | Shared socket and door guards; parsed input remains a claim. Each exchange has its own encoder counter and bounded response. |
| `standingAgent/requests/handler` | Verify the caller, distinguish artifact/session operations, apply admission and enter the existing lane. Existing ingress records retain safe decision identifiers, never the request body. |
| `standingAgent/turn/run` | Hydrate the owned conversation, plan the turn, capture one native invocation, persist and hand over artifacts before terminal delivery. Protocol pause information joins the existing pause envelope. |
| Native runner | Execute the agent chart once. Its recording owns the actual model context, tool work, evidence and final assessment. |
| `RunTranslation` | Request-local protocol state. Served events must match the captured invocation; consumer-scope emissions and unrelated runs are excluded. |
| Host delivery | Explicitly authorized final text and custom metadata. This has different provenance from a served recording observation. |

There is one session writer and one lane across the old and new wires. Existing
ownership, admission, durability and artifact scope are not reconstructed by a
protocol adapter. Multi-process deployments still require routing or external
coordination: per-process guards do not become distributed locks.

## Request and delivery boundaries

The native planner runs after ownership-checked hydration. Its frozen planned
turn and accepted claim container are request-local views, not authorization
capabilities. A host wrapper can label its final artifact check-in from the
actual planned message without parsing browser history or keeping another cache.

Record translation consumes only served events. Hosted delivery withholds
candidate text at every depth, including nested-agent results, until the host
authorizes its final answer. App custom data enters through an explicit reply
port and the declared projection; the library does not label that data as a
recording event. Tool argument/result projections may further narrow served
data. Pooled mode currently refuses request-specific frontend tools rather than
mutating a retained tool registry.

The encoder checks each batch before writing it. Event and aggregate byte
limits leave a fixed terminal-refusal reserve. Oversized final output cannot
publish a successful terminal first. Known native refusal codes retain fixed
safe words; exception messages, private identifiers and credentials do not cross.
Cancellation and all terminals detach observers. A terminal is not an ACK or
durable replay stream; reconnection reads authoritative session/artifact state.

## Restorable application context

`RunTurn.sourceEvidence.recent` is a separately opted-in, preparation-scoped
metadata reader. It uses the same bounded source admission/permission owners,
fresh producer resolution and native read procedure as retained evidence. It
grants no rows, scalar values, tool execution or artifact store. Its lease is
revoked before `proceed` and on every exit.

The application must describe what a retained observation proves. A newest
retained array lookup does not prove it was the last lookup of any kind.
Current verified selection remains distinct from historical observations.

## Review controls

Behavior tests cover both hosting strategies, shared-wire history/admission,
verified ownership, exact invocation attribution, cancellation, restored pauses,
native refusal codes, guarded output, nested drafts and output limits. Disabling
delivery authority, ownership filtering, aggregate limits, pause persistence,
ingress forwarding or refusal mapping makes the corresponding tests fail.
Preparation tests cover current permissions/producers, expiry, foreign scope,
paging, deadlines and revocation. Full checks run through normal library CI;
consumer tests qualify the actual installed archive and engine separately.
