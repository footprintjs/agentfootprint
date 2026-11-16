**Support** — private utilities for the custom request reader's answer.

# `request/` — custom-reader JSON snapshot

`readerAnswer.ts` owns the existing thenable check and plain JSON copy. Only
`../request.ts` uses these helpers. There are no imports or return edges, and
neither helper is exported through the public AG-UI door.

The facade keeps reader admission, default-reader handling, exception mapping,
shape validation and turn planning in their original order. This copy handles
inbound reader values; outbound event redaction remains with the wire helpers.
`readerAnswer.test.ts` checks JSON conversion, detachment and observation, and
thenable detection. Request and gateway tests cover the public boundary.

This step-1 split moves whole helpers without changing their bodies, comments
or blank lines. The remaining facade is below the 600-line limit; its turn
orchestration is retained, rather than described as a chart rewrite.
