---
type: fixed
---
**A compaction summary no longer exempts its own values from the evidence check.**
`.compaction()` puts the summarizer's text in a user-role message, and the
evidence gate's exempt corpus indexed it as if the person had said it — so a
value the summarizer INVENTED skipped the names-and-numbers check, and a
summary that repeated a value from a result the model had declared open, noise
or ruled-out skipped the contingent check too. A summary's text now exempts
nothing. What the folded person and app messages exempted is carried forward
with the summary instead (`LLMMessage.foldedExempt`, read off the original
messages at fold time, never off the summary; kept off the wire), so a value
the person gave before the fold stays exempt — on the next turn, after a
restore and through a nested fold. A value from a folded TOOL result is judged
against the results still in the window, exactly as after a drop. Correction
frames stay non-exempt, and an agent that never compacts builds the same
corpus as before. See `src/core/agent/evidence/README.md` § "A compaction
summary exempts nothing by itself".
