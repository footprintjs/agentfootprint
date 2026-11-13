# Tools setup

Known inner-run lookups. Collect static and skill stores by object identity, preserving order and their live contents. Dynamic provider tools are not a build-time catalog.

`register.ts` preserves static-tool uniqueness and recipe attribution.
`provider.ts` records at most one dynamic tool provider. Both operate on the
original builder receiver; neither executes or discovers tools. Adjacent
`register.test.ts` covers registration identity, attribution, refusal and provider
declaration without discovery.
