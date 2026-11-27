---
type: security
---
**Apply skill-tool role visibility to the catalog and dispatch in both strategies.** The composed tool list omits tools owned only by skills hidden from the current role. Direct, resumed, and inner calls to those tools receive the unknown-tool response and do not run. Resume checks the current role again. A visible owner keeps its shared implementation available. Classic mode can retain the first tool list after a role change; dispatch still applies the role check.
