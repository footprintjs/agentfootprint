---
title: DebateOptions
---

# Interface: DebateOptions

Defined in: src/patterns/Debate.ts:21

## Properties

### criticPrompt

> `readonly` **criticPrompt**: `string`

Defined in: src/patterns/Debate.ts:27

Critic persona — argues against the proposer's position.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/patterns/Debate.ts:35

***

### judgePrompt

> `readonly` **judgePrompt**: `string`

Defined in: src/patterns/Debate.ts:29

Judge persona — reads the debate transcript, returns the verdict.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: src/patterns/Debate.ts:33

***

### model

> `readonly` **model**: `string`

Defined in: src/patterns/Debate.ts:23

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/Debate.ts:34

***

### proposerPrompt

> `readonly` **proposerPrompt**: `string`

Defined in: src/patterns/Debate.ts:25

Proposer persona — asserts a position given the question.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/patterns/Debate.ts:22

***

### rounds?

> `readonly` `optional` **rounds?**: `number`

Defined in: src/patterns/Debate.ts:31

Rounds of propose+critique before the judge weighs in. Default 1.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: src/patterns/Debate.ts:32
