[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / STAGED\_INPUTS\_ENV

# Variable: STAGED\_INPUTS\_ENV

> `const` **STAGED\_INPUTS\_ENV**: `"AF_STAGED_INPUTS"` = `'AF_STAGED_INPUTS'`

Defined in: [src/adapters/types.ts:905](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L905)

The environment variable an executing snippet reads its staged inputs from —
a JSON object mapping each input's NAME to the path it landed at.

Part of [CodeSession.stageInputs](/agentfootprint/api/generated/interfaces/CodeSession.md#stageinputs)'s contract rather than one adapter's
convention, and named here so an adapter uses the constant instead of
retyping the string. It is what makes model-written code portable across
backends: the code reads one variable, and every adapter that stages inputs
fills it the same way.
