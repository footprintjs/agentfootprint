---
type: added
---
**Keep personal data out of an agent's records: `Agent.create({ redact })`.** One door, a
footprintjs `RedactionPolicy`, for everything the library keeps or serves about the agent's runs —
`getLastSnapshot()`, the narrative, every typed event (`agent.on`, attached recorders, the deferred
tier), recordings (plain and packed), traces, the observability strategies (console, file, audit,
OpenTelemetry, CloudWatch, X-Ray, AgentCore), bug reports, answer accounts and the self-explain
tools. It never touches what the agent computes on or hands back: the model's input, what your
tools receive, the answer `run()` returns, a host's streamed reply, the conversation the agent
continues and the resume checkpoints keep the real values. A policy selects by NAME (footprintjs's
law): a state key of that name, and a field of that name at any depth of an event.

`conversationRedaction(extra?)` (from `agentfootprint/security`) is the library's own list of the
names an agent's record carries the conversation under — the person's message, the model's words and
thinking, tool arguments and results, recalled memory and retrieval, injected context, a person's
reply to a pause, the draft a schema check rejected, what one member of a composition hands the
next — joined with the fields your tools name:
`redact: conversationRedaction({ patterns: [/ssn|email/i] })`. A test runs every feature on the list
with a canary in each place and fails if one reaches a record; the run emits the same events with
and without it.

The policy reaches every run the agent's records come from. A composition (`Sequence`,
`Parallel`, `Conditional`, `Loop`, `Graph`, `Workflow`) adopts its members' policies. A run a tool
starts gets the calling run's policy as `ToolExecutionContext.redact`: `flowchartAsTool` and
`runbookAsTool` join it with their own, the `.selfExplain()` debugger takes it, and a tool that runs
another agent passes it on — `agent.run(input, { redact: ctx.redact })`, the new per-run option,
which can only add names. The policy is validated where it is declared: a misspelt field, a list of
patterns where a policy object belongs, a frozen global RegExp (footprintjs could not reset it) or a
policy that names nothing is refused with the reason.

Readers of a redacted record never read the placeholder as a value. The answer account says the
question, the answer, a tool's result, the flagged values of the evidence gate and the history
earlier results sit in are KEPT OUT — never "not recorded", "the run did not finish" or "no tool
ran" — and refuses to tell rather than read a placeholder it does not handle (template set 11).
`assessAnswer` gives no standing over a state key the record keeps out and names it
(`AnswerAssessment.keptOut`); `agent.assessment()` reads the live run and is unaffected. The served
views (`servedViews`, `servedAt`) read a redacted snapshot without throwing. A `Trace` of a run under
the policy reports `redaction: 'policy'`.

Named limits: the run's answer leaves its chart as a bare string and footprintjs serves an unnamed
output as it is, so a recording's `run.exit` payload carries it whatever the policy; error text
written by code (`error`, `errorMessage`) is not on the list; console warnings are not records. The
full table is in `src/redaction/README.md`.

Requires footprintjs `^9.43.0` (the peer range rises from `^9.41.0`): the door relies on 9.43.0's
redaction law, under which pause payloads, thrown values and a subflow mapper's copies are served by
the policy too. footprintjs 9.42 and later run on Node 22.
