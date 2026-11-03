# Trace — event payload contracts

Typed records carried by the event stream.

`../payloads.ts` is the canonical facade. It exposes the same named payload
types used by the event registry and public `Payloads` namespace. Callers use
that facade; domain modules do not import it.

Each file owns one event domain's declarations. Dependencies between domains
are type-only references to the owning contract. `dependencyTypes.ts` is the
internal vocabulary for types owned elsewhere in the library; the facade
never exports it. These files hold no runtime code, mutable state or event
emission. The dispatcher, registry and emitting stages keep their existing
roles.

Add a payload to its owning domain and export its type through the facade.
Keep private supporting types private. Complete files, including imports and
comments, stay within the shared source-file size limit.
