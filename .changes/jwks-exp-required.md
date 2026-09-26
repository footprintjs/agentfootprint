---
type: security
---
**`jwksIdentity` refuses a token with no `exp`.** A correctly signed token without an expiry used to verify and never expire, because `jose` checks `exp` only when a token carries one. It is now refused as `unverifiable`, and the check holds for a custom `backend` too. A deployment whose tokens carry no `exp` stops verifying them; that is the point.
