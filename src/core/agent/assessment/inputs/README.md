# Inputs

The inputs stage reads waiting argument asks, argument verdicts and contingent
values from the current turn's committed record. Admission identifies which
arguments reached execution. The stage uses the argument value that actually
ran when middleware rewrote it and records when the available evidence cannot
establish a check.

The fold adds input reasons and their witness pointers to its shared
accumulator. It gives the same admitted argument rows to the results period
checks. The contingent ledger read keeps its position in the fold so witness
and check order remain stable.
