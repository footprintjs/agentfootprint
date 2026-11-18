# Source-contract projection captures

Only `agent-arguments-sources` and `agent-arguments-sources-only` route here. The
ledger capture's prior current cohort is `../findings-reference-context/`; the
sources-only capture's is `../v14-native-components/`. Both complete prior
captures, all other stored JSON and both original manifests remain unchanged.
This is an intentional opted-in contract change, not equality with the older
served source schema.

Both captures were produced by the existing byte-identity updater with exactly
those two names in `AF_TOOLS_REFERENCE_CASES`. The live scenarios, record
projection, volatile-field normalizer, update guard and strict full-record
comparison are unchanged. The new manifest binds both sides and all 66 earlier
JSON files; its separate guard checks those bindings without broadening either
historical manifest's allowance.

Independent pair comparison classified all 56 changed leaves: 30 schema/source
hint/ownership/required entries, four specialized native instruction strings,
and 22 derived receipt measurements. Measurements were recomputed from the
actual saved schemas and system text. No history, trace, stage, scheduling or
other value changed. The ledger's existing native instruction grows by 129
characters; its schema grows by 335 JSON characters/bytes. Sources-only system
text stays unchanged, with the same schema growth.

Run-salted receipt hashes are already masked by the unchanged normalizer, so
these records do not independently prove actual hash values. Public native
request/receipt/recorded-context/served-view tests cover those unmasked hashes.
Later fixture changes require their own explicit review and pair qualification.
