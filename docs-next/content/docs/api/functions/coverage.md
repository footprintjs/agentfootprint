---
title: coverage
---

# Function: coverage()

> **coverage**\<`T`\>(`content`, `decl`): [`CoveredResult`](/docs/api/interfaces/CoveredResult)\<`T`\>

Defined in: [src/core/agent/coverage/ledger.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/ledger.ts#L128)

Return a verdict with its own boundary attached.

The model reads `{ af_coverage: {…}, result: <your value> }` — boundary
first, deliberately: a limit placed after a long result is a limit that gets
skimmed past. The framework records the ledger and, with
`.limitsTravelWithTheAnswer()` configured, appends it to the run's final
answer where the model cannot drop it.

`period` (honesty step 7b) says what time the read behind the value
covered — `{ queried, held, readAt? }`, ISO 8601 instants with a zone; it is
a boundary on its own, served inside `af_coverage` before `result`, and the
results layer judges it. `coverage()` takes no `provenance`.

`inProgress` says what the read found still RUNNING — its outcome not known
yet (a backup in progress, a replication session still synchronizing). The
tool decides what is in flight; this library never reads a vendor's state
name. Served as `in_progress` (the dispatch door adds one static clause after
the note), recorded, and printed under `.limitsTravelWithTheAnswer()`; it
never changes the answer's standing (`inProgress.ts`). It needs `checked`
beside it — an item in progress is ground the call read.

Refuses (throws, where it is called) a boundary that declares nothing, a
malformed item or period, and any key the boundary does not have — naming the
spelling meant when the key is a casing slip (`not_checked` →
`notChecked`), so a list declared from plain JavaScript or JSON cannot
vanish without a word. Every refusal starts `refused: `: inside `execute`
it becomes the call's error result, which the model reads.

## Type Parameters

### T

`T`

## Parameters

### content

`T`

### decl

[`CoverageDeclaration`](/docs/api/interfaces/CoverageDeclaration) & `object`

## Returns

[`CoveredResult`](/docs/api/interfaces/CoveredResult)\<`T`\>

## Example

```ts
the highest-stakes tool in a triage agent
  defineTool({
    name: 'replication_health',
    description: 'Replication health across the estate',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const { verdict, ndmTimedOut } = await checkReplication();
      return coverage(verdict, {
        checked: ['SRDF pair state on all 4 arrays (live query)'],
        notChecked: ndmTimedOut
          ? [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }]
          : [],
        cannotCover: [
          { what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' },
        ],
      });
    },
  });
```
