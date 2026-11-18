**Map** — the closed event-name vocabulary.

# Event registry names

`names.ts` owns the public domain/name constants, moved as one whole unit.
`skillEvents.ts` and `toolEvents.ts` own the typed payload maps for their domains.
The `../registry.ts` facade combines them with the remaining payloads and owns
the event union and exhaustive runtime list. Only the facade and this folder import the sealed unit.
`names.test.ts` compares the exported vocabulary with the actual registered list.
This is file-size step 1 only; the remaining map is still baselined.
