**Map** — the existing Agent run-option declaration and its documentation.

`options.ts` extends the native runner options with correlation, trace,
session, identity, time and redaction fields. It makes no runtime decision.
`core/Agent.ts` imports and re-exports the same public type. No package door or
public alias is added. `options.test.ts` exercises the public run door and its
documented correlation/trace precedence.
