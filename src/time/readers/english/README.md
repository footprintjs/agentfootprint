# Map — English time grammar

This sealed library tokenizes the closed English grammar into parts and verbatim
quotes. It never resolves instants, maps zone words, chooses policy or calls a
model. The TimeReader port owns its data shapes. One narrow existing leaf,
`time/zone.ts` · `zoneOfPlace`, qualifies generic place names in whole corrections;
its returned zone is never substituted for the written token.

| Unit            | One job                                                                                                       | Dependencies                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `../english.ts` | Reader identity/options, synchronous reading, mention composition and the internal whole-zone correction port | port, Atom, grammar, atoms, zones                                   |
| `grammar.ts`    | Closed word/regex grammar and its match iterator                                                              | none                                                                |
| `atoms.ts`      | Primitive recognizers and overlap/zone attachment order                                                       | port types, Atom, grammar, zones                                    |
| `zones.ts`      | One zone lexer shared by attachment and fully consumed affirmative corrections                                | Atom; existing zoneOfPlace only for generic whole-correction places |
| `types.ts`      | Atom shape                                                                                                    | port types                                                          |

The initial extraction moved complete grammar, iterator and atom-recognition units
from the facade. The current lexical correction changes are separate behavior
work; they add no parser, model, executor, async boundary or public package door.
`readEnglishTime` remains the reader strategy's synchronous mention composer.

`ZONE_WORDS` is recognition data, not an abbreviation map. Only EST, EDT, CST, CDT,
MST, MDT, PST, PDT, UTC and GMT accept any letter case. The other existing
abbreviations still require capitals: lowercase west, wet, ist and mt are not
zones. Eastern, Central, Mountain and Pacific are recognized when capitalized or
qualified by “time”; a bare lowercase “central” remains ordinary text. The token
keeps its written spelling. Elapsed/civil interpretation and the caller's mapping
remain the resolver's work; these words never silently become an IANA zone here.
Other ordinary words after “in”, such as “storage”, remain outside the time phrase.

A whole zone correction consumes all its text. The affirmative grammar accepts
bare tokens, a leading “in” or “no,”, and the existing display wrappers. Negation,
conflicts and leftovers remain unreadable. A generic capitalized phrase followed
by “time” is accepted only when the shared tz database lookup identifies a place;
“No time”, “Wrong time” and similar phrases do not become corrections. Explicit
ruled regional words need no place lookup. In an attached phrase, an unknown place
still remains a token for the existing ask path, rather than disappearing.

`ONE_SPAN` reads last/past hour and day with or without “the”, plus the selected
explicit singular one/a/an minute, hour, day and week forms, including their
attached zone. Its first capture remains the existing atom reader's unit.
“The last/past week” and digit forms stay intact; bare calendar “last/past week”,
other number words and unsupported multi-quantity phrases gain no parser or
guessed duration.

`zones.test.ts` covers token case, regional qualifiers, complete affirmative
wrappers, real versus unknown places and rejection controls. `reader.test.ts`
covers complete quotation and one-unit parts for the selected singular forms,
plus unchanged unrelated text. The concrete import fence and existing
unit/property/security/performance cases remain in `test/time/english-reader.test.ts`;
agent behavior remains in `test/time/english-run.test.ts`, and resolver behavior
in `src/time/resolve/lookback.test.ts`. Root executes the exact-head gates and
review; this file claims no test result or approval.
