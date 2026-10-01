---
type: fixed
---
**A look-back exactly as long as a tool's `maxRange` is no longer refused.** A tool declaring
`maxRange: '24h'` refused the window "last 24 hours" — whether the person said it or the model
sent `window: '24h'` — as `over-max-range`: the look-back holds now as its last instant, and that
inclusive end was counted as one millisecond of extra reach. `maxRange` is now judged by how far a
window reaches from its first instant to its last (`periodFactProblem`, `convertForTool` and the
covering look-back all ask the same rule), so a look-back exactly `maxRange` long is read, the same
instants written as bounds get the same verdict, and one step more (`1441m`) is still refused.
