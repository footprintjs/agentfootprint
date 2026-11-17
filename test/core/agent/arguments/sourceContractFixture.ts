import {
  Agent,
  defineTool,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../../../src/index.js';
import { TOOL_BATCH_FRAME_PREFIX } from '../../../../src/lib/saidByPerson.js';
import { validateToolArgs } from '../../../../src/tools/toolArgsValidation.js';

export const VM = 'synthetic-vm-a';
export const QUESTION = `Show virtual disks for VM ${VM}.`;
export const TOOL = 'rvtools_get_vm_disks';
export type Bag = Record<string, unknown>;
export const bag = (value: unknown): value is Bag =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const from = () => [{ argument: 'vm', source: 'user', quote: QUESTION }];
export const flatArgs = (): Bag => ({ vm: VM, from: from() });
export const nestedArgs = (): Bag => ({ vm: VM, _findings: { basis: 'direct', from: from() } });
export const reply = (id?: string, args: Bag = {}): LLMResponse => ({
  content: id ? '' : 'Finished synthetic fixture.',
  toolCalls: id ? [{ id, name: TOOL, args }] : [],
  stopReason: id ? 'tool_use' : 'end_turn',
  usage: { input: 0, output: 0 },
});

/** This is a test consumer of the native framed protocol, never an app parser. */
export function contractIn(content: unknown): Bag | undefined {
  const prefix = `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: No calls in that batch ran. Submit a new batch.\n`;
  if (typeof content !== 'string' || !content.startsWith(prefix) || !content.endsWith('\n]'))
    return;
  try {
    const parsed: unknown = JSON.parse(content.slice(prefix.length, -2));
    return bag(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

/** The authored model proceeds only after the actual native contract explains nesting. */
export function permitsNestedReply(contract: Bag | undefined, ledger: boolean): boolean {
  if (
    contract?.code !== 'source-declaration-required' ||
    JSON.stringify(contract.path) !== JSON.stringify(['_findings', 'from']) ||
    JSON.stringify(contract.missingArguments) !== JSON.stringify(['vm']) ||
    !bag(contract.declarationSchema)
  )
    return false;
  const properties = contract.declarationSchema.properties;
  if (!bag(properties) || !bag(properties._findings)) return false;
  const required = properties._findings.required;
  return (
    Array.isArray(required) &&
    required.includes('from') &&
    (!ledger || required.includes('basis')) &&
    !validateToolArgs({}, contract.declarationSchema).ok &&
    !validateToolArgs(flatArgs(), contract.declarationSchema).ok &&
    validateToolArgs(nestedArgs(), contract.declarationSchema).ok
  );
}

export function sourceTool(ran: Bag[]) {
  return defineTool({
    name: TOOL,
    description: 'Read synthetic disks without an outside source.',
    inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
    askOrAssume: { vm: { ask: 'Which synthetic VM?' } },
    execute(args) {
      ran.push(copy(args));
      return [{ ok: true }];
    },
  });
}

export function buildFixtureAgent(provider: LLMProvider, ran: Bag[], ledger: boolean) {
  const builder = Agent.create({ provider, model: 'claude-sonnet-4-6', maxIterations: 6 })
    .tool(sourceTool(ran))
    .inputsLayer({ declarationCorrection: 'once', ...(!ledger && { argumentSources: true }) });
  if (ledger) builder.findings({ argumentSources: true });
  return builder.build();
}

export function conditionalFixture(ledger: boolean, repeatFlat = false) {
  const ran: Bag[] = [];
  const requests: LLMRequest[] = [];
  const beforeExecution: number[] = [];
  const contracts: (Bag | undefined)[] = [];
  const provider: LLMProvider = {
    name: 'conditional-native-contract-fixture',
    async complete(request) {
      requests.push(copy(request));
      beforeExecution.push(ran.length);
      if (requests.length === 1) return reply('flat-proposal', flatArgs());
      if (requests.length === 2) {
        const notice = request.messages.find(
          (message) => message.role === 'tool' && message.toolCallId === 'flat-proposal',
        );
        const contract = contractIn(notice?.content);
        contracts.push(contract);
        if (repeatFlat) return reply('flat-again', flatArgs());
        if (permitsNestedReply(contract, ledger)) return reply('nested-proposal', nestedArgs());
        return reply();
      }
      if (requests.length === 3 && ran.length === 1) return reply();
      throw new Error('No additional synthetic provider response was authored.');
    },
  };
  return {
    agent: buildFixtureAgent(provider, ran, ledger),
    ran,
    requests,
    beforeExecution,
    contracts,
  };
}
