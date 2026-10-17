---
title: checkClaimRequirements
---

# Function: checkClaimRequirements()

> **checkClaimRequirements**(`policy`, `results`): [`ClaimRequirementAssessment`](/docs/api/interfaces/ClaimRequirementAssessment)

Defined in: [src/answer-validation/requirements.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L109)

Check every expected prerequisite for one exact claim/finding/window binding.
Any same-scope unresolved report affecting this claim denies it, including an
extra obligation; a satisfied report never overrides that denial. Missing
expected obligations are unreachable, not a successful empty check.

The host must authenticate the producer and current query/run/scope, authorize
receipt access and establish domain validity BEFORE supplying results. The
public Foottrace reader admits structure only; neither it nor this helper
verifies provenance, freshness, a claim's value, or permission to disclose it.
Use the returned check only when the candidate actually asserts this claim.
Requirement result IDs are selectors, never artifact evidence references.

A malformed host policy throws code ERR_CLAIM_REQUIREMENT_POLICY. Malformed
receipt sets produce unreachable/invalid-data without exposing parser errors.

## Parameters

### policy

[`ClaimRequirementPolicy`](/docs/api/interfaces/ClaimRequirementPolicy)

### results

`unknown`

## Returns

[`ClaimRequirementAssessment`](/docs/api/interfaces/ClaimRequirementAssessment)
