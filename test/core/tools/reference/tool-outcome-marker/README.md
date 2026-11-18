# Tool outcome marker capture

Only `agent-scoped-provider` uses this capture. The earlier complete record
and its manifest stay in `../v14-native-components/`. The existing guarded
byte-identity updater recaptures this case with
`AF_TOOLS_REFERENCE_CASES=agent-scoped-provider`.

The pair differs by one field, `outcome: "refused"`, on the committed ToolCalls
history entry for the unresolved tool call. The manifest binds both byte streams.
The fixture test checks the exact change against the complete earlier record,
and the byte-identity suite compares a live run to the complete new record.
