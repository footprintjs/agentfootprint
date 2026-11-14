import type { ToolEndPayload } from '../../../../events/payloads.js';
import { toWireJson } from '../../../../lib/wireJson.js';
import type { TurnState } from '../turns/state.js';
import { isPlainObject, toolContentAttrs, type Attrs } from '../attributes/projections.js';

/** `stream.tool_end` as this adapter reads it — every field optional,
 *  because it also takes hand-fed streams. */
export type ToolEndLike = Partial<
  Pick<ToolEndPayload, 'toolCallId' | 'result' | 'modelResult' | 'changedArgKeys' | 'notExecuted'>
> & { readonly toolName?: string; readonly error?: unknown; readonly notDispatched?: unknown };

export function createToolContent(maxContentChars: number, codeRunners: ReadonlySet<string>) {
  /** The proposal as `tool_start` carried it, serialized THEN — a snapshot, so
   *  nothing written into the object later can reach the export. */
  function snapshotArgs(
    toolName: string,
    args: unknown,
  ): {
    readonly toolName: string;
    readonly text?: string;
    readonly chars: number;
  } {
    let text: string | undefined;
    try {
      text = toWireJson(args);
    } catch {
      text = undefined;
    }
    if (text === undefined) return { toolName, chars: 0 };
    return text.length > maxContentChars
      ? { toolName, chars: text.length }
      : { toolName, text, chars: text.length };
  }

  /**
   * `captureToolContent`, for a call that RAN and RETURNED (no `error`, no
   * `notExecuted`): its arguments — the proposal snapshot, with every key a
   * rule changed or the tool's redaction hides (`changedArgKeys`) shown as
   * `'REDACTED'`: withheld, never replaced by a value the event does not
   * carry — and what the model READ (`modelResult` when a rule changed it,
   * else `result`). A code runner's arguments are its generated program and
   * are withheld. A call that failed or never ran exports no content. Shape
   * and size by {@link toolContentAttrs}.
   */
  function toolContent(t: TurnState, p: ToolEndLike, errored: boolean): Attrs {
    const proposal = p.toolCallId !== undefined ? t.proposedArgs.get(p.toolCallId) : undefined;
    if (p.toolCallId !== undefined) t.proposedArgs.delete(p.toolCallId);
    if (errored || p.notExecuted === true) return {};
    const read = Object.prototype.hasOwnProperty.call(p, 'modelResult') ? p.modelResult : p.result;
    return {
      ...argsContent(proposal, p.changedArgKeys ?? []),
      ...toolContentAttrs('result', read, maxContentChars),
    };
  }

  function argsContent(
    proposal:
      | { readonly toolName: string; readonly text?: string; readonly chars: number }
      | undefined,
    changed: readonly string[],
  ): Attrs {
    if (proposal === undefined) return {};
    if (codeRunners.has(proposal.toolName))
      return { 'agentfootprint.tool.args.withheld': 'code-runner' };
    if (proposal.text === undefined)
      return proposal.chars > 0 ? { 'agentfootprint.tool.args.omitted_chars': proposal.chars } : {};
    if (changed.length === 0) return toolContentAttrs('args', proposal.text, maxContentChars);
    let parsed: unknown;
    try {
      parsed = JSON.parse(proposal.text);
    } catch {
      return {};
    }
    if (!isPlainObject(parsed)) return {};
    const shown: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const key of changed) shown[key] = 'REDACTED';
    return toolContentAttrs('args', shown, maxContentChars);
  }

  return { snapshotArgs, toolContent };
}

export type ToolContent = ReturnType<typeof createToolContent>;
