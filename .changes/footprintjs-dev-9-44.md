---
type: internal
---
**agentfootprint's own suite runs on footprintjs 9.44.0.** The dev pin and the lockfile move
from 9.41.0 to 9.44.0 (9.42.0's redaction law and removed shims, 9.44.0's lean pause
checkpoint). The peer range stays `^9.41.0`: nothing in the library relies on 9.42–9.44
behaviour. No source change was needed, and no byte-identity reference was regenerated — the
suite is green on 9.44.0 as it stood. Two hand-built `FlowchartCheckpoint` literals in a
type-regression fixture drop `executionTree`, which footprintjs 9.44.0's checkpoint format 2 no
longer has, and the API reference regenerates the 18 re-exported footprintjs pages whose docs
changed.
