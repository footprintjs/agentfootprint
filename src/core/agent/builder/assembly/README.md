# Agent assembly

Runs the original whole-agent checks in order, then calls the facade constructor
with its existing local values and attaches observers and self-explanation.
Contracts, stepped skills, and deferred skill checks each own one ordered unit.
The receiver is the actual builder, never a copied configuration object.
