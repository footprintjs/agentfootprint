# Historical replay fixtures

## Saved v2 compatibility packet

`public-v2-no-ownership.json` was emitted by public `footprintjs@10.5.0`
and `foottrace@1.8.0`, using the same two-step chart and options as
`storedCauseFixture({ readSources: true, plain: true })`. The fixture preserves
the six public sink entries after one `JSON.stringify`/`JSON.parse` round trip.
No entry, attempt label, source label, receipt or checksum was edited or rebuilt.

The adapter was `memorySink()`. Its capture callback explicitly asserted
`{ ...target, durability: 'durable' }` for the test host. This is an adapter
acknowledgement of the JSON history, not file persistence, fsync, producer
authentication or an independent durability audit. The native capture remains
`persistence: 'memory-only'`.

Keep this historical packet unchanged: it retains the genuine absence of
attempt witnesses. The separate live-producer test permits newer producer
labels while requiring the same explicit unknown result with no cause graph.
Both use the real public stored-capture reader; neither authorizes source
ownership from fields in the packet.

## Agentfootprint 14.3.1 run recording

`recording-14.3.1.json.gz` is the gzip-compressed output of
`JSON.stringify(recordRun(agent).toRecording())` on Node 24.21.0. A scripted,
offline mock asked the fictional `lookup_widget` tool to look up
`WIDGET-FIXTURE`. The tool returned an inventory count of 17 and the next mock
reply ended the run. The capture preserves the complete serialized bundle.

The installed producer and engine files used for the capture matched their
registry archives member by member. The cohort was Agentfootprint 14.3.1,
FootPrint 11.1.0, Foottrace 1.11.1, ContextFootprint 0.1.1, and Zod 3.25.76.
Archive and fixture digests are in [the capture provenance](recording-14.3.1.provenance.json).

The replay test opens the original bytes through `agentfootprint/observe` and
checks the saved tool call and its committed result.
