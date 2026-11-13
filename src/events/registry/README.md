# Event registry names

`names.ts` owns the public domain/name constants, moved as one whole unit.
The `../registry.ts` facade retains the payload map, event union and exhaustive
runtime list. Only the facade and this folder import the sealed unit.
`names.test.ts` compares the exported vocabulary with the actual registered list.
This is file-size step 1 only; the remaining map is still baselined.
