/**
 * Shared pieces for the inner-call tests (`ctx.tools.call`): a target tool
 * that records what it was entered with, a composing tool, the run's rows,
 * the events of a run and a checker that records what it was asked.
 */
import {
  Agent,
  defineTool,
  type MiddlewareDecision,
  type Tool,
  type ToolExecutionContext,
} from '../../../../src/index.js';
import type {
  PermissionChecker,
  PermissionRequest,
} from '../../../../src/provider-contract/types.js';

export interface Row {
  readonly toolCallId: string;
  readonly outerToolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly args: Readonly<Record<string, unknown>>;
  readonly entered: boolean;
  readonly ended: string;
  readonly refusedBy?: string;
  readonly halted?: true;
}

/** A tool that records every set of arguments it was entered with. */
export function target(name = 'secret', extra: Partial<Tool> = {}) {
  const entered: Record<string, unknown>[] = [];
  const tool = {
    ...defineTool<Record<string, unknown>, string>({
      name,
      description: `the ${name} tool`,
      inputSchema: {
        type: 'object',
        properties: { account: { type: 'string' }, limit: { type: 'number' } },
      },
      execute: (args) => {
        entered.push({ ...args });
        return `${name}-done`;
      },
    }),
    ...extra,
  } as Tool;
  return { tool, entered };
}

/**
 * A composing tool named `name`: runs `body` with `ctx.tools`, records each
 * line it is handed (`ran: …` or `refused: …`), and returns the lines joined.
 */
export function composing(
  body: (
    call: (inner: string, args?: unknown) => Promise<void>,
    ctx: ToolExecutionContext,
  ) => Promise<void>,
  name = 'compose',
) {
  const told: string[] = [];
  const tool = defineTool<Record<string, unknown>, string>({
    name,
    description: 'composes other tools',
    inputSchema: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      if (ctx.tools === undefined) throw new Error('no ctx.tools');
      const call = async (inner: string, args?: unknown): Promise<void> => {
        try {
          told.push(`ran: ${String(await ctx.tools!.call(inner, args))}`);
        } catch (err) {
          told.push(`refused: ${(err as Error).message}`);
        }
      };
      await body(call, ctx);
      return told.join(' | ');
    },
  });
  return { tool, told };
}

/** The model calls `name` once (id `id`), then answers. */
export const callThen = (name = 'compose', id = 'c1', args: Record<string, unknown> = {}) => [
  { toolCalls: [{ id, name, args }] },
  { content: 'done' },
];

/** The run's `innerToolCalls` rows. */
export function rows(agent: Agent): readonly Row[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { innerToolCalls?: readonly Row[] }
    | undefined;
  return state?.innerToolCalls ?? [];
}

/** The run's `middlewareDecisions` rows. */
export function decisions(agent: Agent): readonly MiddlewareDecision[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { middlewareDecisions?: readonly MiddlewareDecision[] }
    | undefined;
  return state?.middlewareDecisions ?? [];
}

/** Every event of the agent's runs, by suffix. */
export function events(agent: Agent) {
  const seen: { type: string; payload: Record<string, unknown> }[] = [];
  agent.on(
    '*' as never,
    ((e: { type: string; payload: Record<string, unknown> }) => {
      seen.push({ type: e.type, payload: e.payload });
    }) as never,
  );
  return {
    of: (suffix: string) => seen.filter((e) => e.type === `agentfootprint.${suffix}`),
  };
}

/** A checker that answers with `answer` and keeps every request it was handed. */
export function checkerOf(
  answer: (req: PermissionRequest) => unknown,
): PermissionChecker & { asked: string[]; requests: PermissionRequest[] } {
  const asked: string[] = [];
  const requests: PermissionRequest[] = [];
  return {
    name: 'policy',
    asked,
    requests,
    check: (req) => {
      asked.push(`${req.capability}:${req.target}`);
      requests.push(req);
      return answer(req) as never;
    },
  };
}

/** The names in a request's sequence, an inner one marked `name*`. */
export function sequenceOf(req: PermissionRequest): string[] {
  return (req.sequence ?? []).map((e) => (e.inner === true ? `${e.name}*` : e.name));
}
