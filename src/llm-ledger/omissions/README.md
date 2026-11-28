# Delivered-answer coverage

The host delivery chart asks this module to count missing disclosures on the
matched submit. It uses the admitted citation links, the shared interval sweep
and only the disclosures the host attests were delivered. It records a decision
and counts without copying source data or replacing claim-level checks.

An internal session must opt in with both `disclosedGaps: true` and
`coverageOmissions: true`. For a matching delivery, the host may attach
`coverage: { submit, standing, disclosures }`. Draw each disclosure’s
`note`, `kind` and `receipts` from the answer that actually rendered. Bind
a typed note only when the answer expressed its entire extent. Withhold the
binding for a shorter rendering; a separate admitted note can represent it.

A missing attestation leaves coverage unassessed. A stale submit sequence
refuses the input even when two drafts had identical bytes. A mismatched
digest keeps the normal delivery comparison and contributes no assessment.
The answer assessment counts omissions and unassessed parts independently
of claim-level values. A clean assessment does not verify an answer.
