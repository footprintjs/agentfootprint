---
title: RunbookVerdictsOptions
---

# Interface: RunbookVerdictsOptions

Defined in: [src/core/runbook/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L56)

The verdict/rowset projection's dials.

## Properties

### decider

> `readonly` **decider**: `string`

Defined in: [src/core/runbook/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L73)

The decider stage (by id or name) whose declared branch labels generate
`verdict_meanings`. Branch descriptions come from the chart's own
structure when the decider is statically declared; rule labels observed
in this run's decide() evidence refine them (and are the only source
when the decider lives inside a dynamically generated fan-out branch,
where build-time structure cannot see it).

The DEFAULT branch is chosen by no rule, so no rule label describes it.
Name it where the rules are named — `decide(scope, rules, { branch,
label })` — and the label arrives here on the same evidence:

```ts
decide(scope, rules, { branch: 'protected', label: 'No rule fired — asset stays protected' });
```

***

### maxRows?

> `readonly` `optional` **maxRows?**: `number`

Defined in: [src/core/runbook/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L77)

Cap on `verdicts` rows AND the rendered table — ONE number for both
 halves (a longer list beside a shorter table is an invitation to retype
 identifiers). Default 50.
