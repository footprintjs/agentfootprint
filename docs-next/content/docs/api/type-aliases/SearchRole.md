---
title: SearchRole
---

# Type Alias: SearchRole

> **SearchRole** = `"population"` \| `"filter"` \| `"period"` \| `"source"` \| `"cap"` \| `"page"` \| `"inert"`

Defined in: [src/semantics/coverage/search/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L24)

What one input argument DOES to the ground a call covers — a closed set.

  • `population` — which rows: one facet per value sent (a list gives one per item);
  • `filter`     — narrows the rows;
  • `period`     — the time read (the argument `Tool.period` names);
  • `source`     — picks the store: a sent value REPLACES the declared source;
  • `cap`        — at most this many rows;
  • `page`       — which page of the rows;
  • `inert`      — changes the bytes, not the ground (a format, a sort).
