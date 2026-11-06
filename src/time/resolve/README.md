# Relative-zone resolution

`resolve.ts` remains the public internal resolver facade. This folder holds its
whole zone-reading/provenance units (`zones.ts`), the elapsed lookback builder
(`lookback.ts`) and shared build/refusal types (`types.ts`). It imports existing
time primitives, never the facade, core chart, model or application. No second
time grammar or engine is introduced.

An elapsed span is still `lookbackRange(frozenNow, duration)` including now + 1 ms.
Its stated zone controls its display/provenance, never the elapsed endpoints.
Civil today/yesterday use the existing day resolver and may name a different
instant range in another zone. Both remain proposals until the native ask settles.

Zones use the existing IANA/offset/place/declared-abbreviation reader. Literal
and regional meanings retain their existing tags/notes. A whole-hour offset uses
its existing Etc representation. The current candidate carrier is IANA-only:
a fixed offset without that representation asks for an IANA zone, with a named
capability reason, rather than borrowing the clock zone. `withZoneAnswered`
recognizes this pending elapsed case; answering a zone then re-resolves it.
A mapped fractional alternative is not silently discarded.

Tests beside this owner cover duration token/quote preservation, explicit and
unknown zones, elapsed anchors, the fractional capability boundary, calendar DST,
malformed extra parts and unchanged plain spans. Resolver semantic-choice grouping
and the request-bound correction adapter are separate existing owners. Tests and
full gates must be executed by Root; no pass is inferred here.
