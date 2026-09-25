---
type: added
---
**Door-guard options and exports: `allowedOrigins`, `allowedHosts`, `requireJsonContentType`, `doorGuard()`, `checkSessionId()`, `AgentHost.onRefusal`.**

- `allowedOrigins`, `allowedHosts` and `requireJsonContentType` on `httpHost`, `nodeHost` and the hosted-runtime adapters (`CrossSiteOptions`). Unset `allowedOrigins` means the door's own host (the `Host` header or an `X-Forwarded-Host` entry; a portless `Host` is read under `X-Forwarded-Proto` when a proxy sends it). `'any'` turns a rule off by name. `requireJsonContentType: false` is the escape hatch for a non-browser integration that cannot send the header. `allowedOrigins: ['null']`, `['*']` and `allowedHosts: []` are refused at construction.
- `maxBodyBytes` on `nodeHost`, defaulting to 1 MiB (`DEFAULT_NODE_MAX_BODY_BYTES`), the hosted adapters' own default.
- `doorGuard({ name, bindHost?, ...rules })`, `checkSessionId()` and `MAX_SESSION_ID_LENGTH` on `agentfootprint/hosting`. A route of your own beside the door (a sign-in route on `onUnhandled`) arrives untouched, so it can keep the same rule: `doorGuard(...).check(req)` returns the refusal with its `status`, or `undefined`.
- `AgentHost.onRefusal(listener)` (optional port member, plus `HostRefusal`). A host reports each request it refused before any handler saw it; every `httpHost` implements it, and `standingAgent` subscribes whenever `onIngressDecision` is set, so those refusals reach the ingress record (`door: 'request' | 'conversation'`, `outcome: 'cross-site-refused'`, or `'refused'` for a session id), classes only.
- The four refusal classes `UnsupportedMediaTypeError`, `OriginNotAllowedError` (with `rule`), `HostNotAllowedError` (with `rule`) and `InvalidSessionIdError` (with `reason`), each carrying its HTTP `status`, and `OriginRefusalRule`.
