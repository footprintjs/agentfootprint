// Output correction budget.

/**
 * Validate `.outputSchema(…, { retries })`.
 *
 * The ceiling is stated rather than left open: a model that has missed the
 * shape ten times in a row is not going to find it on the eleventh, and the
 * run would be spending real money and real iterations discovering that. When
 * ten is not enough the answer is a different schema or a different model,
 * not a longer loop.
 */
function resolveRetries(retries: number | undefined): number {
  if (retries === undefined) return 0;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error(
      `AgentBuilder.outputSchema: { retries } must be a non-negative integer, got ${String(
        retries,
      )}. It counts corrective re-asks — 0 (the default) means the first answer is the only one.`,
    );
  }
  if (retries > MAX_OUTPUT_RETRIES) {
    throw new Error(
      `AgentBuilder.outputSchema: { retries: ${retries} } exceeds the ceiling of ` +
        `${MAX_OUTPUT_RETRIES}. Each retry is a real turn — a real request, real tokens, real ` +
        `money — and a model that has missed the shape ${MAX_OUTPUT_RETRIES} times running is ` +
        `not about to find it. If that is genuinely not enough, the fix is a simpler schema, a ` +
        `clearer instruction, or a different model.`,
    );
  }
  return retries;
}

/** The stated ceiling on corrective re-asks. See {@link resolveRetries}. */
const MAX_OUTPUT_RETRIES = 10;

export { resolveRetries };
