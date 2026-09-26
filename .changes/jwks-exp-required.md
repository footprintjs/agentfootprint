---
type: security
---
**`jwksIdentity` refuses a token with no `exp`.** A correctly signed token without an expiry used to verify and never expire, because `jose` checks `exp` only when a token carries one. It is now refused as `unverifiable`. For a custom `backend` that skips the clock checks, the library now also refuses an expired token (`expired`) and a not-yet-valid one (`not-yet-valid`), with the same clock tolerance. A deployment whose tokens carry no `exp` stops verifying them; that is the point.
