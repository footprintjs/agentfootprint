[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunbookProcedure

# Type Alias: RunbookProcedure

> **RunbookProcedure** = (`tools`) => `FlowChart`

Defined in: [src/core/runbook/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/types.ts#L42)

The procedure: a factory invoked PER CALL with the run's own tool dispatch
(`ctx.tools`), returning a FRESH chart whose stages close over it.

Per call for two reasons that are really one: a chart shared between two
runs is a chart whose closures belong to whichever run built it last, and
the dispatch only exists at execute time — so the factory is both the
fresh-chart law and the delivery mechanism.

It is ALSO invoked once at definition time, with a probe dispatch whose
`has` answers false and whose `call` refuses — to read the chart's declared
contract (input schema, the named decider's branches). Stage bodies do not
run at build, so a well-formed factory pays nothing; a factory with side
effects at build time is a factory that lies about being a declaration.

## Parameters

### tools

[`ToolDispatch`](/agentfootprint/api/generated/interfaces/ToolDispatch.md)

## Returns

`FlowChart`
