[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStoreCaseName

# Type Alias: ArtifactStoreCaseName

> **ArtifactStoreCaseName** = `"put-mints-a-ticket-head-describes-get-redeems"` \| `"payloads-round-trip-as-the-value-they-were-given"` \| `"refs-are-minted-never-derived-from-the-payload"` \| `"a-ref-alone-opens-nothing"` \| `"confusable-scopes-are-not-one-scope"` \| `"missing-expired-and-foreign-scope-are-one-absence"` \| `"expiry-is-stated-at-mint-never-sprung"` \| `"delete-removes-and-deleting-an-absence-is-agreement"` \| `"list-pages-newest-first-and-carries-no-payload"` \| `"awkward-scope-values-are-names-not-paths"` \| `"oversized-payload-is-refused-before-the-write"` \| `"parent-refs-are-proven-at-mint"` \| `"malformed-puts-are-refused-by-name"` \| `"refusals-carry-no-payload-and-no-scope"` \| `"digest-is-minted-over-the-payload-and-rides-the-ticket"` \| `"get-refuses-a-payload-that-no-longer-matches-its-digest"` \| `"get-stream-does-not-verify-the-digest"` \| `"streamed-put-round-trips-and-declares-its-bytes"` \| `"streaming-members-are-feature-detected"`

Defined in: [src/artifacts/conformance/types.ts:21](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/conformance/types.ts#L21)

Every case in the battery, by name.

A closed union on purpose. A harness DECLARES the cases it cannot satisfy by
writing their names down, and a name that is a free-form string is a name
that goes stale silently — a declaration for a case that was renamed would
keep suppressing nothing at all, which is the same shape as the bug this
whole battery exists to catch.
