---
type: added
---
**A host can read which optional field is a time range's correction box.** `timeReplyPairs(request)` on `agentfootprint/time` returns the `{ range, correction }` pairs an ask declares, so a one-click confirm can treat the sibling as not asked without reading a reserved context key. It takes the ask as the run returned it or as JSON off a wire, and the door imports nothing from Node. A stamped binding that does not match its fields throws a `TypeError`, because returning no pairs would say the ask has none.

The unknown-zone question now reads "Which time zone should I use for “yesterday”?" (`ask.zone-unknown`). The old "should be shown" was false for calendar words, where the answer moves the query: "yesterday 8 AM to 9 AM" is 15:00–16:00Z in Los Angeles and 23:00–00:00Z in Tokyo. A test or an app that matches the old text needs the new one.

Correction: the 14.0.0 notes did not say that since that release the dispatcher refuses a run id it never opened. An event with a made-up `runId` arrives with its payload redacted, whatever the agent's policy. Let a real run stamp its own id, or name none.
