# The person's typed answer, and how they spell a date or a time

Moved out of [README.md](README.md) (the folder's size limit); the README keeps
the summary and what is trusted as stored.

**A typed ask's answer is the person's words, and a date or clock time the
person (or the app) wrote is exempt in its other spellings. Nothing else is
widened: a value is exempt only when it IS, or respells, something the person
or the app said.** One owner each: `evidenceIndex.ts` · `typedAskAnswerOf`
(read by `addHistoryExempt`, so the corpus and a fold's lineage take it the
same way) and `time/forms.ts` · `timeFormsOf`'s `said` list for a text
(read through `evidenceIndex.ts` · `addExempt`, the exempt corpus's one text
door — until time step T7 this was a table private to this folder,
its `dateAndClockForms` in `normalize.ts`; the job moved, the cases did not).

Why: a person asked "what clients connected to SHISOLPLPAP006 during 10/09/26
8 Am to 8:40 AM PST" and answered the app's typed ask (`requestInput`) with
Date `2026-10-09`. The answer said "8:00 to 8:40 AM … 2026" and was marked
"2 values not traced" — `8:00` and `2026`, both the person's. Three gaps:

1. The typed answer lands as a `role: 'tool'` message (`input_received`), so
   it was read as a tool OBSERVATION, never as the person's words — windowed
   like a result, absent from a fold's lineage, and indexed as the token
   `2026-10-09`, which never matches `2026`.
2. Nothing indexed a date's components.
3. Nothing read `8 Am` (two tokens: `8`, `am`) as the `8:00` an answer writes.

The rules, each a SPELLING and never a reading:

| the person wrote | also exempt | never |
|---|---|---|
| a typed-ask field they answered (`origins[field] === 'response'`) | the value, its tokens, and its spellings below | a field the asking tool supplied (`'declaration'`) — it stays the tool's words, in the evidence corpus; a field the redaction rules hid (it reads as its placeholder) |
| an ISO date `2026-10-09` | `2026`, `10`, `9` | `10/09/2026` or `09/10/2026` — slash order is a locale, and picking one is reading the date |
| `8 Am`, `8:40 AM`, `8pm`, `8:40 p.m.` | `8:00` `08:00` `8:00am` · `8:40` `08:40` · `20:00` `8:00pm` · `20:40` `8:40pm` | a pm reading as its am twin (`8:40 p.m.` never exempts `08:40`) |
| `20:00`, `08:40` | `8:00` `8:00pm` · `8:40` `8:40am` | — the bound: `8:00 PM` tokenizes to `8:00`, so `20:00` also exempts an answer's `8:00`, the same hour on a 12-hour dial |
| `2h`, `90 min` | nothing — a duration is not a time of day (design Q39) | |

The tool-evidence index is NEVER widened by these forms: a tool's timestamp
`2026-10-09` does not ground an answer's year `2026` — that stays the gate's
question. A corpus with no date or clock time in it is byte-for-byte the one
it always was.

```ts
timeFormsOf({ text: 'what connected 8 Am to 8:40 AM PST' }).said;
// ['8:00', '08:00', '8:00am', '8:40', '08:40', '8:40am']
timeFormsOf({ text: '2026-10-09' }).said; // ['2026', '10', '9']
timeFormsOf({ text: 'took 2h' }).said;    // []

// The answer to a typed ask, as `Agent.resume` lands it (with the library's mark):
const answered = {
  role: 'tool', toolCallId: 'c1',
  content: JSON.stringify({
    status: 'input_received', requestId: 'r1',
    values: { date: '2026-10-09' }, origins: { date: 'response' },
  }),
  answersAsk: { requestId: 'r1' },
};
exemptFromRun({ history: [answered] }).has('2026'); // true — the year of their date
exemptFromRun({ history: [answered] }).has('2031'); // false — nobody said it
```

Pinned by `test/core/agent/evidence/person-values-normalized.test.ts` (the
field case end to end, an invented `9:15` and year still flagged, redaction,
the fold's lineage, byte identity).

## Only the answer the library landed counts

**A tool message is the person's typed answer only when it carries the
library's mark, `LLMMessage.answersAsk`, naming the ask its content answers.
The shape of the content never suffices.** One owner: `../../../tools/typedAnswer.ts`
· `landedTypedAnswer`, asked by `typedAskAnswerOf` (so by the corpus and a
fold's lineage) and by the re-ask's previous answer (`tools/inputRequest.ts`
· `repeatOf`). The one writer is the plain resume door
(`../stages/toolCalls/resume/plain.ts` · `resumePlain`), and only when this
run's `Agent.resume` accepted the answer to the ask this run raised. The
re-ask quotes a previous answer back whether or not the evidence gate is on;
the gate's exemption and a summary's lineage are the gate's.

Why: any tool can return `{"status":"input_received", "values": …,
"origins": {…: "response"}}`: a local tool, a remote MCP server (its text
reaches the history unchanged), a page answering a frontend tool. Read by
shape, its values were exempt as the person's words, and a fold carried them
in `foldedExempt`, so after compaction a value the tool supplied stayed
exempt while an ordinary tool value from the same span was flagged.

```ts
const lookalike = {
  role: 'tool', toolCallId: 'c9',
  content: JSON.stringify({
    status: 'input_received', requestId: 'r1',
    values: { date: '2031-05-05' }, origins: { date: 'response' },
  }),
};
exemptFromRun({ history: [lookalike] }).has('2031'); // false — a tool's result
exemptLineageOf([lookalike]);                         // [] — nothing rides a fold
```

- The mark is outside the content, so a tool cannot write it: every tool
  message is built from named fields. `stripFrameworkFields` keeps it off
  every provider request.
- `agent.followUp()` keeps the mark in the live conversation. A saved
  conversation (`run({ continueFrom })`, `resumeOnError()`, a hosted session
  store or a resumed pause) keeps its marks after the checkpoint door
  validates their shape in the history and retained folded originals.
  The gate reads the active history and the summary's saved lineage.
  The retained originals are for inspecting past messages.
  See the [README](README.md) for what the library trusts as stored.
- History written before the mark existed has no marks. A tool result needs
  the mark as well as matching content, even when its request ID is real.

Pinned by `test/core/agent/evidence/typed-answer-mark.test.ts`.
