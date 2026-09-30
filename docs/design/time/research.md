# Time layer · how other systems handle time

**Research, 2026-09-29. Read-only. Companion to [README.md](README.md) § 2.**

This page is the evidence behind the time layer's borrowings. Each system gets four lines: how it
works, what it gets right, what goes wrong when an agent uses it, and what we borrow or avoid. The
sources are public documentation and public issue trackers, linked inline. One claim is marked as
medium confidence where the page fetch could not confirm it.

## 1. The headline

No agent framework surveyed has a time layer. Each does one of four things:

| Approach | Who | What is missing |
|---|---|---|
| Give the model a clock tool; the model does the arithmetic | Semantic Kernel `TimePlugin` ([.NET](https://learn.microsoft.com/en-us/dotnet/api/microsoft.semantickernel.plugins.core.timeplugin?view=semantic-kernel-dotnet), [Python](https://learn.microsoft.com/en-us/python/api/semantic-kernel/semantic_kernel.core_plugins.time_plugin.timeplugin?view=semantic-kernel-python)) | the model resolves "last Tuesday"; `now` is the server's local zone; nothing records the reading |
| Let the model write date filters | LangChain SelfQueryRetriever, LlamaIndex auto-retrieval | the filter holds the literal `"today"` ([langchain#13309](https://github.com/langchain-ai/langchain/issues/13309)); the prompt's `YYYY-MM-DD` mismatches the store's epoch numbers ([#13593](https://github.com/langchain-ai/langchain/issues/13593)); a store converts a string silently ([#15856](https://github.com/langchain-ai/langchain/issues/15856)) |
| Constrain the format only | OpenAI structured outputs (`date-time`, `date`, `time`, `duration` string formats — medium confidence, [guide](https://developers.openai.com/api/docs/guides/structured-outputs)); Anthropic tool use ([overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)); MCP elicitation (`date`, `date-time`, [spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)) | a well-formed `date-time` can still be the wrong instant: wrong zone, in the future, outside retention |
| Delegate to an extractor with config | Rasa + Duckling ([extractor](https://github.com/RasaHQ/rasa/blob/main/rasa/nlu/extractors/duckling_entity_extractor.py)) | the anchor is right (the message's timestamp), but the chosen reading is not recorded against the call |

None records **which reading** of an ambiguous phrase was taken, **what it was resolved against**,
or **whether the window the tool read matched what the person asked**. That gap is the time
layer's reason to exist.

## 2. System by system

### Observability and query surfaces

**Grafana.** One `from`/`to` range, relative (`now-6h`, `now/d`) or absolute, drives every panel
([dashboards](https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/)). Each data
source receives it in the spelling it wants through format modifiers such as `${__from:date:iso}`
([variables](https://grafana.com/docs/grafana/latest/dashboards/variables/add-template-variables/)).
`$__interval` is derived from the range and the panel width, capped by Max data points and floored
by Min interval ([query options](https://grafana.com/docs/grafana/latest/panels-visualizations/query-transform-data/)).
- Right: one range object; **per-consumer spellings of that one range**; a derived interval.
- Wrong for an agent: the zone is a viewer preference, never recorded against the data.
- **Borrow** one range → many declared spellings; derived interval with bounds. **Avoid** the view
  zone as the only zone fact.

**Elasticsearch / Kibana.** "`now` is always the current system time in UTC"; `time_zone` affects
only calendar rounding such as `now/d` ([common options](https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html)).
Rounding is operator-aware: `gte 2014-11-18||/M` → `2014-11-01T00:00:00.000`, `lte` →
`2014-11-30T23:59:59.999` ([range query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-range-query.html)).
`date_histogram` keeps `calendar_interval` (DST-aware) apart from `fixed_interval`. The display
zone defaults to the browser ([advanced settings](https://www.elastic.co/docs/reference/kibana/advanced-settings)),
and a live issue reads "[Agent Builder] Date formatting in UI ignores dateFormat:tz"
([kibana#290443](https://github.com/elastic/kibana/issues/290443)).
- Right: `now` is an instant and the zone is for calendar arithmetic; edge semantics are specified;
  a day across DST is not 24 hours.
- Wrong: the browser as the silent display zone — and the agent surface broke it again.
- **Borrow** the `now`/zone split, explicit edges, calendar vs fixed interval. **Avoid** a silent
  display zone.

**Splunk.** Every event carries a mandatory `_time`; `-24h@h` applies the offset first, then snaps
backwards ([time modifiers](https://docs.splunk.com/Documentation/SplunkCloud/latest/SearchReference/SearchTimeModifiers)).
Relative times resolve in a per-user profile zone that is not in the query text.
- **Borrow** a guaranteed time column declared once; deterministic snapping. **Avoid** a zone from
  a hidden profile.

**Prometheus.** The range API takes RFC 3339 or Unix seconds; "output timestamps are always
represented as Unix timestamps in seconds" ([HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)).
Staleness is a declared lookback delta, 5 minutes by default ([basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)).
A duration-only grammar cannot say "08:00–08:40 last Thursday".
- **Borrow** liberal in, one canonical form out; staleness as a declared property of a source.

**Datadog.** A series is capped at 1,500 points; a manual rollup "cannot be shorter than the
automatic rollup interval" ([rollup](https://docs.datadoghq.com/dashboards/functions/rollup/)),
and the FAQ admits zooming out smooths the graph
([FAQ](https://docs.datadoghq.com/dashboards/faq/why-does-zooming-out-a-timeframe-also-smooth-out-my-graphs/)).
- Right: one rule derives the effective interval. Wrong: the clamp is silent.
- **Borrow** the derivation, with the clamp **recorded** ("coarser than asked").

### Reading time out of words

**Duckling.** A request carries a reference time and a zone; the answer is `{value | interval,
grain, values[]}` ([repo](https://github.com/facebook/duckling)). "9 AM" is grain `hour`.
- Right: **grain is part of the value**, and the anchor is an input. Wrong: an offset, not a zone
  name; a separate service; opinionated tie-breaks.
- **Borrow** the result shape and grain.

**Recognizers-Text (DateTimeV2).** Keeps the underspecified form (`XXXX-05-02`) and returns every
resolution: "the resolution array has two elements if the datetimeV2 value is ambiguous … When the
time is ambiguous for A.M. or P.M., both values are included" ([reference](https://learn.microsoft.com/en-us/azure/ai-services/luis/luis-reference-prebuilt-datetimev2)).
Consumers routinely take `values[0]`.
- **Borrow** ambiguity returned as data. **Avoid** collapsing the list without a recorded rule.

**chrono-node.** Pure JavaScript; reference `{ instant, timezone }`, `forwardDate`, a configurable
abbreviation map, locale variants (`en.GB` reads `6/10` as 6 October), and `isCertain(component)`
separating said from implied ([repo](https://github.com/wanasit/chrono)). Its default returns the
first parse, and its default table reads PST as −08:00 even in October.
- **Borrow** the said/implied split and configuration-as-data. **Avoid** making it the library's
  identity; at most one adapter behind the port.

**dateparser.** The whole ambiguity policy is settings: `DATE_ORDER` (default MDY),
`PREFER_DATES_FROM` (`past | future | current_period`), `RELATIVE_BASE`, `TIMEZONE`,
`TO_TIMEZONE`, `STRICT_PARSING`, `REQUIRE_PARTS` ([settings](https://dateparser.readthedocs.io/en/latest/settings.html)).
- **Borrow** the vocabulary nearly word for word. **Avoid** silent defaults (MDY, local zone).

**TimeML / SUTime / HeidelTime.** TIMEX3 types `DATE | TIME | DURATION | SET`, values in ISO 8601,
and `anchorTimeID` for relative expressions ([TimeML](https://www.cs.brandeis.edu/~cs112/cs112-2004/annPS/TimeML12wp.htm)).
SUTime anchors on the document's creation time; HeidelTime chooses the anchor by domain
([SUTime](https://nlp.stanford.edu/pubs/lrec2012-sutime.pdf), [GATE-Time](https://aclanthology.org/L16-1587.pdf)).
- **Borrow** "relative to what?" as a recorded field. In a chat, "yesterday" anchors on the
  message; "the hour before that" anchors on the last resolved window.

### Standards and types

- **RFC 3339** § 4.4: unqualified local time "will fail in approximately 23/24 of the globe"
  ([RFC 3339](https://www.rfc-editor.org/rfc/rfc3339)). `coverage/period.ts` already refuses
  zone-less instants.
- **RFC 9557** adds a bracketed zone, `2022-07-08T00:14:07+02:00[Europe/Paris]`, and flags an
  offset/zone inconsistency ([RFC 9557](https://www.rfc-editor.org/rfc/rfc9557)) — the natural
  way to carry "the offset **and** the zone the person meant".
- **IANA tz**: abbreviations "are ambiguous in practice: e.g., CST means one thing in China and
  something else in North America" ([theory](https://data.iana.org/time-zones/theory.html)).
- **TC39 Temporal** (stage 4, ES2026; [Igalia](https://www.igalia.com/2026/03/13/Temporal-Reaches-Stage-4.html)):
  `Instant`, `ZonedDateTime`, `PlainDateTime`/`PlainDate`/`PlainTime`, `Duration`; DST gaps and
  overlaps resolved by `disambiguation: compatible | earlier | later | reject`, offset conflicts by
  `offset: use | ignore | prefer | reject` ([docs](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)).
  `reject` is exactly "ask the person".

### Charting and data

- **Vega-Lite**: a field's type is declared (`temporal`); `timeUnit` has `utc*` variants and a
  `binned` prefix; ISO strings parse as UTC, non-ISO strings as local time ([type](https://vega.github.io/vega-lite/docs/type.html),
  [timeUnit](https://vega.github.io/vega-lite/docs/timeunit.html)) — a known silent hour shift.
- **OpenTelemetry metrics**: UTC epoch nanoseconds; each point bounded by a start and a time;
  aggregation temporality (delta vs cumulative) declared ([data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)).
- **Apache Arrow**: `Timestamp` has a `unit` and an optional `timezone`; with none, the value is
  "in an unknown timezone" ([Schema.fbs](https://github.com/apache/arrow/blob/main/format/Schema.fbs)).
  Zoned vs naive lives in the type, so comparing two naive columns is visibly unsafe.

## 3. Comparison

| System | Anchor | Zone model | Ambiguity | Grain / interval | Fails an agent by | Borrow |
|---|---|---|---|---|---|---|
| Grafana | `now`, relative or absolute | view preference | none | derived, bounded | zone unrecorded | one range, many spellings |
| Kibana / ES | `now` = UTC | zone only for rounding; browser display | none | calendar vs fixed | browser default | `now`/zone split; edges |
| Splunk | `now`, `@` snap | profile | none | mandatory `_time` | hidden zone | declared time column |
| Prometheus | eval time | UTC out | none | step; staleness | duration-only grammar | canonical output |
| Datadog | range | view | none | auto rollup | silent clamp | recorded clamp |
| Duckling | explicit reftime + tz | offset | `values[]` | `grain` | offset not zone | result shape, grain |
| Recognizers-Text | reference date | offset | every resolution | TIMEX | `values[0]` | ambiguity as data |
| chrono-node | `{instant, timezone}` | configurable map | first parse | components | PST in October | said/implied |
| dateparser | `RELATIVE_BASE` | settings | order, prefer, strict | period | silent MDY | the settings vocabulary |
| TimeML | anchor id | ISO | function flag | DATE/TIME/DURATION/SET | heavy | recorded anchor |
| RFC 3339 / 9557 | — | offset + `[zone]` | inconsistency flag | — | — | wire spelling |
| Temporal | `Temporal.Now` | typed kinds | `reject` policy | `Duration` | not on older runtimes | type vocabulary |
| Semantic Kernel | clock tool | server zone | the model | — | model does arithmetic | clock outside the model |
| LangChain | prompt | none | the model | — | literal `"today"` | declared spelling |
| OpenAI / Anthropic / MCP | the app | format | none | — | valid format, wrong instant | typed ask form |
| Rasa | message timestamp | config | Duckling's | Duckling's | — | anchor = message |
| Vega-Lite | — | `utc*` vs local | — | `timeUnit`, `binned` | parse split | declared temporal field |
| OTel | — | UTC | — | temporality | — | per-point interval |
| Arrow | — | zoned vs naive | — | unit | — | only zoned compare |

## 4. Ten lessons, ranked

1. Four kinds, never coerced silently: instant, zoned wall time, plain wall time, duration. Only
   instants compare (Temporal, Arrow, TimeML).
2. Resolution is a function of text, anchor, zone and policy — all four recorded; the anchor is the
   message's time, so resume and replay reproduce it (Duckling, Rasa, TimeML).
3. Ambiguity is data; collapse it only by a declared policy, and "ask" is a policy
   (Recognizers-Text, Temporal `reject`, dateparser `STRICT_PARSING`).
4. Direction is configuration and a violation is a refusal (`PREFER_DATES_FROM`, `forwardDate`).
5. Grain and said/implied are part of the value (Duckling, chrono-node).
6. One canonical range, many declared spellings; the library converts, and an inexact conversion is
   recorded or refused (Grafana; LangChain's failure).
7. Zones are IANA names or offsets; abbreviations are input only, through a recorded map (IANA,
   RFC 9557).
8. Every dataset declares its time axis (Splunk, Vega-Lite, OTel, Arrow).
9. The effective interval is derived and a clamp is reported (Grafana, Datadog, Kibana).
10. Edges are explicit (ES rounding, OTel intervals).

**Avoid:** a silent browser or server zone; a clock tool with the model doing arithmetic;
model-written filter literals; `values[0]`; local-vs-UTC string parsing; silent coarsening.
