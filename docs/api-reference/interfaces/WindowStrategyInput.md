[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategyInput

# Interface: WindowStrategyInput

Defined in: [src/core/agent/window/strategy.ts:62](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L62)

Everything a strategy is allowed to look at.

## Properties

### agentModel

> `readonly` **agentModel**: `string`

Defined in: [src/core/agent/window/strategy.ts:91](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L91)

The agent's own model — the sensible default for a strategy that bills.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/strategy.ts:64](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L64)

The window as it stands, detached.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/strategy.ts:79](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L79)

The ReAct iteration this decision belongs to.

***

### measured

> `readonly` **measured**: \{ `input`: `number`; `output`: `number`; \} \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:77](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L77)

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

Defined in: [src/core/agent/window/strategy.ts:97](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L97)

Wall clock, injectable so a caller can pin `survivalMs`.

#### Returns

`number`

***

### planRemoval

> `readonly` **planRemoval**: (`keepRecentTurns`, `isExistingSummary?`) => [`RemovalPlan`](/agentfootprint/api/generated/interfaces/RemovalPlan.md)

Defined in: [src/core/agent/window/strategy.ts:112](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L112)

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

Defined in: [src/core/agent/window/strategy.ts:93](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L93)

`provider.name` of the MAIN provider, for a refusal that names it.

***

### removalFacts

> `readonly` **removalFacts**: (`indices`, `atMs`) => [`RemovalFacts`](/agentfootprint/api/generated/interfaces/RemovalFacts.md)

Defined in: [src/core/agent/window/strategy.ts:123](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L123)

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

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/window/strategy.ts:89](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L89)

The run this decision belongs to.

A strategy that retains what it removed has to name the run whose commit
log held it — that is the honest answer to "where else could I have found
this?", and the answer is "nowhere, once that process ended", which is the
whole reason retention exists. `'unknown'` when the runtime could not name
the run, never a fabricated id.

***

### signal

> `readonly` **signal**: `AbortSignal` \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:95](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L95)

The run's cancellation signal, when there is one.

***

### turns

> `readonly` **turns**: readonly [`Turn`](/agentfootprint/api/generated/interfaces/Turn.md)[]

Defined in: [src/core/agent/window/strategy.ts:66](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/strategy.ts#L66)

The same window, segmented into turns.
