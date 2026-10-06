---
type: fixed
---
**Documentation search builds use a reproducible page order.** Asynchronous
file discovery previously changed Orama's numeric IDs, posting lists and
compressed output size, sometimes failing the unchanged site budget with the
same content. One pure ordering helper now sorts all page indexes by URL and
ID before insertion. Every record, field and searchable term is retained;
equal-score ties follow stable page order instead of filesystem order. A
build-time regression compares complete static exports across permutations.
