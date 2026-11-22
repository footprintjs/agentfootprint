---
type: fixed
---
**Findings and evidence recovery can continue after a signed tool call.** AgentFootprint preserves the findings context that preceded each signed response, including when resuming the same request after a transport error. Revisions append feedback while keeping the signed prefix stable. A revision governed by an enforcing answer check uses witnessed completion to withdraw the tools.
