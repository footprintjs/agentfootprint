**Mixed** — declares the findings policy and registers its model-facing ask.
Map: `configure.ts` validates and retains the ledger options.
Lens: `configure.ts` selects the existing findings instruction for those options.

# Findings configuration

`configure.ts` validates and records the existing findings options, then registers the same instruction and provenance. It reads the original builder live. Behavior proof should cover invalid option order, duplicate refusal, answerAsk/argumentSources opt-ins and the instruction source.
