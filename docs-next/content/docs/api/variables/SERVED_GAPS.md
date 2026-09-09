---
title: SERVED_GAPS
---

# Variable: SERVED\_GAPS

> `const` **SERVED\_GAPS**: `Readonly`\<`Record`\<[`ServedGapKind`](/docs/api/type-aliases/ServedGapKind), `Omit`\<[`ServedGap`](/docs/api/interfaces/ServedGap), `"gap"`\>\>\>

Defined in: [src/lib/time-travel/servedView.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L326)

The gap catalogue. Exported because a reader that renders a served view
renders its gaps beside it, and a renderer should print the library's own
sentence rather than invent one.
