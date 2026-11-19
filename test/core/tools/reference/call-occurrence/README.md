# Recorded call addresses

`additions.json` pins the occurrence fields added to the existing tool records.
Each entry holds an object path and its expected value. The byte-identity test
reconstructs the full expected record from the historical capture and these fields.
The four random words of a batch address become a shared ordinal. The call slot
and the saved argument pause's `callAddresses` array retain their original values.

The existing capture command requires explicit scenario names. For example,
refresh the static-tool scenario from the repository root with

```sh
AF_TOOLS_REFERENCE=update AF_TOOLS_REFERENCE_CASES=agent-dynamic-static-tool \
  npx vitest run test/core/tools/byte-identity.test.ts -t agent-dynamic-static-tool
```

The command checks the complete record against the historical capture and the
occurrence additions before writing the new entries.
