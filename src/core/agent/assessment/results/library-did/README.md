**Mixed** — recorded tool-result limits and their public wording.
Fold maps recorded tool-result limits to witnessed reasons. Lens formats admitted reasons for the person reading the answer.

`libraryResultReasons` reads the current turn's committed receipts for a clipped tool result, an unread placement, and a dataset with unzoned timestamps. It returns a reason and a pointer to the recorded field for each receipt. Both live assessment and replay pass those pointers through the same call and delivery checks. The formatter uses only the receipts admitted by those checks.

Older recordings without these fields contribute no new reasons. The stage reads at most the admitted receipt limit. An explicit overflow marker or a longer recorded list contributes a check-unreachable reason. The stage works without fetching artifacts or reading result text.
