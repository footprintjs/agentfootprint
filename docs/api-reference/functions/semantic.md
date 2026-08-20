[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semantic

# Function: semantic()

> **semantic**(`decl`): [`ToolSemantics`](/agentfootprint/api/generated/interfaces/ToolSemantics.md)

Defined in: [src/lib/semantics/envelope.ts:661](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/envelope.ts#L661)

Say "here is typed data, with the caveats that make it honest" in a shape
the framework recognizes, the record keeps whole, and a build gate can
refuse.

Returns the value a tool's `execute` should return. The framework
recognizes it at the dispatch boundary: the MODEL reads the compact
projection ([semanticsForModel](/agentfootprint/api/generated/functions/semanticsForModel.md)), the FULL envelope rides the typed
`agentfootprint.tools.semantics_declared` event, and a declared `coverage`
flows through the same channel `coverage()` uses.

Refuses (throws, at the call site — the `absent()` law) any declaration
this vocabulary cannot honor: series without grain, data without
provenance, a counter-looking aggregation with `is_counter` unstated, and
every malformed shape — each refusal names the field and the fix.

## Parameters

### decl

[`SemanticDeclaration`](/agentfootprint/api/generated/interfaces/SemanticDeclaration.md)

## Returns

[`ToolSemantics`](/agentfootprint/api/generated/interfaces/ToolSemantics.md)

## Example

```ts
a per-port IOPS tool
  return semantic({
    series: rows.map((r) => ({ t: r.time, entity: r.port, metric: 'avg_iops', value: r.iops })),
    grain: { interval: '30m', aggregation: 'avg', is_counter: false },
    provenance: { measured_at: latestSampleTime, source: 'InfluxDB SwitchPortStats' },
    coverage: {
      checked: ['shq-fab-a: all 48 FC ports'],
      notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
    },
    render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
  });
```
