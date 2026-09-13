# Collect typed inputs without losing the request

```bash
npm run example examples/features/70-typed-input.ts
```

This mock example pauses a dedicated collection tool for a year and timezone.
The first typed reply supplies only the year: the checkpoint changes, with no
new model call or tool execution. The second supplies the timezone and resumes
the original tool boundary with an `input_received` result. The collecting
handler executes once and the original user request remains attached.

`requestInput` validates scalar types and declared choices. The application
owns date defaults, timezone validity and query authorization. Use a separate
query tool after collecting input; code after `requestInput()` does not run on
resume. See the [input guide](../../docs-next/content/docs/build/input-requests.mdx)
for hosted replies, reload, explicit cancellation and cleanup.
