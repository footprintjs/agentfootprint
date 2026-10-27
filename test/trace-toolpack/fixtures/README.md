# Saved v2 compatibility packet

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
