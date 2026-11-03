**Support** — coerce one pgvector numeric field.

`number.ts` holds the existing numeric conversion used by `../pgVector.ts`.

The law: keep numeric inputs as supplied, parse finite numeric strings, and return zero for the remaining inputs.
