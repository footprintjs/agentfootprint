---
type: breaking
---
**Keep the time cutoff a person confirmed.** Timestamp ranges now default to an exclusive upper bound. Saved window facts include the cutoff, its confirmed precision and whether it includes the endpoint. A newly resolved look-back uses the run’s recorded clock and reaches tools in an absolute form. When a tool reads a wider or narrower interval, the time limits line explains the recorded difference.

Migration: For tools that receive confirmed look-backs, declare an ISO or epoch bounds form alongside any duration form. Supply `time.window.end: 'inclusive'` if the selected endpoint belongs to the window, and set `precision: 'minute'` when your control pads a minute selection to seconds. Existing saved windows retain their recorded bounds.
