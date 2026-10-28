---
type: fixed
---
**The `footprintjs` peer range now says what agentfootprint needs: `^10.6.0`.** It read `^9.47.0 || ^10.0.0`, and that was already untrue: agentfootprint's saved-history cause tools (`src/trace-toolpack/storedCause*.ts`) use footprintjs APIs that older releases do not have, so on them its own code does not typecheck and its tests fail. Measured on agentfootprint 11.1.0's tree, per footprintjs release:

- **9.47.0, 10.0.0, 10.1.0** — `footprintjs/trace` has no `readStoredCapture` and no `StoredCaptureHistory` (6 type errors; 102–103 tests fail).
- **10.4.0** — `StoredCaptureHistory` has no `readSources` (4 type errors; 24 tests fail).
- **10.5.0** — `EngineReadSources` has no `ownership`, and its source envelope is still version 1 (8 type errors; 23 tests fail).
- **10.6.0** — every API is there: no type error, no failing test.

If your install resolved an older footprintjs, upgrade it to 10.6.0 or later. (MCP retries also run on footprintjs's `attempt()`, which arrived in 10.1.0.)
