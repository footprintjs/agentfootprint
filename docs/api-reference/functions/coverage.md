[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / coverage

# Function: coverage()

> **coverage**\<`T`\>(`content`, `decl`): [`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`T`\>

Defined in: [src/core/agent/coverage/ledger.ts:81](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/coverage/ledger.ts#L81)

Return a verdict with its own boundary attached.

The model reads `{ af_coverage: {…}, result: <your value> }` — boundary
first, deliberately: a limit placed after a long result is a limit that gets
skimmed past. The framework records the ledger and, with
`.limitsTravelWithTheAnswer()` configured, appends it to the run's final
answer where the model cannot drop it.

## Type Parameters

### T

`T`

## Parameters

### content

`T`

### decl

[`CoverageDeclaration`](/agentfootprint/api/generated/interfaces/CoverageDeclaration.md)

## Returns

[`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`T`\>

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
