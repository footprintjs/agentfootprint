[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / codeShape

# Function: codeShape()

> **codeShape**(`code`): `string`

Defined in: [src/core/codeRunnerTool.ts:198](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/codeRunnerTool.ts#L198)

A program reduced to its CALL SHAPE: which operations, in what order.

Strings, numbers, comments and identifier names are what make two runs of the
same computation look different, and they are also the half that quotes the
data — so removing them is both what makes the hash group correctly and what
makes it safe to emit. `groupBy(rows, 'wwn')` and `groupBy(items, 'serial')`
reduce to one shape; a totals-then-threshold written eleven times this month
hashes to one value eleven times, which is the signal worth having.

**The callee names are KEPT, and that is the point.** The operation IS the
signal. The first version of this erased them too, which made `groupBy` and
`sortBy` one shape and collapsed the whole backlog into a single meaningless
bucket — caught by a clean-room probe on the published package, and missed by
a test whose two examples happened to differ elsewhere as well. A function
name is code, not data; the data lives in the literals and the variable
names, and those are what go.

Deliberately crude — a lexical reduction, not a parse. It has to work on
whatever language the runner was configured for, and a wrong parse would be a
worse answer than a coarse one.

## Parameters

### code

`string`

## Returns

`string`
