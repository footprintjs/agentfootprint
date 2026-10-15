/**
 * toolName — the LLM tool-name law: the charset every major provider enforces,
 * the strict check (`assertValidToolName`) and the dev-mode warning
 * (`warnIfInvalidToolName`) that `defineTool` runs. A leaf so that every
 * layer that mints a tool name — `tools/tools.ts` · `defineTool`, the tool
 * registry, the coverage result's `tryInstead` — asks the same rule.
 */

import { isDevMode } from 'footprintjs';

/**
 * The tool-name charset every major LLM provider enforces (OpenAI, Azure OpenAI,
 * and Anthropic all require `^[a-zA-Z0-9_-]{1,64}$`). A name with a dot, space,
 * slash, colon, or >64 chars makes the provider 400-REJECT the WHOLE request — so
 * EVERY tool vanishes, not just the bad one, and it looks like "my tool isn't
 * visible." We validate at `defineTool` so a bad name fails LOUD here, naming the
 * offending tool, instead of as an opaque provider 400 at run time.
 */
const LLM_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * STRICT validation — throws a clear, actionable error if a tool name can't be
 * sent to an LLM. Exposed for consumers who want to fail hard (e.g. in a build
 * step or a test). The library itself only WARNS (see `warnIfInvalidToolName`),
 * because a name is provider-specific: a mock or a name-sanitizing custom provider
 * may accept dotted/namespaced names that OpenAI/Anthropic reject.
 */
export function assertValidToolName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `defineTool: tool name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  if (!LLM_TOOL_NAME_RE.test(name)) {
    const reason =
      name.length > 64
        ? `it is ${name.length} chars (max 64)`
        : `it contains characters outside [a-zA-Z0-9_-] (e.g. a dot, space, slash, or colon)`;
    throw new Error(
      `tool name ${JSON.stringify(name)} — ${reason}. ` +
        `LLM tool names must match /^[a-zA-Z0-9_-]{1,64}$/ (OpenAI, Azure, and Anthropic all ` +
        `400-reject the whole request otherwise, making every tool disappear). ` +
        `Rename it — e.g. replace '.', ':', '/', or ' ' with '_'.`,
    );
  }
}

/**
 * DEV-MODE heads-up (never throws): warns once-per-call if a tool name will be
 * rejected by OpenAI/Anthropic. Production and non-dev runs pay nothing. This is
 * the library's default guard (Convention: dev diagnostics warn, they don't throw)
 * — keeping mock/custom-provider + namespaced-name setups working. Reach for
 * `assertValidToolName` when you want a hard failure.
 */
export function warnIfInvalidToolName(name: unknown): void {
  if (!isDevMode()) return;
  try {
    assertValidToolName(name);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[agentfootprint] invalid ${(e as Error).message}`);
  }
}
