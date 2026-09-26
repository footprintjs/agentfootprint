**Support** — the Tier-4 exits: adapters that ship the typed event stream out of
the process, plus the two doors that file a bug report somewhere.

## What it reads / what it writes
Reads `AgentfootprintEvent`s from the dispatcher; writes them to a foreign
system. Nothing here is the record — `src/events/` and `src/recorders/` own
that; an exporter that drops an event drops only its own copy.

## The one law here
Telemetry that fails invisibly is indistinguishable from telemetry that works,
so delivery failures are themselves reported (`deliveryErrors.ts`).

## How an Error reaches a wire (`lib/wireJson.ts`)
An `Error` anywhere in an event is written as `{ name, message, code? }` plus a
bounded `cause` chain — never a custom property (an axios error's
`config.headers.authorization`), never `stack`, never what its own `toJSON`
returns (a real `AxiosError`'s returns its config and stack: the replacer reads
the holder's RAW value, so `toJSON` never pre-empts the rule). Every serializer
of the record goes through it: here (`file`, `cloudwatch` / `agentcore`,
`xray`, the `otel` attribute text, the console default; `audit`'s sanitizer
renders Errors with the same `wireError`), the browser stream
(`stream.ts · encodeSSE`), the recording artifact, the recording file sink,
the bug-report bundle, and the tool-result text the model reads and `history`
keeps (`core/agent/validators.ts · safeStringify`). Detached delivery renders
Errors before it clones (`strategies/attach.ts · snapshotEvent`, Maps and Sets
entered too), so sync and detached delivery write the same bytes.
`test/architecture/wireJsonOnly.test.ts` refuses a direct `JSON.stringify` in
these modules unless it is allow-listed with a reason.

**What it costs** (measured by `bench/wire-json.mjs`, standalone, on a 553 KB
event): `toWireJson` 0.92 ms vs `JSON.stringify` 0.46 ms (2.00×); detached
`withWireErrors` + clone 2.09 ms vs clone 1.30 ms (1.60×) when the event holds
no Error, 3.08 ms when it holds one (it is then copied whole). A value that
holds no Error serializes to the same bytes as before.

A custom sink that serializes events should do the same:

```ts
import { toWireJson } from '../../lib/wireJson.js';
const line = toWireJson(event); // not JSON.stringify(event)
```

## What a span-MAPPING exporter may carry (`otel.ts`)
`file` / `cloudwatch` / `agentcore` / `audit` serialize the whole envelope and
inherit every field. `otelObservability` MAPS selected signals onto spans, so
each thing it carries is placed on purpose, and the rule for placing one is:

- **Structure is exported, content is not.** Ids, enums, counts, check names
  and registered tool names ride by default. A value a person, a model or a
  tool author WROTE rides only behind a content switch, and there are two, each
  off by default: `captureContent` (the turn's prompt and answer, the evidence
  gate's unsupported values, an evaluation's explanation) and
  `captureToolContent` (tool arguments and results). A structure event never
  carries a coverage sentence (`looked_for`, `what`, `why`, `tryInstead`, an
  unregistered `tryInsteadTool.tool`) or an id the model wrote that names no
  result — any of them can carry an argument (the coverage README's "What that
  does not close").
- **Exported content is the model's view, never more.** A call's arguments
  are the proposal, serialized when `tool_start` arrives (the tool receives
  that same object and may write into it), with every key a rule changed or
  the tool's own `redact` policy hides withheld as `'REDACTED'` — `tool_end`
  carries those keys' NAMES only (`changedArgKeys`), because a rule can add a
  value the model never saw and an event reaches every sink. Results are what
  the model READ (after `onToolResult`, the cap, placement). Only a call that
  ran and returned exports content; a `codeRunnerTool`'s program never does
  (recognized by its `tools.code_run` event — another code-executing tool is
  not). The
  adapter redacts nothing itself and reads nothing but the events.
- **No one but the operator sizes an attribute.** Every string outside the
  content switches is capped at 256 characters (`otel.ts` · `capAttrs`),
  span names carry a tool or model name at most 64 (`otel.ts` ·
  `spanNamePart`); a
  content value over `maxContentChars` is OMITTED with its size stated, never
  cut (the prompt and answer included); the session id is exported as its
  SHA-256 (`conversationId: 'digest'`,
  the default); standing events are capped per turn with one summary.
- **Spec names only where the spec has the thing** (`gen_ai.conversation.id`,
  `gen_ai.evaluation.result`, `gen_ai.tool.call.arguments` / `.result`);
  everything of ours is `agentfootprint.*`. The one exception is pre-existing:
  `gen_ai.task.input` / `gen_ai.task.output` are AgentCore's names, not in the
  current GenAI registry, kept for the consumers that read them and not
  extended (CHANGELOG follow-up).
- **Never invent a value to fill a spec slot.** No session → no conversation
  id (never the runId); no `label` on the score → no `score.label` (never one
  derived from `threshold`); a non-object tool value → the adapter's own
  `.content` attribute, never the spec's object attribute.
- **A score is parented to a run only when it can show it belongs there** —
  emitted from inside that run, or from the same session. Anything else (every
  `agent.emit` after the run) rides an `agentfootprint.evaluation` span of its
  own — a NEW trace, never a child of whatever span is active — naming the
  ref: run ids are sequential names, not capabilities.
- **A late event is recorded or reported, never dropped in silence.** The
  checker accounting and a score filed after the run arrive after `turn_end`;
  a real SDK drops span events on an ended span, so each lands on a short span
  under the turn's root — while the run is within the last 32 closed turns of
  that strategy. Past that window the score is exported unparented AND
  reported through `onError`. The late path is best effort: the durable home
  for after-the-run scores is a score record, not a trace span.

```ts
const otel = otelObservability({ serviceName: 'support-agent' }); // content-free
agent.enable.observability({ strategy: otel });

await agent.run({ message }, { sessionId });   // → gen_ai.conversation.id = sha256(sessionId)

// A score filed from inside a stage of the run lands on the span it names.
// One filed afterwards by the app carries no session, so it cannot prove
// whose run it names: it stands alone, unparented, with the ref on it.
agent.emit('agentfootprint.eval.score', {
  metricId: 'groundedness', value: 0.4, label: 'fail', target: 'run', targetRef: runId,
});
```

## Files
- `otel.ts`, `xray.ts`, `cloudwatch.ts`, `agentcore.ts`, `file.ts` — exporters.
- `audit.ts` — a tamper-evident bundle.
- `githubBugReporter.ts`, `githubDeviceSignIn.ts` — filing a report as the
  reporter, not as the library.
- `deliveryErrors.ts` — where an exporter's own failures go.
