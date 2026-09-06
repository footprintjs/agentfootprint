**Support** — the Tier-4 exits: adapters that ship the typed event stream out of
the process, plus the two doors that file a bug report somewhere.

## What it reads / what it writes
Reads `AgentfootprintEvent`s from the dispatcher; writes them to a foreign
system. Nothing here is the record — `src/events/` and `src/recorders/` own
that; an exporter that drops an event drops only its own copy.

## The one law here
Telemetry that fails invisibly is indistinguishable from telemetry that works,
so delivery failures are themselves reported (`deliveryErrors.ts`).

## Files
- `otel.ts`, `xray.ts`, `cloudwatch.ts`, `agentcore.ts`, `file.ts` — exporters.
- `audit.ts` — a tamper-evident bundle.
- `githubBugReporter.ts`, `githubDeviceSignIn.ts` — filing a report as the
  reporter, not as the library.
- `deliveryErrors.ts` — where an exporter's own failures go.
