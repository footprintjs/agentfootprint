---
type: added
---
**Say when "now" is and which zone the person is in — and have it recorded: `.time()`.** A
multi-user app serves people in many zones, and "since 8" means 8 in the person's zone, not the
server's. Arm the clock with `.time()` and pass it per run: `agent.run({ message, time: { now:
message.sentAt, zone: 'America/Los_Angeles' } })`. The run's zone wins; `.time({ zone })` is an
optional fallback; a run with neither is refused before it starts, by name — the server's zone is
never used. A zone is an IANA name (`PST` or `+05:30` is refused). With no `now`, the turn's start
is used and recorded as a default nobody chose (`nowSource: 'default'`). The clock is on the
record (`agent.findings()`): one `clock` row per turn, a window set in a UI (`time: { window }`)
recorded as `source: 'control'`, and one `call` row per dispatched call with `dispatchedAt` — the
moment the tool actually ran, which after a pause is later than `now`. A paused turn keeps its
clock: `resume(checkpoint, answer, { time })` with a different `time` is recorded as a
`clock-on-resume` row and not applied. With `.limitsTravelWithTheAnswer()`, each `Period:` line
is shown in the person's zone with the zone named — `2026-10-09 08:00–08:40
America/Los_Angeles (UTC-07:00)` instead of raw UTC instants — while the typed record keeps the
instants as declared. Nothing is served to the model. Without `.time()` nothing changes, except
that passing `time` to such an agent is now refused (it would otherwise look configured and do
nothing). A checkpoint that carries the new rows is refused by an older runtime.
