---
title: STAGED_INPUTS_ENV
---

# Variable: STAGED\_INPUTS\_ENV

> `const` **STAGED\_INPUTS\_ENV**: `"AF_STAGED_INPUTS"` = `'AF_STAGED_INPUTS'`

Defined in: [src/adapters/types.ts:905](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L905)

The environment variable an executing snippet reads its staged inputs from —
a JSON object mapping each input's NAME to the path it landed at.

Part of [CodeSession.stageInputs](/docs/api/interfaces/CodeSession#stageinputs)'s contract rather than one adapter's
convention, and named here so an adapter uses the constant instead of
retyping the string. It is what makes model-written code portable across
backends: the code reads one variable, and every adapter that stages inputs
fills it the same way.
