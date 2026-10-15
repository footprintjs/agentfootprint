---
type: internal
---
**The injection engine moves from `src/lib/injection-engine/` to `src/injection-engine/`.** It keeps its layer (L8, below the agent), and the root barrel `src/injection-engine.ts` re-exports it as before. The files moved with `git mv` and only import paths changed. `agentfootprint/context` exports the same names. The two `sideEffects` entries now read `**/injection-engine/index.js` and `**/injection-engine/devWarnHost.js`, and they still flag the same two built files.
