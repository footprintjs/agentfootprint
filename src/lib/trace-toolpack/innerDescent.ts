/**
 * innerDescent — the ONE way the toolpack opens a record that sits BELOW the
 * run it serves.
 *
 * Pattern: one-slot memo + param-shaped dispatch + a frame said out loud.
 * Role:    shared by the two entry points that descend —
 *          `inspect_tool_run` (the record a chart-as-tool kept of its own run)
 *          and `inspect_subflow` (a subflow mount's own commit log). Each entry
 *          point decides only WHAT it opens and how to name it; opening,
 *          asking and framing happen here, once, so the two descents cannot
 *          drift into two vocabularies.
 *
 * WHY THE INNER VIEW IS THE PACK ITSELF. An inner record is a run like any
 * other: a commit log, an execution tree, a fold base. So the inner views are
 * the pack's own tools, built over the inner artifact bag — there is no second
 * implementation of "what did this step write", and the reason codes come out
 * of the same basis twins, folded from the INNER record's own `initialState`.
 *
 * WHY ONE SLOT. Three questions into one inner record build one index; the
 * memo pins at most one inner pack beyond what the snapshot already holds.
 */

import type { Tool } from '../../core/tools.js';
import type { TraceToolpackArtifacts } from './types.js';

/** What the model asked of an inner record — the narrowest param wins. */
export interface InnerQuestion {
  readonly runtimeStageId?: string;
  readonly key?: string;
  readonly variable?: string;
  readonly find?: string;
}

/** How an entry point names what it opened — three lines, said every time. */
export interface InnerFrame {
  /** What was opened, and how big it is. */
  readonly header: string;
  /** The moves that stay inside it. */
  readonly next: string;
  /** Whose ids these are — and that the outer tools do not take them. */
  readonly namespace: string;
}

/** `callTraceTool`, injected so this module does not import the pack. */
export type CallTraceTool = (
  tools: readonly Tool[],
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

/** Open (or reuse) the inner pack for `id`; a string is an honest refusal. */
export type InnerPackSlot = (
  id: string,
  open: () => TraceToolpackArtifacts | string,
) => Tool[] | string;

/**
 * One inner pack at a time, memoised by the id it was opened under. `open`
 * runs only on a miss, and a refusal (a string) is never memoised — the next
 * ask tries again rather than repeating a stale "could not open".
 */
export function innerPackSlot(build: (artifacts: TraceToolpackArtifacts) => Tool[]): InnerPackSlot {
  let memoId: string | undefined;
  let memoTools: Tool[] | undefined;
  return (id, open) => {
    if (memoTools !== undefined && memoId === id) return memoTools;
    const artifacts = open();
    if (typeof artifacts === 'string') return artifacts;
    memoId = id;
    memoTools = build(artifacts);
    return memoTools;
  };
}

/**
 * Ask an opened inner pack one question. Param-shaped dispatch (the
 * `backtrack({ element })` precedent): the narrowest question asked wins, and
 * no params at all is the entry point — the inner `run_overview`. A `key`
 * without a step is "who wrote it last in there" (`who_wrote`).
 */
export async function askInner(
  tools: readonly Tool[],
  question: InnerQuestion,
  call: CallTraceTool,
): Promise<string> {
  const { runtimeStageId, key, variable, find } = question;
  if (find !== undefined) return call(tools, 'find_in_trace', { query: find });
  if (variable !== undefined) return call(tools, 'backtrack', { variable });
  if (runtimeStageId !== undefined && key !== undefined) {
    return call(tools, 'get_value', { runtimeStageId, key });
  }
  if (runtimeStageId !== undefined) return call(tools, 'trace_node', { runtimeStageId });
  // A key with no step asks who wrote it LAST in there — the writer, its value,
  // and the reason codes the basis twins attach.
  if (key !== undefined) return call(tools, 'who_wrote', { key });
  return call(tools, 'run_overview', {});
}

/** The answer, inside its frame. */
export function framed(frame: InnerFrame, body: string): string {
  return [frame.header, body, frame.next, frame.namespace].join('\n');
}
