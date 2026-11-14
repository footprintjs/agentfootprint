**Mixed** — preserve admitted conversation state across native turns.
`continuation.ts` is the **Walker** that validates and restores one continuation;
`seedHistory.ts` is the **Fold** that creates its accepted user-entry history.

# Legacy conversation support

Both ordinary continuation and error resume use the retained private Agent method,
which delegates here. Restoration keeps its original validation order, pending
value shapes and single-use seed channel. Source indexes contain only native
artifact references; they do not authenticate an imported checkpoint or copy source
values into history. The input middleware's accepted message remains the only
new user entry.
