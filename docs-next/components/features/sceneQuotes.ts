/* The scenes quote these. scripts/test/stand-film.test.mts runs a scripted agent and fails if they drift. */
export const SCENE_QUOTES = {
  exports: ['Agent', 'anthropic', 'openai', 'ollama', 'withFallback', 'bedrock', 'gemini', 'azureOpenai', 'AgentCoreStore', 'memoryBankStore', 'RedisStore', 'agentCoreIdentity', 'googleIdentity', 'entraIdentity', 'vaultCredentials', 'conversationRedaction', 'PermissionPolicy'],
  methods: ['resumeOnError'],
  /** Keys a run's record really has. conversationRedaction() hides the first three, and the last stays readable. */
  recordKeys: ['userMessage', 'llmLatestContent', 'history', 'maxIterations'],
  /** One plan, two tools, and the start of the answer, as WATCH logs them. */
  events: [
    'agentfootprint.stream.llm_start',
    'agentfootprint.stream.llm_end',
    'agentfootprint.stream.tool_start',
    'agentfootprint.stream.tool_end',
    'agentfootprint.stream.tool_start',
    'agentfootprint.stream.tool_end',
    'agentfootprint.stream.llm_start',
    'agentfootprint.stream.token',
  ],
} as const;
