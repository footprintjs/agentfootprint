[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RESERVED\_SUBFLOW\_PREFIX

# Variable: RESERVED\_SUBFLOW\_PREFIX

> `const` **RESERVED\_SUBFLOW\_PREFIX**: `"sf-"` = `'sf-'`

Defined in: [src/conventions.ts:96](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/conventions.ts#L96)

The subflow-id prefix the framework reserves for its OWN composition
segments. Every id in SUBFLOW\_IDS carries it except
SUBFLOW\_IDS.FINAL (a decider BRANCH KEY that doubles as a mount id,
not a name we chose), and the set is deliberately open-ended — builders
generate more of them per feature and per release (`sf-router-llm`,
`sf-memory-read-<id>`, `sf-memory-write-<id>`, …).

Reserved rather than merely conventional because every reader downstream
tells LIBRARY PLUMBING from CONSUMER STRUCTURE by this prefix and nothing
else:

  • commentary skips `sf-*` segments while walking `meta.subflowPath` back
    to a user-facing agent name (`commentary/commentaryTemplates.ts`);
  • `BoundaryRecorder` hides them from the StepGraph so they never show up
    as steps a person has to scrub past;
  • the OTel bridge drops a slot-fork selection whose members are all
    `sf-*` (`adapters/observability/otel.ts`);
  • [stageRole](/agentfootprint/api/generated/functions/stageRole.md) and the pattern/fingerprint readers classify by the
    same convention.

So a consumer branch named `sf-billing` does NOT fail like a name clash —
it is silently read as framework plumbing and vanishes from the very views
it was built to appear in. That is two different facts (framework segment /
consumer segment) sharing one namespace with no law, which is why the doors
that accept a consumer-chosen segment name refuse this prefix outright.
