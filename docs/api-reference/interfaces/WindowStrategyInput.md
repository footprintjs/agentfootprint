[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategyInput

# Interface: WindowStrategyInput

Defined in: [src/core/agent/window/strategy.ts:66](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L66)

Everything a strategy is allowed to look at.

## Properties

### agentModel

> `readonly` **agentModel**: `string`

Defined in: [src/core/agent/window/strategy.ts:95](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L95)

The agent's own model — the sensible default for a strategy that bills.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/strategy.ts:68](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L68)

The window as it stands, detached.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/strategy.ts:83](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L83)

The ReAct iteration this decision belongs to.

***

### measured

> `readonly` **measured**: \{ `input`: `number`; `output`: `number`; \} \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:81](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L81)

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

Defined in: [src/core/agent/window/strategy.ts:101](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L101)

Wall clock, injectable so a caller can pin `survivalMs`.

#### Returns

`number`

***

### planRemoval

> `readonly` **planRemoval**: (`keepRecentTurns`, `isExistingSummary?`) => [`RemovalPlan`](/agentfootprint/api/generated/interfaces/RemovalPlan.md)

Defined in: [src/core/agent/window/strategy.ts:116](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L116)

THE shared refusal engine, bound to this iteration.

Answers: which contiguous span of turns may leave, and every turn that
refused, named. Never removes the system envelope, the CURRENT REQUEST,
the last `keepRecentTurns` turns, an unanswered tool call, the paused
tool, or a pending check-in.

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

Defined in: [src/core/agent/window/strategy.ts:97](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L97)

`provider.name` of the MAIN provider, for a refusal that names it.

***

### removalFacts

> `readonly` **removalFacts**: (`indices`, `atMs`) => [`RemovalFacts`](/agentfootprint/api/generated/interfaces/RemovalFacts.md)

Defined in: [src/core/agent/window/strategy.ts:127](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L127)

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

Defined in: [src/core/agent/window/strategy.ts:93](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L93)

The run this decision belongs to.

A strategy that retains what it removed has to name the run whose commit
log held it — that is the honest answer to "where else could I have found
this?", and the answer is "nowhere, once that process ended", which is the
whole reason retention exists. `'unknown'` when the runtime could not name
the run, never a fabricated id.

***

### signal

> `readonly` **signal**: `AbortSignal` \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:99](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L99)

The run's cancellation signal, when there is one.

***

### standingOf?

> `readonly` `optional` **standingOf?**: (`turn`) => [`Standing`](/agentfootprint/api/generated/type-aliases/Standing.md) \| `undefined`

Defined in: [src/core/agent/window/strategy.ts:152](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L152)

What the model DECLARED a turn's results to be, on its findings ledger
(9.102.0) — `fact`, `open`, `noise`, `ruled-out`, or `undefined` when it
said nothing (undeclared; never defaulted to `'open'`). A Turn is the
removal unit, so a turn's standing is its most valuable result's
(`fact > open > undeclared > ruled-out > noise`, the
`ledgerFactPins.ts · turnStandingOf` rule); a turn with no tool result
has none. A message the batch settlement wrote for a call that never ran
(9.113.0, `LLMMessage.notDispatched`) is no result and takes no part.

BOUND BY THE STAGE, like `planRemoval` and `removalFacts`: the stage is
the one place that reads scope, and it resolves the ledger ONCE per visit
and hands the answer in. A strategy never reads scope for it — that is
the strategies/README one law, and it is what keeps a consumer-written
strategy honest by construction.

OPTIONAL, and absent on an agent without `.findings()`: an unarmed agent
has no ledger to ask, and a strategy compiled before this field existed
keeps compiling. A strategy does not NEED it to get 'facts last' — the
hold lives in the refusal engine (`'ledger-fact'`) and arrives through
`planRemoval` under every strategy; this is for one that wants to ORDER
or REPORT among the turns the engine left removable. Never infer a
standing from a result's text: absent here means the model said nothing.

#### Parameters

##### turn

[`Turn`](/agentfootprint/api/generated/interfaces/Turn.md)

#### Returns

[`Standing`](/agentfootprint/api/generated/type-aliases/Standing.md) \| `undefined`

***

### turns

> `readonly` **turns**: readonly [`Turn`](/agentfootprint/api/generated/interfaces/Turn.md)[]

Defined in: [src/core/agent/window/strategy.ts:70](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L70)

The same window, segmented into turns.
