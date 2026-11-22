---
type: added
---
**Watch provider thinking as it streams.** Agent stream subscribers receive Anthropic's requested summaries and structured reasoning from Ollama as they arrive. Live deltas carry `provider-summary`, `raw-reasoning`, or `unclassified`, so apps can choose what to display. The run's redaction policy applies to the served event.
