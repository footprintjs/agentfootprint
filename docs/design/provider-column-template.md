# Provider-column template — how a new infrastructure provider joins the docs

> Status: authoring canon. AWS and On-premises are the two worked instances; any
> new provider column (a cloud, a platform, an enterprise stack) fills in THIS
> skeleton. The three-layer law comes first, because every mistake in provider
> docs is a violation of it.

## The three-layer law

1. **Capability pages own the depth.** The port, every adapter across all
   providers, the strategy axes, the choose-when rows. A new provider's adapters
   are documented THERE — one row/section per adapter on the existing capability
   page. Never duplicate that material onto a provider page.
2. **The provider page is a map.** One screen answering "I run on X — what do I
   reach for?" Service-by-service rows that LINK into capability pages. It never
   explains a port; it routes to the page that does.
3. **Provider sub-pages exist only for genuinely provider-specific material**
   (setup walkthroughs, a platform's own contract, an SDK's quirks) that fits
   neither layer. Promotion rule: a service section on the provider page that
   outgrows one screen gets promoted individually, when it happens — never
   speculatively.

One canonical path per fact. A fact living in two places is a future
contradiction; `docs:truth` catches phantoms, not duplicates — the author is
the check.

## The provider page skeleton (`infrastructure/<provider>.mdx` or `<provider>/index.mdx`)

1. **Opening frame** — one short paragraph: what this column is, and the
   dev-ladder sentence when it applies (mock → local → this provider).
2. **The map table** — one row per service area:
   `service | adapter/factory | door (import path) | peer dep | ops covered | status`.
   "Ops covered" states what is NOT covered as plainly as what is.
3. **Per-service short sections** — a few sentences each: the adapter's shape,
   its one or two load-bearing options, the link into the capability page, and
   any provider-specific trap (with the fix).
4. **"What is NOT here"** — a stated list. Absences are facts; an unstated
   absence reads as an oversight and invites a wrong assumption.
5. **Status table** — every adapter with its honesty rung (vocabulary below).
6. **Cross-link duties** (the checklist that keeps navs whole):
   - a row in `infrastructure/index.mdx`'s decision table where the provider is
     the right answer to a scenario;
   - the Providers group in `infrastructure/meta.json`;
   - the "Run it somewhere" group in `build/meta.json`;
   - an "Other providers" line on each sibling provider page;
   - adapter rows + status rows on every capability page the column touches.

## The status vocabulary (use these exact rungs, nothing softer)

- **verified in a production field deployment** — reserved for a *deployment
  shape* proven end to end in the field. Scope the phrase to the shape, never
  to an individual adapter unless that adapter itself was field-exercised.
- **contract-shaped and tested; awaiting field use** — built against the
  provider's documented contract with mock/injected tests; no live validation
  yet. This is an honest and respectable rung — say it plainly.
- **bring-your-own via the port** — the port exists, the adapter doesn't; state
  the port's size (one method, three methods) so the reader can judge the cost.

## Laws that bind every provider column

- **Vendor-neutral ports first**: the column implements the SAME ports every
  other column implements. If a provider needs a port change, that is a design
  round, not a docs page.
- **SDK adapters join the command-name pin** (`test/adapters/aws/awsCommandPin.ts`
  pattern): every dispatched SDK command name pinned by test — dispatch,
  reality, completeness. Three shipped bugs made this law; no column is exempt.
- **Secrets never in errors, events, or logs** — the two-clause token-secrecy
  law, pinned by a secrecy test for any credential-touching adapter.
- **No invented numbers.** Measured claims carry their source; everything else
  is qualitative.
- **No partner, customer, or team names.** Field evidence is phrased as
  "a production field deployment" — nothing more specific, ever.
- **Refusals teach**: every adapter's failure modes name the option or the fix,
  and the page quotes the load-bearing ones.
