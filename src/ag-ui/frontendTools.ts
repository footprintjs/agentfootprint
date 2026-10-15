/**
 * frontendTools — tools the PAGE runs (AG-UI "frontend tools"), as tools an
 * agent can be given.
 *
 * A frontend tool does its work in the browser: a date picker, a confirmation
 * dialog, a chart the person adjusts. The server never runs it. Its tool here
 * has no body: a call PAUSES the run, the page receives the call
 * (`RUN_FINISHED { outcome: success, pendingToolCallIds }`), runs it, and sends
 * the result as a `tool` message in its next request, which continues the
 * paused run with that result as the call's answer.
 *
 * WHAT IT CAN NEVER DO. The tool runs nothing on the server, so it holds no
 * server privilege: no credential (`needs`), no artifact (`wants`), no
 * capability. Its NAME and its contract (description, input schema) are the
 * APP's — `agUi({ frontendTools })` allow-lists it — never the page's: a
 * description the model reads is an instruction, and a page does not get to
 * write the agent's instructions. A page that declares a tool the app did not
 * list is refused by name. Its result is the page's word, read by the model
 * like any tool result.
 */

import { defineTool, type Tool } from '../tools/tools.js';
import { pauseHere } from '../core/pause.js';

/** A frontend tool's contract, as the APP declares it. */
export interface AgUiFrontendTool {
  /** What the tool does, in the words the model reads. */
  readonly description: string;
  /** The JSON Schema of its arguments. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** The key a frontend tool's pause carries — how a host knows the run waits on the page. */
const FRONTEND_TOOL_PAUSE = 'agUiFrontendTool';

/** A tool name every provider accepts. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Check the app's frontend tools at construction and return, per name, how to
 * build the tool an agent is given — fresh for every request.
 *
 * @throws TypeError naming the tool when its name or contract is not usable.
 */
export function frontendToolBuilders(
  declared: Readonly<Record<string, AgUiFrontendTool>> | undefined,
): ReadonlyMap<string, () => Tool> {
  const builders = new Map<string, () => Tool>();
  for (const [name, contract] of Object.entries(declared ?? {})) {
    if (!NAME.test(name))
      throw new TypeError(
        `agUi(): frontend tool '${name}' — a tool name is letters, digits, _ and - (at most 64).`,
      );
    if (
      contract === null ||
      typeof contract !== 'object' ||
      typeof contract.description !== 'string' ||
      contract.description.trim().length === 0 ||
      contract.inputSchema === null ||
      typeof contract.inputSchema !== 'object'
    )
      throw new TypeError(
        `agUi(): frontend tool '${name}' needs a description and an inputSchema — the app's ` +
          `own contract, which is what the model is shown.`,
      );
    const { description } = contract;
    const inputSchema = structuredClone(contract.inputSchema) as Record<string, unknown>;
    builders.set(name, () =>
      defineTool({
        name,
        description,
        inputSchema,
        // Runs nothing here: the page runs it, and its result continues the run.
        execute: async () => pauseHere({ [FRONTEND_TOOL_PAUSE]: name }),
      }),
    );
  }
  return builders;
}

/** Does this pause wait on the page — a frontend tool's call? Read from the pause's own data. */
export function isFrontendToolPause(pauseData: unknown): boolean {
  return (
    typeof pauseData === 'object' &&
    pauseData !== null &&
    typeof (pauseData as Record<string, unknown>)[FRONTEND_TOOL_PAUSE] === 'string'
  );
}
