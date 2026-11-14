---
type: internal
---
**Restore the contributor documentation and guards before the unreviewed guide change.**
Reverse the documentation-only commit so that any guide cleanup can return through
an ordinary reviewed pull request. Runtime code and package versions are unchanged.
Keep the existing Proxy checkpoint test deterministic by controlling its clock,
while still asserting both the complete checkpoint and its fresh timestamp.
