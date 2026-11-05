/**
 * The table under ADAPT: where each port has an adapter today, and what to implement where it
 * has none. Taken from the service maps in content/docs/infrastructure/. Every name is pinned
 * by scripts/test/stand-film.test.mts, so a renamed export fails the build.
 */
export type AdapterCell = string | { readonly name: string; readonly note: string };

export interface AdapterRow {
  readonly port: string;
  readonly aws?: readonly AdapterCell[];
  readonly google?: readonly AdapterCell[];
  readonly azure?: readonly AdapterCell[];
  readonly local?: readonly AdapterCell[];
  /** the same adapter wherever the agent runs */
  readonly everywhere?: AdapterCell;
  /** the port to implement yourself */
  readonly yours: readonly string[];
}

const recipe = (name: string): AdapterCell => ({ name, note: 'recipe' });

export const ADAPTER_ROWS: readonly AdapterRow[] = [
  {
    port: 'Models',
    aws: ['bedrock'],
    google: ['gemini'],
    azure: ['azureOpenai', 'foundry'],
    local: ['ollama', 'foundryLocal'],
    yours: ['LLMProvider'],
  },
  {
    port: 'Embeddings',
    aws: ['bedrockEmbedder'],
    google: ['geminiEmbedder'],
    local: ['localEmbedder', 'staticEmbedder'],
    yours: ['Embedder'],
  },
  {
    port: 'Memory',
    aws: ['AgentCoreStore', 's3VectorsStore'],
    google: ['memoryBankStore'],
    local: ['RedisStore', 'pgVectorStore', 'sqliteVectorStore'],
    yours: ['MemoryStore'],
  },
  {
    port: 'Sessions',
    aws: ['agentCoreSessions'],
    google: ['firestoreSessions', 'agentEngineSessions'],
    local: ['sqliteSessions'],
    yours: ['SessionLifecycle'],
  },
  {
    port: 'Hosting',
    aws: ['agentCoreRuntimeHost'],
    google: [recipe('nodeHost')],
    azure: ['foundryResponsesHost'],
    local: ['nodeHost', 'httpHost'],
    yours: ['AgentHost'],
  },
  {
    port: 'Credentials',
    aws: ['agentCoreIdentity'],
    google: ['googleIdentity'],
    azure: ['entraIdentity'],
    local: ['vaultCredentials', 'staticTokens'],
    yours: ['CredentialProvider'],
  },
  {
    port: 'Telemetry',
    aws: ['xrayObservability', 'cloudwatchObservability', 'agentcoreObservability'],
    google: [recipe('otelObservability')],
    local: ['otelObservability', 'fileObservability'],
    yours: ['ObservabilityStrategy'],
  },
  { port: 'Tools', everywhere: 'mcpClient', yours: ['McpClient', 'ToolProvider'] },
  { port: 'Permissions', everywhere: 'PermissionPolicy', yours: ['PermissionChecker'] },
];

export const adapterName = (cell: AdapterCell) => (typeof cell === 'string' ? cell : cell.name);

/** Where the full map for each place lives. */
export const ADAPTER_PAGES = [
  { label: 'AWS', href: '/docs/infrastructure/aws' },
  { label: 'Google Cloud', href: '/docs/infrastructure/google-cloud' },
  { label: 'Microsoft Foundry', href: '/docs/infrastructure/microsoft-foundry' },
  { label: 'on-premises', href: '/docs/infrastructure/on-premises' },
] as const;

export const SESSION_STORES_PAGE = '/docs/infrastructure/session-stores';
