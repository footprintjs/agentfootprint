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
— the turn, tools and argument validation, thinking, asking a person, the inputs layer, structured
output, memory and RAG, the evidence gate and its figures (the `guard` posture's flagged draft
values included), a tool's declared coverage and described results (`absent()`, `coverage()`,
`describedResult()` — words a tool composes from its call, and the data its envelope carries),
compaction (the originals a fold keeps beside its summary, `foldedSpans`), check-ins, skill graphs,
compositions —
with a canary in each place and fails if one reaches a record; the run emits the same events with
and without it. Under ANY policy — `{ keys: ['ssn'] }` as much as the list — events are
DEFAULT-DENY by one value-kind rule: after the policy has served an event by name, numbers, flags
and null pass, and a string passes only when it is one of the library's own words (statuses,
verdicts, stop words, event types, its fixed sentences — one set generated from the code's own
types); every other string is the placeholder, at any depth and as a key, on the library's events
and on your own `emit`s alike. So a copy the library derives from a selected value under a name of
its own (a validation issue's quote, a check-in's rendered arguments, a parser's message about the
draft, the words of a tool's coverage declaration) never leaves raw — there is no list of fields, or
of derived copies, to keep complete. Ids (a call's, a stage's, the run's), the names your app
declared (a tool's name, a skill's id, the model's name) and who asked or approved are no library
words, so a policy keeps them out of events too, and the answer account over such a record refuses
to tell rather than guess which events belong to which call. A policy makes events conservative;
state, the snapshot and the commit log keep footprintjs's rule, by name. For full observability,
run with no policy.

The policy reaches every run the agent's records come from. A composition (`Sequence`,
`Parallel`, `Conditional`, `Loop`, `Graph`, `Workflow`) adopts its members' policies. A run a tool
starts gets the calling run's policy as `ToolExecutionContext.redact`: the `.selfExplain()` debugger
takes it, and a tool that runs another agent passes it on — `agent.run(input, { redact: ctx.redact })`,
the new per-run option, which can only add names (an `Agent`'s run only; a composition is covered by
what its members declare). `flowchartAsTool` and `runbookAsTool` join it with their
own, so every record of the inner run keeps out what either names; what they hand the MODEL becomes
the tool's result in the calling agent's conversation, so the model reads the real value only when
the calling agent keeps its whole conversation out of its records (`conversationRedaction()` or
more) — under a narrower calling policy it reads the record's view, and the value reaches no record
of the calling agent either way. A run's redaction lives with the run, never on the agent
instance: a snapshot is served under the policy its own executor was handed, a fact under the policy
of the run it belongs to (found by its run id, even after the next run opened; before an agent's
first run, under the policy it declares; a fact naming a run the instance can no longer vouch for —
more than 32 runs ago, or one another instance ran — is refused wherever a policy exists on the
instance), events reach only the listeners of the runner that ran them, and a pause carries the
run's policy in its own state —
every resumed leg writes its whole policy back, a `redact` passed to `resume()` included — so every
later leg is covered by it without being handed it again (an app pattern excepted — see below), and
by the names the paused leg kept out.
A resume that cannot carry it is refused before anything runs: `ResumeRedactionError` (new, from
`agentfootprint`; `reason: 'unreadable'` for a carried value this library did not write, `'missing'`
for a checkpoint whose run kept names out but carries no policy — refused even when the resume names
one, which cannot stand in for the policy the run was covered by — and `'unknown-pattern'`: a
pattern is never compiled from a checkpoint, so a carried pattern is a reference to one the resuming
side holds — declared on the agent, named at the resume, or the library's vocabulary; resume with
the `redact` the run was handed when it carried an app pattern). A snapshot is served only from an
executor a run of this library opened — "no policy" is an explicit entry, and an unknown executor
serves nothing. The person's reply is served before the leg starts, so a fresh instance or another process
resumes as the paused one would. Every public member of `Agent` is classified against the law by
type — served, structure, the caller's own, or control — and the served ones are checked by a
property test for random keys, patterns and `fields` selectors. The policy is validated where it is
declared: a misspelt field, a list of patterns where a policy object belongs, a frozen global RegExp
(footprintjs could not reset it) or a policy that names nothing is refused with the reason.

Readers of a redacted record never read the placeholder as a value — and only a record that says a
policy covered its run (a marker row in its snapshot's `recorders`, the record a chart-backed tool
keeps included) is read that way, so a run with
no policy reads exactly as before, even where a tool returned the word `REDACTED`. The answer
account says the question, the answer, a tool's result (a row set kept out inside one too), the
flagged values of the evidence gate, the history earlier results sit in, the words of what a tool
declared it checked (its items still counted) and a typed answer's limits are KEPT OUT — never "not
recorded", "the run did not finish" or "no tool ran" — and refuses to tell rather than read a
placeholder it does not handle (template set 11). `assessAnswer` gives no standing over a state key
the record keeps out and names it (`AnswerAssessment.keptOut`); `agent.assessment()` reads the live
run and is unaffected. The served views (`servedViews`, `servedAt`) read a redacted snapshot without
throwing. A `Trace` of a run under the policy reports `redaction: 'policy'`. The context ledger
counts a runner's run live, so a policy does not demote a tool the run used; a kind whose uses or
offers the record keeps out and nothing live can answer is left unmetered for that run
(`RecordedRun.unmetered`, new) rather than counted as unused. Causal memory keeps the real tool calls
it replays to the model, as every memory keeps what it stores.

Named limits: the run's answer leaves its chart as a bare string and footprintjs serves an unnamed
output as it is, so a recording's `run.exit` payload carries it whatever the policy; error text
written by code (`error`, `errorMessage`) is not on the list (on events any policy keeps it out
anyway; in state, name it yourself); under a policy, a sentence the library composes around a value
(a route's `rationale` naming a count), a tool's `description` and name, the ids of the run, its
stages and its calls, and who asked or approved are the placeholder on events; console warnings are not records; in STATE, fingerprints and content hashes stay,
so a short kept-out value can be confirmed by hashing guesses; a checkpoint is not proof — one edited to drop both its policy and its
marks, or to carry a narrower one, resumes under what it says; an `LLMCall` or `LlmRouter` takes no
`redact`, so one run on its own is covered by nothing; a chart-backed tool's own `$emit` payloads reach the
recorders handed to that tool as footprintjs serves an emit, by event name; in STATE, footprintjs's
rule reads a value's own enumerable keys, so a Map's or a Set's contents, an Error's `cause` (an
`AggregateError`'s `errors`), a non-enumerable key or a `toJSON` that writes a privately held name
keep a value a by-name policy selects (on events the value-kind rule keeps every one of them out);
names match exactly. An agent's chart mounted into an executor the app built (`getSpec()`) keeps the
agent's declared policy on its events — each stage of a runner's chart is bound to its runner; the
executor's own policy never reaches them, so declare the policy on the runner — while its state
follows that executor's own policy.
The full table is in `src/redaction/README.md`.

Requires footprintjs `^9.44.1` (the peer range rises from `^9.41.0`): the door relies on 9.43.0's
redaction law, under which pause payloads, thrown values and a subflow mapper's copies are served by
the policy too, and on 9.44.1's fix for `fields` policies — the vocabulary declares one, and before
9.44.1 a model's argument or a tool's result holding a key named `constructor` or `toString` could
fail such a run or blank an event whole (the dev pin and lockfile move to 9.44.1 with it). footprintjs 9.42 and later run on
Node 22.
