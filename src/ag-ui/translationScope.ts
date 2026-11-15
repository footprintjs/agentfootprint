/** Per-translation protocol state; never shared with a runner or another request. */
export interface OpenText {
  readonly id: string;
  readonly address: string;
  lastTokenIndex: number;
}

export interface OpenReasoning {
  readonly id: string;
  readonly iteration: unknown;
}

export interface AgUiOpenCall {
  readonly id: string;
  /** Its number in this run — `-1` for a call a paused run opened. */
  readonly n: number;
  readonly address: string;
  readonly servedId: unknown;
  /** Opened by the paused run this one continues: answered by the first result in its scope. */
  readonly resumed?: boolean;
  /** Answered by the CLIENT (a frontend tool): its result is never written back. */
  readonly client?: boolean;
}

/** One agent's turn (or the root of the run), and what is open in it. */
export interface Scope {
  readonly mount: readonly string[];
  /** The AG-UI invocation handle — `undefined` for the root, the parent agent. */
  readonly subagentRunId: string | undefined;
  /** `SUBAGENT_STARTED`'s name and parent — kept so a continuation re-opens it the same. */
  readonly name?: string;
  readonly parentSubagentRunId?: string;
  /** The stage execution of the scope's current LLM call — its message's address. */
  llmAddress: string | undefined;
  /** An agent's turn opened it (the root: only when the run's runner is an agent). */
  isAgent: boolean;
  text: OpenText | undefined;
  /** The text message of the scope's current LLM call — the parent of its tool calls. */
  callMessageId: string | undefined;
  /** A token streamed since the scope's last `llm_start`. */
  streamed: boolean;
  reasoning: OpenReasoning | undefined;
  /** Open step names, in the order they opened. */
  readonly steps: string[];
  /** Open tool calls, most recent last. */
  readonly calls: AgUiOpenCall[];
}

export const newScope = (
  mount: readonly string[],
  subagentRunId: string | undefined,
  name?: string,
  parentSubagentRunId?: string,
): Scope => ({
  mount,
  subagentRunId,
  ...(name !== undefined && { name }),
  ...(parentSubagentRunId !== undefined && { parentSubagentRunId }),
  llmAddress: undefined,
  isAgent: false,
  text: undefined,
  callMessageId: undefined,
  streamed: false,
  reasoning: undefined,
  steps: [],
  calls: [],
});
