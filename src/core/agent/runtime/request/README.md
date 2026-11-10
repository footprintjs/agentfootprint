**Walker** — `factory.ts` binds request assembly to the native component whose call is executing.

Static provider declarations may be captured at build time. Request, receipt,
checkpoint and integrity facts come from the supplied invocation; the tool
schema is still a live accessor. The native component retains the existing
memoization. `factory.test.ts` is the unchanged configure scenario suite,
moved beside this owner, and checks committed configuration against actual requests.
