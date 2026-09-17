---
title: workflow
---

# Function: workflow()

## Call Signature

> **workflow**\<`A`, `B`\>(`s1`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `B`\>

Defined in: [src/core-flow/Workflow.ts:301](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L301)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `B`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`\>(`s1`, `s2`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `C`\>

Defined in: [src/core-flow/Workflow.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L302)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `C`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`\>(`s1`, `s2`, `s3`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `D`\>

Defined in: [src/core-flow/Workflow.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L306)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `D`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`, `E`\>(`s1`, `s2`, `s3`, `s4`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `E`\>

Defined in: [src/core-flow/Workflow.ts:311](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L311)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

#### s4

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`D`\>, `E`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `E`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`\>(`s1`, `s2`, `s3`, `s4`, `s5`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `F`\>

Defined in: [src/core-flow/Workflow.ts:317](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L317)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

#### s4

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`D`\>, `E`\>

#### s5

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`E`\>, `F`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `F`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `G`\>

Defined in: [src/core-flow/Workflow.ts:324](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L324)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### G

`G`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

#### s4

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`D`\>, `E`\>

#### s5

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`E`\>, `F`\>

#### s6

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`F`\>, `G`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `G`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `H`\>

Defined in: [src/core-flow/Workflow.ts:332](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L332)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### G

`G`

#### H

`H`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

#### s4

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`D`\>, `E`\>

#### s5

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`E`\>, `F`\>

#### s6

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`F`\>, `G`\>

#### s7

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`G`\>, `H`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `H`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```

## Call Signature

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`, `s8`): [`Workflow`](/docs/api/classes/Workflow)\<`A`, `I`\>

Defined in: [src/core-flow/Workflow.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L341)

Chain 1–8 runners into one, with every hand-off checked by the compiler.

Step N's output type must be what step N+1 accepts — a `string` output
feeds the next step's `{ message }` (the house convention), anything
else is handed over as-is. A chain that does not line up is a COMPILE
error, not a silent empty value at run time.

### Type Parameters

#### A

`A` *extends* `object`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### G

`G`

#### H

`H`

#### I

`I`

### Parameters

#### s1

[`Runner`](/docs/api/interfaces/Runner)\<`A`, `B`\>

#### s2

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`B`\>, `C`\>

#### s3

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`C`\>, `D`\>

#### s4

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`D`\>, `E`\>

#### s5

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`E`\>, `F`\>

#### s6

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`F`\>, `G`\>

#### s7

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`G`\>, `H`\>

#### s8

[`Runner`](/docs/api/interfaces/Runner)\<[`NextStepInput`](/docs/api/type-aliases/NextStepInput)\<`H`\>, `I`\>

### Returns

[`Workflow`](/docs/api/classes/Workflow)\<`A`, `I`\>

### Examples

**LLM steps chain as they always have**

```ts
const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();

const pipeline = workflow(draft, edit);
const text = await pipeline.run({ message: 'a note about refunds' });
```

**structured hand-offs survive**

```ts
const classify: Runner<{ message: string }, { topic: string }> = …;
const answer: Runner<{ topic: string }, string> = …;

await workflow(classify, answer).run({ message: 'my card was declined' });
```
