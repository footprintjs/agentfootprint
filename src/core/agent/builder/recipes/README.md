**Map** — applies declared setup compositions with their provenance and conflict rules.

# Builder recipe application

`apply.ts` owns synchronous application, recursion and duplicate refusals, stack
cleanup and successful manifest attribution. The facade supplies a thunk that
looks up `recipe.configure` after the stack push and passes the actual builder.
`source.ts` attributes registrations and formats their duplicate refusal.

The receiver is the existing builder, including a Proxy; these functions do not
create a replacement configuration object or own another state store.
