# Ask for missing context during evidence repair

```bash
npm run example examples/features/69-evidence-repair.ts
```

This mock-only example deliberately produces an unsupported year. The lexical
evidence gate requests one revision, and `recoveryInstruction` reaches that
request in the system slot. The scripted model then asks for the missing year
and timezone without suggesting invented values. No synthetic user turn is
added, and no model API or external data source is used.

Use this option when a repair needs application-specific guidance. A string
supplies fixed guidance; a synchronous callback can use the frozen
`EvidenceRecoveryContext`. The core evidence frame, posture and one-revision
limit still apply. See the [evidence guide](../../src/core/agent/evidence/README.md)
for the callback contract and bounds.

This demonstrates context delivery, not a guarantee of model behavior. Token
membership cannot establish the meaning of a question, the provenance of tool
arguments, or whether a claim follows from evidence. A wrong argument echoed
by a tool can still pass this check. Use explicit application validation where
those relationships must be established.
