**Mixed** — the existing credential-reporting wrapper.
Walker: `reportingCredentials.ts` delegates to the supplied credential provider.
Trace: the same wrapper reports a failure through the supplied security emitter.

The wrapper preserves the provider's result and throw. It adds no retry, policy
choice or credential cache. The stage also reads the same error-class helper.
