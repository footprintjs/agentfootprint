[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategyInput

# Interface: WindowStrategyInput

Defined in: [src/core/agent/window/strategy.ts:62](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L62)

Everything a strategy is allowed to look at.

## Properties

### agentModel

> `readonly` **agentModel**: `string`

Defined in: [src/core/agent/window/strategy.ts:81](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L81)

The agent's own model — the sensible default for a strategy that bills.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/strategy.ts:64](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L64)

The window as it stands, detached.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/strategy.ts:79](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L79)

The ReAct iteration this decision belongs to.

***

### measured

> `readonly` **measured**: \{ `input`: `number`; `output`: `number`; \} \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:77](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L77)

What the provider REPORTED for the last completed call. Counted, never
guessed. `undefined` before the first call of the run — a strategy that
acted on that would be guessing, which is the one thing this family
refuses to do.

`{ input: 0, output: 0 }` is a provider that reported NOTHING, not a call
that cost nothing. A token-triggered strategy should throw
`CompactionUnmeasurableError` there rather than invent a size.

***

### now

> `readonly` **now**: () => `number`

Defined in: [src/core/agent/window/strategy.ts:87](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L87)

Wall clock, injectable so a caller can pin `survivalMs`.

#### Returns

`number`

***

### planRemoval

> `readonly` **planRemoval**: (`keepRecentTurns`, `isExistingSummary?`) => [`RemovalPlan`](/agentfootprint/api/generated/interfaces/RemovalPlan.md)

Defined in: [src/core/agent/window/strategy.ts:102](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L102)

THE shared refusal engine, bound to this iteration.

Answers: which contiguous span of turns may leave, and every turn that
refused, named. Never removes the system envelope, the last
`keepRecentTurns` turns, an unanswered tool call, the paused tool, or a
pending check-in.

#### Parameters

##### keepRecentTurns

`number`

how many trailing turns are off-limits

##### isExistingSummary?

(`turn`) => `boolean`

optional predicate marking a turn that is a
  summary a previous fold wrote; when the whole span is one of those, the
  plan refuses with `only-existing-summary`. Pass it only if your strategy
  spends an LLM call — a drop has nothing to protect against.

#### Returns

[`RemovalPlan`](/agentfootprint/api/generated/interfaces/RemovalPlan.md)

***

### providerName

> `readonly` **providerName**: `string`

Defined in: [src/core/agent/window/strategy.ts:83](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L83)

`provider.name` of the MAIN provider, for a refusal that names it.

***

### removalFacts

> `readonly` **removalFacts**: (`indices`, `atMs`) => [`RemovalFacts`](/agentfootprint/api/generated/interfaces/RemovalFacts.md)

Defined in: [src/core/agent/window/strategy.ts:113](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L113)

Turn removed message indices into the facts the ledger needs: which
stages wrote them, and how long each lived in the window.

#### Parameters

##### indices

readonly `number`[]

indices in the PRE-change window that are leaving

##### atMs

`number`

the moment they leave (usually `input.now()`)

#### Returns

[`RemovalFacts`](/agentfootprint/api/generated/interfaces/RemovalFacts.md)

***

### signal

> `readonly` **signal**: `AbortSignal` \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:85](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L85)

The run's cancellation signal, when there is one.

***

### turns

> `readonly` **turns**: readonly [`Turn`](/agentfootprint/api/generated/interfaces/Turn.md)[]

Defined in: [src/core/agent/window/strategy.ts:66](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/core/agent/window/strategy.ts#L66)

The same window, segmented into turns.
