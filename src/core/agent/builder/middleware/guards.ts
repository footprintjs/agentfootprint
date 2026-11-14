export function assertToolMiddleware(mw: unknown): void {
  const shaped =
    mw !== null &&
    typeof mw === 'object' &&
    typeof (mw as { name?: unknown }).name === 'string' &&
    (mw as { name: string }).name.length > 0;
  const record = mw as Record<string, unknown> | null;
  const hooks =
    shaped &&
    (typeof record?.onToolCall === 'function' || typeof record?.onToolResult === 'function');
  if (!hooks) {
    throw new Error(
      `AgentBuilder.toolMiddleware: expected an object with a non-empty \`name\` and at ` +
        `least one of \`onToolCall(call)\` (decides about the call) or ` +
        `\`onToolResult(call)\` ` +
        `(decides about the result), got ${typeof mw}. The name is what every ledger row ` +
        `and event says decided the call, so it cannot be blank.`,
    );
  }
}

export function assertMiddleware(mw: unknown, method: string, hook: string): void {
  if (
    mw === null ||
    typeof mw !== 'object' ||
    typeof (mw as { name?: unknown }).name !== 'string' ||
    (mw as { name: string }).name.length === 0 ||
    typeof (mw as Record<string, unknown>)[hook] !== 'function'
  ) {
    throw new Error(
      `AgentBuilder.${method}: expected an object with a non-empty \`name\` and a ` +
        `\`${hook}(...)\` method, got ${typeof mw}. The name is what every ledger row and ` +
        `event says decided the call, so it cannot be blank.`,
    );
  }
}
