[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / absent

# Function: absent()

> **absent**(`decl`): [`ToolAbsence`](/agentfootprint/api/generated/interfaces/ToolAbsence.md)

Defined in: [src/core/agent/coverage/absent.ts:100](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/coverage/absent.ts#L100)

Say "I looked, and there is nothing" in a way a model cannot read as a
failure — and cannot productively retry.

Returns the value a tool's `execute` should return. The framework
recognizes it at the dispatch boundary and gives it a delivered status of
`'absent'` (routable by `onToolStatus`), a `tools.absent` event, and an
evidence-corpus rule of its own.

## Parameters

### decl

[`AbsenceDeclaration`](/agentfootprint/api/generated/interfaces/AbsenceDeclaration.md)

## Returns

[`ToolAbsence`](/agentfootprint/api/generated/interfaces/ToolAbsence.md)

## Example

```ts
a port-lookup tool that found no matching FLOGI
  defineTool({
    name: 'flogi_for_port',
    description: 'FLOGI entries for one interface',
    inputSchema: { type: 'object', properties: { switch: { type: 'string' },
      port: { type: 'string' } }, required: ['switch', 'port'] },
    execute: ({ switch: sw, port }) => {
      const rows = fcns.flogi(sw, port);
      if (rows.length > 0) return rows;
      return absent({
        what: `FLOGI entries on ${port}`,
        checked: [
          `${sw}: the live fcns database`,
          { what: 'window: the last 24h', why: 'FLOGI history retention on this fabric' },
        ],
        notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
        cannotCover: [{ what: 'ports on the peer fabric',
          why: 'this collector is scoped to one fabric' }],
        tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
      });
    },
  });
```
