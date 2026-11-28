---
type: breaking
---
**Result hooks suppress typed tool proposals.** If an after-tool hook runs, transition and instruction proposals from that occurrence are withheld from the graph and lease owners. This applies to pass-through, rewritten and denied results in batch and resume. Content still follows the result hook decision. An external operation already performed by the tool has its own outcome.

Migration: Review tools that rely on typed proposals while an after-tool hook is installed. A raw result envelope or immutable inner content does not authorize a proposal through a result hook. Preserve the hook where it is required and express any required transition or instruction through the application's graph or instruction configuration instead. Calls without a result hook retain the existing proposal handling.
