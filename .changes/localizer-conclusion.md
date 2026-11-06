---
type: added
---
**`localizeContextBug` now says what its verdicts add up to, and reads the record to tell one path from two causes.** With a re-runner, a report has a `conclusion`: `one-cause`, `one-path`, `needed-together`, `redundant-pair`, `missing-context`, `no-single-cause`, `none-found` or `inconclusive`, with the items it names and a plain statement of what was and wasn't tested. Reading verdicts one at a time could blame true facts when a model made its own mistake, could report nothing when two items were each enough alone, and could report two causes when a planted instruction made the agent call the wrong tool.

`conclusion.links` shows what the record says about two flipped items, with no model call. `code` means only fixed steps lie between them. `model-or-tool` means the later one came after a call that read the earlier one, which shows it could have depended on it, not that it did.

When no single removal flips the answer, the report now tries every pair among the top 5 items. That's up to 10 more probes, each costing `samples` runs, and only in that case. Set `rerun.pairSearchTop` to change it, or to `0` to turn it off. `rerun.maxNamedFlips` sets how many items the record doesn't link may each flip the answer and still be named (default 2). It's a count rather than a share, so adding harmless items to a context can't change the reading.

`bisectCulprits` no longer says `not-reproducible` just because removing every suspect at once didn't flip the answer. That leaves the model's default answer, which can be the wrong answer itself, so it now tries the top-ranked suspects alone and in pairs. It can also return a new verdict, `not-specific`, when several of them flip it.

`rerun.maxSuspects` above 12 now works. The report kept only 12 ranked suspects by default, so a larger budget was silently cut to 12, and the advice to raise it did nothing on a large context.

Confirmed claims now start `NEEDED IN THIS CONTEXT:` instead of `CAUSAL:`, because a true fact can be needed too. If you matched on that text, read `verdict.verdict` instead. Items that can't be removed, kinds `stage` and `arg`, are now listed after the items that can.
