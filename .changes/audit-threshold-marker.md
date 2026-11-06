---
type: fixed
---
**The bounded audit chain keeps footprintjs's masked-threshold marker.** Under a redaction policy, footprintjs can mask a decision's threshold and mark it with `thresholdRedacted: true`. The audit chain now keeps that marker, so a reader can tell a masked threshold from a real one. Nothing changes without a policy.
