---
title: ABSENCE_NOTE
---

# Variable: ABSENCE\_NOTE

> `const` **ABSENCE\_NOTE**: `` "The search ran and matched nothing. This is an ANSWER, not an error: nothing failed, nothing was substituted for what was asked, and calling this tool again with the same arguments returns this same result. `checked` is the ground this answer covers; anything under `not_checked` or `cannot_cover` is ground it does NOT cover, and reaching that needs a different question, not a retry." `` = `` 'The search ran and matched nothing. This is an ANSWER, not an error: nothing failed, nothing was substituted for what was asked, and calling this tool again with the same arguments returns this same result. `checked` is the ground this answer covers; anything under `not_checked` or `cannot_cover` is ground it does NOT cover, and reaching that needs a different question, not a retry.' ``

Defined in: [src/core/agent/coverage/absent.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/absent.ts#L84)

The static sentence every absence carries. Says the three things the field
implementation proved a model needs: that the call SUCCEEDED, that nothing
was substituted, and that a retry is futile. The third clause is the one
that ends the loop.
