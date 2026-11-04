/** The run a capability binding was made in — `undefined` when there is no binding. */
export const madeInRun = (
  bindRun: { readonly runContext?: { readonly runId: string } } | undefined,
) => bindRun?.runContext?.runId;
