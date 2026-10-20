# Flaky test records

No unresolved flaky tests are currently recorded.

The turn-artifact hand-over timing race was fixed in
[PR #174](https://github.com/footprintjs/agentfootprint/pull/174).
The tests wait for operation signals instead of a fixed delay; no test was
skipped or quarantined. Any new failure still needs its own diagnosis.

## MemoryBank default request limits — controlled clock (2026-10-19)

- Test: `test/memory/store-pagination-conformance.test.ts` → `MemoryStore
  conformance: caller request bounds` → `MemoryBankStore (fake retrieve API
  capped at 100)` → `preserves omitted and explicit-undefined defaults and
  search availability`.
- Evidence: [FootPrint's merged-commit consumer audit, first attempt](https://github.com/footprintjs/footPrint/actions/runs/39341778393/attempts/1).
  Two equivalent reads returned identical entries except for `lastAccessedAt`,
  which advanced by 2 ms. The same candidate passed the next audit; that retry
  was diagnostic evidence, not the fix.
- Fixed: freeze `Date.now()` only while comparing default requests, restoring it
  even when fixture cleanup fails. All entry, cursor and search assertions stay
  intact. An advancing-clock regression reproduces the old failure without any
  pause, and a fixture-failure check covers clock restoration.
- No product change, added delay, retry, skip or quarantine.
