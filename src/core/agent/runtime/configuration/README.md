**Mixed** — resolve static declarations during construction.
`model.ts` and `types.ts` are the **Map** of static declarations;
`configure.ts` is the **Fold** that resolves and validates them once, in order.

`values.ts` is construction-only mutable storage for that readonly contract.
The original native runner still owns its public identity and receives the
same consent, redaction and composition declarations. No run selection, run
state, chart execution or asynchronous boundary belongs here.

`configure.test.ts` covers public identity, validation order and default dials.
The constructor's public signature and defaults remain on the Agent facade.
