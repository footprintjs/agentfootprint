[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToSSEOptions

# Interface: ToSSEOptions

Defined in: [agentfootprint/src/stream.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L36)

Hand the runner this iterable's caller before calling `runner.run()`.
Yields SSE-formatted strings until the run finishes (success, error,
or pause). Each event becomes:

  event: <event name>
  data: <JSON payload>
  <blank line>

## Example

```ts
// Express
  app.post('/agent', async (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    for await (const chunk of toSSE(agent)) {
      res.write(chunk);
    }
    res.end();
    // (in parallel: await agent.run(req.body))
  });
```

## Properties

### eventName?

> `readonly` `optional` **eventName?**: (`event`) => `string`

Defined in: [agentfootprint/src/stream.ts:55](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L55)

Custom event name extractor. By default `event.type` is used.
Useful for SSE consumers that want their own naming.

#### Parameters

##### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

#### Returns

`string`

***

### filter?

> `readonly` `optional` **filter?**: (`event`) => `boolean`

Defined in: [agentfootprint/src/stream.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L42)

Filter predicate — return false to skip an event. Default: all events.
Common: `event => event.type.startsWith('agentfootprint.stream.')`
for a token-only feed.

#### Parameters

##### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

#### Returns

`boolean`

***

### format?

> `readonly` `optional` **format?**: `"full"` \| `"text"`

Defined in: [agentfootprint/src/stream.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L50)

Output shape:
  - 'full' (default) — each event is JSON-serialized verbatim.
  - 'text' — only `agentfootprint.stream.token.content` is yielded,
    in plain text form (no event/data prefix). Useful for piping
    directly into a chat UI.

***

### heartbeatMs?

> `readonly` `optional` **heartbeatMs?**: `number`

Defined in: [agentfootprint/src/stream.ts:61](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L61)

Heartbeat interval in ms. SSE connections through proxies/load
balancers often die after ~30s of silence; emit `: ping` comments
at this interval. Default 0 (disabled).
