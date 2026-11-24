---
type: added
---
Tool discovery retains a built-in ledger gate’s original decision for each eligible implementation. Opaque gates conceal inner decisions, and a failed listing clears earlier evidence.
An inactive built-in skill scope can retain the visible skill’s registered tool identity at the same discovery boundary.
An actual top-N pick retains the eligible tools it excluded, bound to that slot’s winning implementations.
Distinct visible implementations that compete for a name retain their winner and loser identities. Tool collision events omit role-hidden skill claims.
An omitted visible name is associated with the accepted model response only when the adapter confirms which names it offered.
Saved model-call receipts can now show which visible tools a top-N pick, skill scope or ledger decision left out of that particular request. When a registered implementation wins a name, the receipt separately lists each visible competing implementation that lost it, with the winning and losing channels.
The receipt also covers a visible tool scoped directly to a skill while that skill awaits activation through `read_skill`.
The served read_skill schema and saved catalog now list only role-visible skills. Visible off-route choices still receive the graph’s routing explanation. When a decision tree withholds the catalog, the accepted request can record the visible skill IDs, reason and retained count.
