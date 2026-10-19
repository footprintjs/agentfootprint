# Flaky test records

No unresolved flaky tests are currently recorded.

The turn-artifact hand-over timing race was fixed in
[PR #174](https://github.com/footprintjs/agentfootprint/pull/174).
The tests wait for operation signals instead of a fixed delay; no test was
skipped or quarantined. Any new failure still needs its own diagnosis.
