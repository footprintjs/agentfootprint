---
type: changed
---
**`.time()` works without a known zone, and the model is told the date on every request.**
An agent with `.time()` but no zone (no `run({ time: { zone } })` and no `.time({ zone })`) used to refuse every run, so an app deployed without its zone setting could not arm the time layer at all. It now runs with the zone recorded as unknown (`zoneSource: 'unknown'`) — never the server's zone, never a guess: instants are spelled in UTC and say so, the person is asked "Which time zone are you in?" before any time they wrote is read, and the zone they answer holds for the next turns (`zoneSource: 'answered'`). A tool's `ctx.time` carries `zoneUnknown: true` while it is unknown. Apps that pass a zone are unchanged.
Under `.time()`, every request now ends with the library's time line opening with the turn's clock — "This turn's time: Friday 2026-10-09 08:40 America/Los_Angeles (UTC-07:00)." — so apps no longer need their own clock block. About 19 tokens for the sentence; 73 on a request whose line says nothing else.
