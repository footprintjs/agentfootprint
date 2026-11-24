import type { LLMToolSchema } from '../../../provider-contract/types.js';
import { ownsReservedArgument } from './reserved.js';
import { RESERVED_ARGUMENT } from './types.js';

/**
 * Why the name is reserved, per arm — the clause the refusal gives. The
 * `.findings()` sentence is the one 9.101.0 shipped, byte for byte.
 */
const RESERVED_BY = {
  findings:
    'with .findings() the framework adds that property to every served tool schema so the ' +
    'model can declare a basis and its standings on it',
  argumentSources:
    'with declared sources (argumentSources: true) the framework adds that property to every ' +
    'tool that declares argument rules (askOrAssume) so the model can say where each argument ' +
    'value came from',
} as const;

/**
 * Refuse, at build and by name, a registry tool whose `inputSchema.properties`
 * already carries the reserved `_findings` argument (9.101.0; declared
 * sources, honesty layer 2).
 *
 * The twin of the `SKIP_STEP_TOOL_NAME` refusal one function down, and armed
 * the same way — only when a feature that reserves the name is on: `.findings()`
 * (every registry schema — `findings/reserved.ts · withFindingsArgument`
 * decorates every served tool) or declared sources (every RULED tool — the arm
 * plants `_findings.from` on those only, and their `ask` sentence and answered
 * note name it). The planters leave a schema that already has the property
 * UNTOUCHED (author wins), so a registry tool declaring it would be served
 * with the author's contract under the reserved name and the model's value on
 * that call would run as the author's argument and file no row — accepted and
 * silently wrong, which is why it is refused here instead. Only REGISTRY
 * schemas: a provider- or MCP-ingested schema is met at dispatch, not at
 * build, and there the author's property wins, recorded by the committed
 * schema itself — the dispatch peel (`toolCalls · peelCall`) asks the same
 * `ownsReservedArgument` and leaves that call's value alone, and every
 * sentence that would name `_findings.from` on that tool is served in its
 * unarmed form. Never at `defineTool` — a registry schema is a shared
 * reference `mcpServe` serves verbatim, and the refusal depends on the arm,
 * which `defineTool` cannot know.
 */
export function assertReservedArgument(
  toolSchemas: readonly LLMToolSchema[],
  arm: keyof typeof RESERVED_BY,
): void {
  for (const schema of toolSchemas) {
    if (ownsReservedArgument(schema)) {
      throw new Error(
        `Agent: tool '${schema.name}' declares the reserved argument '${RESERVED_ARGUMENT}' — ` +
          `${RESERVED_BY[arm]}, and an author's property of the same name would be served in ` +
          `its place and swallow the model's declaration. Rename the argument.`,
      );
    }
  }
}
