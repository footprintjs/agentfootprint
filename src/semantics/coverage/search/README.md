**Mixed** — what a tool's search is made of, and the coverage the library composes from it.
Map: `types.ts` (the `Tool.search` declaration), `declaration.ts` (the one rule `defineTool`
and the MCP ingest door hold it to), `statementText.ts` (text that can reach a statement),
`review.ts` (what the gate lists for a person: `source-said`, `said-overlap`),
`resultFacts.ts` (`resolved` and `paging` on a result).
Fold: `compose.ts` composes ONE call's row — `door.ts` (which result door) → `inEffect.ts`
(each argument, for the call that ran) → `facets.ts` (`checked`) → `gaps.ts` → `complete`;
`binding.ts` (a `resolved` entity binds only the value sent), `span.ts` (a relative window at
the turn's clock).
Lens: `served.ts` (what the model reads), `events.ts` (what an event carries: references,
never a composed value).

## Why

A model turns "the tool found nothing" into "it does not exist", and an author's prose about
what a search covered is unreliable. So a tool declares, once and as typed data, what one call
searches; the library composes each call's coverage from the arguments the call ran with. The
row it writes is `../composedCoverage.ts` · `ComposedCoverage` — the contract the
negative-claim checker reads.

## The one law

Composition can only under-claim. A facet enters `checked` from a value the call sent, a
declared default, a declared fixed qualifier, the declared (or sent) source, or a host-filled
identity key; a result fact can only narrow. Every classified argument none of those covers is
a gap that bears on its facet, and a cap, a page or a `partial` outcome bears on completeness.

## Example

```ts
defineTool({
  name: 'list_incidents',
  inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
  search: {
    source: { what: 'the incident store', said: ['the incident store'] },
    subject: { what: 'incidents', said: ['incidents'] },
    arguments: [{ name: 'service', role: 'population' }],
    complete: 'within-arguments',
  },
  execute: ({ service }) => absent({ what: `incidents on ${service}`, checked: 'declared' }),
});
```

Design: `docs/design/2026-10-negative-claims.md` §§ 3.1–3.4.
