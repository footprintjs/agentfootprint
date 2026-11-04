**Map** — tool session contracts and injective identity-key projections.

# Tool session owners

The canonical toolSessions.ts facade owns the stateful session tier, registrations, borrows and cleanup.

- contracts.ts owns teardown contracts and primitive defaults.
- keys.ts owns partition keys and their digest, including the one lazy crypto cache.
- localStatus.ts reports matching native-owner or session-partition registrations only. A tier-wide shutdown row proves no association with the restored owner and does not count; its dedup and lifetime stay unchanged. No status proves remote liveness or closure.

Public names remain exported by the canonical facade. Neither leaf imports that facade at runtime. No live handle or cache value crosses a checkpoint.
