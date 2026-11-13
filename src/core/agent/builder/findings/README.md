# Findings configuration

`configure.ts` validates and records the existing findings options, then registers the same instruction and provenance. It reads the original builder live. Behavior proof should cover invalid option order, duplicate refusal, answerAsk/argumentSources opt-ins and the instruction source.
