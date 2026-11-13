---
type: changed
---
**A check-in tells the person which argument values the tool hides, and the decision records it.** A tool can hide argument values from everything the run shows (`flowchartAsTool({ redact })`, `runbookAsTool({ redact })`). A check-in on such a tool showed the person `to: 'REDACTED'` and ran with the real account on approval, but nothing said which values were hidden: a real argument whose value is the string `'REDACTED'` looked exactly like a hidden one, and the decision's record could not tell an approval given on a hidden view from one given on the whole call.

What changes for an app:

- `CheckInRequest` gains `hiddenArgs` — the names of the arguments the tool's view hides, absent when nothing is hidden. It is read from the view, never from the shown text, so a real `'REDACTED'` value is not listed and a hidden one always is. Show it next to the arguments on your approval screen.
- The built-in evidence assemblers (`'standard'`, `'minimal'`) now end `evidence.willDo` with one fixed sentence when values are hidden: `Values hidden from this view: <names>. The call runs with the real values.` A screen or test that compared `willDo` for such a tool sees the new ending. A custom assembler receives the names as `CheckInAssemblerInput.hiddenArgs` and writes its own words.
- The `agentfootprint.checkin.decision` event (`CheckInDecisionPayload`) and `CheckInRecorder`'s decision record (`CheckInDecisionRecord`) gain the same `hiddenArgs`, so a later reader can tell the decision was given without seeing those values. They are read again on resume from the tool the call resolves to and the bound arguments the approval is tied to; a decision for a tool the resumed agent no longer has carries none. A checkpoint saved before this version needs nothing: the names are not stored in it.

Nothing else about hiding changes: the same values are shown, the call runs with the real values, and the approval stays bound to the exact call. Tools without an argument view are byte-identical. Names only ever travel — no hidden value reaches the request, the sentence, an event, the record, a log line or an error message.
