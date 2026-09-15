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

## Evidence destinations (opt-in)

`resolveEvidenceNeed(need, routes?, availableInputs?)` performs a bounded exact-ID
lookup over trusted application declarations. An omitted map returns
`not_configured`; an empty/nonmatching map returns `no_matching_route`; matches
retain all alternatives with `proposed` or `needs_input` and explicit missing
input names. The frozen result is detached from the declarations.

```ts
import { resolveEvidenceNeed } from 'agentfootprint/context';
const next = resolveEvidenceNeed(
  { id: 'worker-health', description: 'Worker-health observations for this queue.' },
  [{ id: 'ops', need: 'worker-health', destination: 'operations team',
     description: 'Request worker-health observations for the same interval.',
     requiredInputs: ['queue', 'interval'] }],
  ['queue'], // validated by the application for this request
);
// next.routes[0].status === 'needs_input'; missingInputs === ['interval']
```

This is a declaration resolver, not an ontology engine or recovery runtime.
It neither infers a gap from natural language nor checks whether a destination
exists, is connected, contains data or is authorized. Applications own domain
relationships, validated inputs, scope, allowed actions and human-facing wording.
Register a route only from trusted configuration; source prose and model output
must not install routes. A match is a proposal, never execution evidence.
Missing map entries say nothing about evidence outside that map. Capabilities
must still pass normal registration, permission and dispatch checks if invoked.
Only needs/routes relevant to a validated current scope should enter model
context; keep data in referenced storage. At most 16 routes and 16 input names
are accepted, with unique route IDs and bounded nonempty text.
