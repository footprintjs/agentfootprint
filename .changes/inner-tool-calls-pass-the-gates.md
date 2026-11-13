---
type: security
---
**A tool called from inside another tool passes the same permission check and tool middleware.** `ctx.tools.call(name, args)` now asks the agent's `permissionChecker` (about `tool_call` and every capability the tool declares) and walks its before-tool middleware links about the inner call, with the inner call's own arguments and under its own id (`<outer call id>#inner-<n>`), through the same functions a call the model makes goes through. Before, an inner call was asked nothing: a tool the checker or a middleware refused to the model ran when another tool called it.

What changes for an app:
- A composed tool (`runbookAsTool`, or any tool using `ctx.tools`) that calls a tool your checker or middleware refuses now gets an `Error` from `ctx.tools.call` naming the tool and the refusal, and the inner tool does not run. A middleware `ask` and a checker's `'halt'` refuse the inner call too: a person cannot be asked from inside another tool, and the halt does not end the run.
- A middleware rewrite of an inner call's arguments is what the inner tool runs with, as for a model call. After-tool links (`onToolResult`) still see only the outer call's result.
- Each inner call files its `permission.check` and `middleware.decision` rows under its own id, and leaves one row in the run's new `innerToolCalls` state (`toolCallId`, `outerToolCallId`, `toolName`, `iteration`, `args`, `entered`, `ended`, `refusedBy`), with or without a gate. Under `conversationRedaction()` that key is kept out of the record whole, as `middlewareDecisions` is. It still fires no `tool_start` / `tool_end`, so nothing that counts the model's calls changes.
- Every `ctx.tools.call` takes its inner id when it starts, a refused one included, so the inner id after a refused inner call is one higher than before.
- The answer account (`accountForAnswer`) no longer reads a `permission.check` filed under another call's id as a verdict on the call it is reading; it does not name inner calls.
