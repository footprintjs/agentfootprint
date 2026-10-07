---
title: codeShape
---

# Function: codeShape()

> **codeShape**(`code`): `string`

Defined in: [src/core/codeRunnerTool.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L207)

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

The code is model output, so every pass is linear in it. Block comments and
string literals are scanned rather than matched: the regexes that used to
find them re-read the rest of the code from every unclosed comment opener or
quote — quadratic on openers repeated with text between them, or on a quote
followed by a long run of escaped quotes (16,000 of them took about half a
second). The scans produce exactly what those regexes did
(`test/security/linear-scanners.test.ts`).

## Parameters

### code

`string`

## Returns

`string`
