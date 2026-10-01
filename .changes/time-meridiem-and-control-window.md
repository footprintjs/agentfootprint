---
type: fixed
---
**A clock range with no AM/PM is no longer offered as a twelve-hour window, and the app's time-control window reaches the model on every request.**
Under `.time({ reader })`, "September 29 8:45 to 8:55" (or "from 8 to 9:30") was also offered as 8:45 AM – 8:55 PM. Two sides that say no meridiem now share one — 8:45–8:55 AM or 8:45–8:55 PM — and cross the half-day only when the right side is earlier on the clock ("11 to 1" → 11 AM – 1 PM, or 11 PM – 1 AM overnight). A bare first side still takes the second side's said meridiem ("8 to 9 PM" → 8 PM – 9 PM).
The window a person sets in the app's time control (`run({ time: { window } })`) was named to the model only when a served tool declared a period. It is a fact about the person's turn, so under `.time()` it is now served on every request of the turn — with each period tool's values when one is served, and the window alone otherwise. Agents without `.time()` are unchanged.
