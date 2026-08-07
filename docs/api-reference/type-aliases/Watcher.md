[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Watcher

# Type Alias: Watcher

> **Watcher** = [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

Defined in: [src/core/agent/watch.ts:61](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/agent/watch.ts#L61)

Anything that can watch a run.

The plain name for footprintjs's `CombinedRecorder` — the substrate's word
for the same thing, still exported from the main barrel for anyone typing
against the engine directly. Every recorder factory in
`agentfootprint/observe` returns something assignable to this, as does any
object with the recorder hook methods on it.

## Example

```ts
import { Agent, type Watcher } from 'agentfootprint';
import { toolChoiceRecorder, routeRecorder } from 'agentfootprint/observe';

const observers: Watcher[] = [toolChoiceRecorder(), routeRecorder()];

const agent = Agent.create({ provider, model })
  .watch(...observers)
  .build();
```
