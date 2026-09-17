**Support** — a port and its adapters: a calibrated classifier the agent can
spend a call on; nothing here decides what the model may see.
Map: `types.ts` (the port, the question and answer shapes, `ClassifierError`;
a zero-import leaf so the skill-graph fence can reach it). Walker:
`typesafe.ts` (TypeSafe "System One", model `jev` — one `fetch`, key from the
environment, backoff on 429/529) · `mock.ts` (a scripted classifier for the
suite and the bench). Trace: nothing here records; the two consumers do —
`core/agent/findings/judge.ts` (the judge on the ledger) and
`lib/injection-engine/classifierScorer.ts` (the scored entry choice).

# `classify/` — the scored choice

## Why

A model that GENERATES a choice puts text on the record; the evidence of the
choice is the text. A classifier that SCORES a choice reads the state once and
answers with a probability per declared candidate, a confidence, a pick — the
"Jev" pattern (docs/design/2026-09-scored-choice.md): the schema holds by
construction and the decision comes with its distribution. This folder is the
port for such a provider and the two adapters that honour it; what the agent
does with one is decided elsewhere and recorded there.

## The port

```ts
interface Classifier {
  readonly name: string; // 'typesafe' | 'mock' | yours — what a record row names
  classify(request: ClassifyRequest, signal?: AbortSignal): Promise<ClassifyResult>;
}
// request:  { state: unknown, questions: { [id]: choice | noul | score } }
//   choice: { type: 'choice', instructions, criteria: { optionId: description } }
//   noul:   { type: 'noul', instructions, criteria?: { true, false } }
//   score:  { type: 'score', instructions, criteria: string[] }
// result:   { model, answers: { [id]: answer }, usage?: { inputTokens, outputTokens }, latencyMs }
//   choice: { type: 'choice', choice, confidence, probabilities }
//   noul:   { type: 'noul', noul }
//   score:  { type: 'score', score, confidence, probabilities, legend? }
```

## The laws

- **A score is data only when the provider produced it.** Nothing here
  infers a probability, defaults a choice, or renormalises a distribution:
  `probabilities` is the wire's own object, whatever it sums to.
- **Cost is data.** Every result carries `latencyMs` measured around the
  whole call (retries and their waits included) and `usage` when the provider
  reported it. A bench and a lens read the cost of a judgment off the record.
- **A failure is a `ClassifierError`** with the provider's `status` when there
  was one and `retryable` for a rate limit or overload — never a guessed
  answer. The key is read once at construction and appears in the
  `Authorization` header only: never in an error, never in a log.

## The adapter — `typesafe()`

`POST {baseUrl}/v1/systemone`, bearer `TYPESAFE_API_KEY` (or `apiKey`), body
`{ model, state, questions }`; `model` defaults to `'jev-latest'`. 429 and 529
back off exponentially (`retryDelayMs`, doubling) up to `maxRetries` (default
2); every other status is final. A missing key is refused at construction,
naming the variable, so a misconfigured agent fails at build and not once per
tool result. Verified 2026-09-17 by one real call; the response below is that
probe's, and `test/classify/typesafe.test.ts` maps it byte for byte against a
stubbed `fetch` — the suite never calls the hosted classifier.

```json
{ "model": "jev-1.13.0",
  "answers": {
    "standing": { "type": "choice", "choice": "noise", "confidence": 0.59,
                  "probabilities": { "fact": 0.0, "noise": 0.69, "open": 0.3, "ruled-out": 0.01 } },
    "tests_proposition": { "type": "noul", "noul": 0.19 } },
  "usage": { "input_tokens": 494, "output_tokens": 68 } }
```

## One example

```ts
import { typesafe, mockClassifier } from 'agentfootprint/classify';
import { classifierScorer, skillGraph } from 'agentfootprint/skill-graph';

// A second source on the findings ledger: one call per tool result,
// a JudgmentRow beside the model's own standing, never served in its place.
const agent = Agent.create({ provider, model })
  .tool(search)
  .findings({ judge: typesafe() })
  .build();
await agent.run({ message: 'why is fc1/7 down?' });
agent.findings()?.filter((r) => r.kind === 'judgment'); // standing, probabilities, confidence, usage, latencyMs

// The entry choice as a distribution: the provider's pick is the cursor,
// its probabilities are the "Why this skill?" ranking.
const graph = skillGraph().entry(billing).entry(incident).entryBy(classifierScorer(typesafe())).build();

// In a test or the bench: a scripted classifier, every request on `calls`.
const judge = mockClassifier([{ model: 'mock', answers: { … }, latencyMs: 0 }]);
```

## Files

- `types.ts` — `Classifier`, `ClassifyRequest`, `ClassifyQuestion` (three
  kinds), `ClassifyResult`, `ClassifyAnswer` (three kinds), `ClassifierError`.
- `typesafe.ts` — `typesafe(options)`, `TypesafeClassifierOptions`.
- `mock.ts` — `mockClassifier(script)`, `MockClassifier` (with `calls`).
- `index.ts` — the implementation barrel; the door is `src/doors/classify.ts`
  (`agentfootprint/classify`).
