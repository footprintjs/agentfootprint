**Mixed** — the existing producer projection and landed-judge adapter.
Fold: `producerCorpus.ts` reads the declared producers' own result bytes.
Walker: `judgeLanded.ts` invokes the optional judge only behind its existing guard.

The judge remains a dynamic import after admission. These modules receive the
existing history, scope and classifier ports; they create no evidence ledger.
