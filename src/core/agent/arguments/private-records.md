# Private argument records

Migration: schema default sentences and hypothetical converted-window values have no actual
call context. When a tool carries an argument-view mapper, these sentences hide the value:
a one-field probe cannot establish what a mapper depending on sibling arguments would show.
Tools without a mapper keep their existing prose. Actual answered rows and result notes use
the complete filled call context, so arguments that the real view permits remain visible.

`resolutionRows.ts` contains the complete resolved-row composers extracted from `resolve.ts`, with explicit pure reader ports and full filled-call context for private views. `resolve.ts` remains the oversized declare/verify/resolve facade; `ask.ts` retains planning/validation/binding after complete answer-row composer extraction. Neither file is claimed structurally complete.
