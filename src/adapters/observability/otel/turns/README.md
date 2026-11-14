**Support** — per-strategy turn retention and envelope metadata reads.

`state.ts` owns the live maps, tool-name sets, and bounded closed/forgotten
windows. All handlers receive those same references, never a copied or latest
run. `metadata.ts` reads the existing run anchor and nonempty session id and
projects the already chosen conversation id.

The rule: retain the named turn through its declared window and distinguish
an unsampled run from an unknown or forgotten run. A flow decision without a
run id can join only a sole active turn. The adjacent tests pin that boundary.
