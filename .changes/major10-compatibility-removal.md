---
type: breaking
---

**Remove expired compatibility surfaces; require Node.js 22 or newer.**
The Node floor now matches the required Foottrace and FootPrint packages;
CI verifies Node 22 and 24.

Migration: update to Node.js 22 or newer, then replace the retired calls,
options and import paths as follows:

- The `AgentBuilder.recorder()` grace stub is gone. Use `.watch(...observers)`.
- `RefreshPolicy` and `defineSkill({ refreshPolicy })` are removed. This
  option never refreshed anything. Use skill `steps` for procedure position,
  or `surfaceMode: 'both'` to return the body on an explicit `read_skill` call.
- The special `viaToolName` removal guards are gone. Skill factory and directory
  options are checked against their current declared keys by one shared validator.
  Unknown options (including inherited declarations) fail without reading or
  printing their values. Unknown SKILL.md frontmatter remains tolerated.
- The budget recorder no longer adapts 8.x `capTokens/projectedTokens`.
  Slot builders must write `cap/projected` (numbers), with `unit` when needed.
  Legacy-only records emit no budget-pressure event, as promised in 9.x.
- `agentfootprint/reliability` now exports only the gate's distinct
  `CircuitOpenError`. Import the other fifteen reliability helpers and types
  from `agentfootprint/resilience`; their implementations are unchanged.

The active `scopeTools` default remains false. The earlier documentation
promising an automatic 10.0.0 flip is corrected: API retirement does not
change tool-visibility policy. Saved record formats and supported live
execution remain unchanged.
