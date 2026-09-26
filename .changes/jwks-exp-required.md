---
type: changed
---
**`jwksIdentity` refuses a token with no `exp`.** A correctly signed token without an expiry used to verify and never expire, because `jose` checks `exp` only when a token carries one. It is now refused as `unverifiable`. For a custom `backend` that skips the clock checks, the library now also refuses an expired token (`expired`) and a not-yet-valid one (`not-yet-valid`), with the same clock tolerance. A token that never expires is a credential that can never be revoked by time, which is why this closes it.

Migration: a deployment whose tokens carry no `exp` stops verifying them after the upgrade (the caller gets `unverifiable`). Configure the identity provider to issue an `exp` on every access token before upgrading; there is deliberately no option to accept tokens without one. A custom `backend` needs no change — the clock checks now run for it too, with the same `clockToleranceSeconds`.
