/**
 * Shared fixture for the script-record tests (design
 * docs/design/2026-10-script-artifact.md): a mock code runner whose answer the
 * test chooses, a scripted mock provider, an agent with the arms the test asks
 * for, and the events and state the assertions read. $0, deterministic.
 */

import { Agent, codeRunnerTool, defineTool, type Tool } from '../../../../../src/index.js';
import { mock } from '../../../../../src/llm-providers.js';
import type {
  CodeResult,
  CodeRunner,
  CodeSession,
  PermissionChecker,
} from '../../../../../src/provider-contract/types.js';

/** What one `execute` is handed. */
export type CodeExecution = Parameters<CodeSession['execute']>[0];
import type { NamesAndNumbersOptions } from '../../../../../src/core/agent/evidence/types.js';
import type { ScriptTravelOptions } from '../../../../../src/core/agent/scripts/types.js';

/** A runner that answers every execution with `answer(code)` (or throws it). */
export function runnerAnswering(
  answer: CodeResult | ((exec: CodeExecution) => CodeResult | Promise<CodeResult>),
): CodeRunner {
  return {
    id: 'answering',
    start: () =>
      Promise.resolve({
        id: 's1',
        execute: (exec: CodeExecution) =>
          Promise.resolve(typeof answer === 'function' ? answer(exec) : answer),
        stop: () => Promise.resolve(),
      }),
  };
}

/** One model turn that calls the code tool with `code` under call id `id`. */
export const callCode = (id: string, code: string, tool = 'run_code') => ({
  content: '',
  toolCalls: [{ id, name: tool, args: { code } }],
  stopReason: 'tool_use' as const,
});

/** The model's final answer. */
export const answer = (content: string) => ({ content });

/** A fenced block, written the way a model writes one. */
export const fenced = (program: string, info = 'python'): string =>
  `\`\`\`${info}\n${program}\n\`\`\``;

export interface ScriptAgentOptions {
  readonly replies: readonly unknown[];
  readonly runner?: CodeRunner;
  readonly tools?: readonly Tool[];
  readonly gate?: NamesAndNumbersOptions;
  readonly travel?: ScriptTravelOptions | true;
  readonly answerLayer?: true;
  readonly maxIterations?: number;
  readonly runnerTimeoutMs?: number;
  readonly checkIn?: 'always';
  readonly permissionChecker?: PermissionChecker;
  readonly outputSchema?: boolean;
}

export interface Captured {
  readonly checks: Array<Record<string, unknown>>;
  readonly turnEnds: Array<Record<string, unknown>>;
  readonly codeRuns: Array<Record<string, unknown>>;
  readonly all: Array<{ name: string; payload: Record<string, unknown> }>;
}

/** An agent over a mock provider, with the code tool and the arms asked for. */
export function scriptAgent(o: ScriptAgentOptions): { agent: Agent } & Captured {
  const checks: Array<Record<string, unknown>> = [];
  const turnEnds: Array<Record<string, unknown>> = [];
  const codeRuns: Array<Record<string, unknown>> = [];
  const all: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const recorder = {
    id: 'capture-scripts',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      const payload = e.payload ?? {};
      all.push({ name: e.name, payload });
      if (e.name === 'agentfootprint.agent.evidence_checked') checks.push(payload);
      if (e.name === 'agentfootprint.agent.turn_end') turnEnds.push(payload);
      if (e.name === 'agentfootprint.tools.code_run') codeRuns.push(payload);
    },
  };
  let builder = Agent.create({
    provider: mock({ replies: o.replies as never }),
    model: 'mock',
    maxIterations: o.maxIterations ?? 8,
    ...(o.permissionChecker !== undefined && { permissionChecker: o.permissionChecker }),
  }).system('You compute with code.');
  const tools =
    o.tools ??
    (o.runner === undefined
      ? []
      : [
          codeRunnerTool({
            runner: o.runner,
            ...(o.runnerTimeoutMs !== undefined && { timeoutMs: o.runnerTimeoutMs }),
            ...(o.checkIn !== undefined && { checkIn: o.checkIn }),
          }),
        ]);
  for (const tool of tools) builder = builder.tool(tool);
  if (o.gate !== undefined) builder = builder.namesAndNumbersFromEvidence(o.gate);
  if (o.travel !== undefined) {
    builder = builder.scriptTravelsWithTheAnswer(o.travel === true ? undefined : o.travel);
  }
  if (o.answerLayer === true) builder = builder.answerLayer();
  if (o.outputSchema === true) {
    builder = builder.outputSchema({ parse: (raw: string) => JSON.parse(raw) as unknown });
  }
  const agent = builder.watch(recorder).build();
  return { agent, checks, turnEnds, codeRuns, all };
}

/** The committed state of the agent's last run. */
export function stateOf(agent: Agent): Record<string, unknown> {
  return (agent.getLastSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
}

/** The `script` rows on the committed ledger. */
export function scriptRows(agent: Agent): Array<Record<string, unknown>> {
  const ledger = stateOf(agent).findingsLedger;
  return (Array.isArray(ledger) ? ledger : []).filter(
    (r: { kind?: unknown }) => r.kind === 'script',
  ) as Array<Record<string, unknown>>;
}

/** A declared code-running tool that RETURNS without executing its argument. */
export const declaredEcho = defineTool<{ code: string }, string>({
  name: 'echo_code',
  description: 'Returns a fixed answer; it never runs the program it is handed.',
  inputSchema: {
    type: 'object',
    properties: { code: { type: 'string' } },
    required: ['code'],
  },
  script: { argument: 'code', language: 'python' },
  execute: () => 'done',
});
