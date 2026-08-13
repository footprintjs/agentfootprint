/**
 * presentTool — the SHELL of the auto-attached `present` tool (9.22.0).
 *
 * Pattern: the `skip_step` placeholder, exactly. The tool here carries the
 * schema the model reads; the AUTHORITATIVE work — `head` the ref under the
 * run's scope, compose the description-snapshot result, emit
 * `agentfootprint.artifacts.presented` — lives in the tool-calls stage
 * (`applyPresent` in `stages/toolCalls.ts`), which OVERWRITES this
 * placeholder's result. Bookkeeping lives where the batch order lives: the
 * stage owns the scope, the store, and the typed emit channel; a tool's
 * execute owns none of them.
 *
 * Attached by `buildToolRegistry` ONLY when a store is attached (the
 * `read_skill` seam): a storeless agent never sees the tool, never reserves
 * the name, and is byte-identical.
 *
 * The pure half — `PRESENT_TOOL_NAME`, `presentArtifact`, the snapshot
 * shapes — lives in `src/artifacts/present.ts`, which cannot import core.
 */

import { PRESENT_TOOL_NAME } from '../../artifacts/present.js';
import { defineTool, type Tool } from '../tools.js';

/** Build the placeholder `present` tool. See the module header. */
export function buildPresentTool(): Tool {
  return defineTool<{ ref: string; as: string; label?: string }, string>({
    name: PRESENT_TOOL_NAME,
    description:
      'Hand a stored artifact to the screen instead of writing its contents out. Pass the ' +
      "art_… ref and say how to render it (as: 'bar-chart', 'table', 'image', …); the " +
      'screen redeems the ref itself. Use this to finish an answer whose substance is data ' +
      'you stored — never retype what the store already holds.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'The art_… ref of the stored artifact to present.',
        },
        as: {
          type: 'string',
          description:
            "Consumer vocabulary for how the screen should render it: 'bar-chart', 'table', " +
            "'image', 'markdown', … Say what it is; the screen picks the renderer.",
        },
        label: {
          type: 'string',
          description: "Optional human title for this presentation (e.g. 'Q3 sales by region').",
        },
      },
      required: ['ref', 'as'],
      additionalProperties: false,
    },
    execute: () =>
      'present noted. (Raw placeholder — the agent loop replaces this result with the ' +
      'description snapshot; reading it verbatim means the runner that dispatched present ' +
      'has no artifact store behind it.)',
  }) as unknown as Tool;
}
