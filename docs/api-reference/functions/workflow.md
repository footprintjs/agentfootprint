[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / workflow

# Function: workflow()

## Call Signature

> **workflow**\<`A`, `B`\>(`s1`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `B`\>

Defined in: [src/core-flow/Workflow.ts:301](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L301)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `B`\>

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

> **workflow**\<`A`, `B`, `C`\>(`s1`, `s2`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `C`\>

Defined in: [src/core-flow/Workflow.ts:302](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L302)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `C`\>

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

> **workflow**\<`A`, `B`, `C`, `D`\>(`s1`, `s2`, `s3`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `D`\>

Defined in: [src/core-flow/Workflow.ts:306](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L306)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `D`\>

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

> **workflow**\<`A`, `B`, `C`, `D`, `E`\>(`s1`, `s2`, `s3`, `s4`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `E`\>

Defined in: [src/core-flow/Workflow.ts:311](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L311)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

#### s4

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`D`\>, `E`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `E`\>

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

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`\>(`s1`, `s2`, `s3`, `s4`, `s5`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `F`\>

Defined in: [src/core-flow/Workflow.ts:317](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L317)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

#### s4

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`D`\>, `E`\>

#### s5

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`E`\>, `F`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `F`\>

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

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `G`\>

Defined in: [src/core-flow/Workflow.ts:324](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L324)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

#### s4

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`D`\>, `E`\>

#### s5

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`E`\>, `F`\>

#### s6

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`F`\>, `G`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `G`\>

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

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `H`\>

Defined in: [src/core-flow/Workflow.ts:332](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L332)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

#### s4

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`D`\>, `E`\>

#### s5

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`E`\>, `F`\>

#### s6

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`F`\>, `G`\>

#### s7

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`G`\>, `H`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `H`\>

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

> **workflow**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`, `s8`): [`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `I`\>

Defined in: [src/core-flow/Workflow.ts:341](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core-flow/Workflow.ts#L341)

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

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`A`, `B`\>

#### s2

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`B`\>, `C`\>

#### s3

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`C`\>, `D`\>

#### s4

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`D`\>, `E`\>

#### s5

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`E`\>, `F`\>

#### s6

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`F`\>, `G`\>

#### s7

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`G`\>, `H`\>

#### s8

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<[`NextStepInput`](/agentfootprint/api/generated/type-aliases/NextStepInput.md)\<`H`\>, `I`\>

### Returns

[`Workflow`](/agentfootprint/api/generated/classes/Workflow.md)\<`A`, `I`\>

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
