**Mixed** — expose public runner views and its static self-explain binding.
`owner.ts` is the **Fold** of snapshots and group metadata and the **Map** of
the declared binding and static service accessors.

The original native runner supplies served snapshots. No replacement run
identity or latest-value cache is introduced. The existing getLastSnapshot
scenarios now live beside the owner.
