---
type: fixed
---
**The `footprintjs` peer range now says what agentfootprint needs: `^10.6.0`.** It read `^9.47.0 || ^10.0.0`, and that was already untrue: agentfootprint needs footprintjs 10.6.0. On footprintjs 9.47.0, 10.0.0, 10.1.0, 10.4.0 and 10.5.0, its own code fails to typecheck. The saved-history cause tools read `footprintjs/trace` names those releases do not have: `readStoredCapture`, `StoredCaptureHistory.readSources` and `EngineReadSources.ownership`. Between 23 and 103 of its tests fail there. On 10.6.0 it typechecks and its tests pass. If your install resolved an older footprintjs, upgrade it to 10.6.0 or later. MCP retries also run on footprintjs's `attempt()`, which arrived in 10.1.0.
