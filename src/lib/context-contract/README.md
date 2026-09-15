# Outer JSON context contract

This pure leaf owns `CONTEXT_FIELD_MEANINGS` and `contextContractForModel()`,
exported only from `agentfootprint/context`. The frozen string record describes
eight application-authored outer fields; the formatter uses that same record.

```ts
import { LLMCall } from 'agentfootprint';
import { contextContractForModel } from 'agentfootprint/context';

const call = LLMCall.create({ provider, model })
  .system(contextContractForModel())
  .build();
await call.run({ message: JSON.stringify(context) });
```

Alternatively pass the text to `defineSteering({ id, prompt })` through the
existing Agent steering configuration. Nothing is injected unless the caller
opts in; no builder option is added. `facts` retain source and scope,
`limitations` constrain claims, `evidenceRefs` need authorized resolution, and
`nextSteps` are proposals. `objective` and `completionRequirements` express the
application's task; `domainDefinitions` explain terms rather than observations.
Unknowns remain distinct from zero, absence from health, and consistency from
completeness.

This is guidance, not JSON validation, reference resolution, authorization,
answer checking or prompt-injection protection. It never reads a payload,
projects rows or selects a plan. Applications still own trusted context
construction, evidence access and output enforcement. Mock wire checks prove
delivery and opt-in behavior, not improved reasoning by a real model.

Run the credential-free example after building:
`npm run example -- examples/context-engineering/23-context-contract.ts`.
