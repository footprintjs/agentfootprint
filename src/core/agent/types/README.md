**Support** — erased observer option declarations for the legacy Agent facade.

# Legacy observer contracts

`observation.ts` owns the complete observer-delivery and write-provenance aliases.
`../types.ts` keeps their existing import path and its own public AgentOptions
members. These are type-only declarations with no registration or runtime state;
the native engine still owns the observer vocabulary.
