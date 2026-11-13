**Support** — projections from event payloads to exporter attributes.

`bounds.ts` owns the outgoing string/list cap, preserving an unchanged object
when no cap applies. Content keys keep their separately declared size rules.
`evidence.ts` renders the engine's existing redaction-aware summaries.
`projections.ts` selects the existing structure fields and gated content.

The rule: select and bound what this adapter already exports; never invent a
spec value or export a coverage sentence. The adjacent tests exercise the
content boundary; the public OTel suites also pin complete output bytes.
