import {
  Agent,
  defineTool,
  type AgentOptions,
  type AgentfootprintEvent,
  type LLMRequest,
  type LLMResponse,
  type Tool,
} from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';

export const VM = 'synthetic-source-correction-vm';
export const QUESTION = `Read disks for ${VM}.`;
export const TOOL = 'read_correction_fixture';
export type Call = LLMResponse['toolCalls'][number];
export const proposal = (id: string, args: Readonly<Record<string, unknown>>): Call => ({
  id,
  name: TOOL,
  args,
});
export const quoted = (id: string, vm = VM, quote = QUESTION): Call =>
  proposal(id, {
    vm,
    _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'user', quote }] },
  });
export const batch = (...toolCalls: Call[]): Partial<LLMResponse> => ({ content: '', toolCalls });
export const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function correctionFixture(
  replies: readonly (string | Partial<LLMResponse>)[],
  options: {
    mode?: 'dynamic' | 'dynamic-grouped';
    findings?: boolean;
    hidden?: boolean;
    configure?: Partial<AgentOptions>;
    extraTools?: readonly Tool[];
  } = {},
) {
  const requests: LLMRequest[] = [];
  const ran: Record<string, unknown>[] = [];
  const events: AgentfootprintEvent[] = [];
  const tool = defineTool({
    name: TOOL,
    description: 'Read a synthetic VM, without external services.',
    inputSchema: { type: 'object', required: ['vm'], properties: { vm: { type: 'string' } } },
    askOrAssume: { vm: { ask: 'Which synthetic VM?' } },
    execute(args) {
      ran.push(jsonCopy(args));
      return [{ ok: true }];
    },
  });
  const actual = options.hidden
    ? {
        ...tool,
        [SHOWN_ARGS]: (args: Record<string, unknown>) => ({ ...args, vm: 'REDACTED' }),
      }
    : tool;
  const provider = mock({
    respond(request) {
      requests.push(jsonCopy(request));
      return replies[requests.length - 1] ?? 'Finished synthetic fixture.';
    },
  });
  const builder = Agent.create({
    ...options.configure,
    provider,
    model: 'mock',
    maxIterations: 8,
    reactMode: options.mode ?? 'dynamic',
  })
    .tool(actual)
    .inputsLayer({ argumentSources: true, declarationCorrection: 'once' });
  for (const extra of options.extraTools ?? []) builder.tool(extra);
  if (options.findings) builder.findings({ argumentSources: true });
  const agent = builder.build();
  agent.on('*', (event) => events.push(jsonCopy(event)));
  return { agent, requests, ran, events };
}

export const stateOf = (agent: Agent) =>
  agent.getSnapshot()?.sharedState as Record<string, unknown>;
export const argumentsOf = (agent: Agent, id?: string) =>
  (agent.findings() as readonly Record<string, unknown>[]).filter(
    (row) => row.kind === 'argument' && (id === undefined || row.toolCallId === id),
  );
