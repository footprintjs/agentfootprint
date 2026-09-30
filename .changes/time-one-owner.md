---
type: fixed
---
**A period argument naming a day that does not exist is refused, not rolled forward.** A tool
that declares `period: { spelling: 'iso-range' }` used to accept a declared value such as
`2026-02-30T08:00Z..2026-03-01T08:00Z` or one at hour `24`, because the check leaned on
`Date.parse`, which quietly reads 30 February as 2 March and hour 24 as the next midnight — so a
tool could be sent an instant nobody asked for. Both are now refused at definition (and at MCP
ingest), naming the value. Nothing else about the spellings changed: lower-case `t`/`z` and the
leap second stay refused for an argument, a look-back keeps any number of digits (`1000000m`),
and `30s` is still not a look-back. Underneath, every time grammar in the library — instants,
durations, zones and ranges — now has one owner, so a result's declared period and a tool's
argument can no longer disagree about what an instant is.
