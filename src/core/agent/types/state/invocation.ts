import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { InjectionRecord } from '../../../../recorders/core/types.js';
import type { MemoryIdentity } from '../../../../memory/identity/types.js';
import type { CarriedCallerPolicy } from '../../../../redaction/privateCaller.js';

export interface InvocationState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  maxIterations: number;
  finalContent: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  /**
   * Cache-read tokens accumulated over the run's model calls (9.110.0) —
   * `LLMResponse.usage.cacheRead` summed by `callLLM` beside
   * `totalInputTokens`, so a cache hit is a first-class cost on the record
   * rather than a number a bench has to re-derive from `llm_end` events.
   * VALUE-conditional: written only when the provider reported a
   * `cacheRead` number on a call, so a provider that reports none (the mock,
   * a local model) never writes the key and its record is the bytes it was.
   * On the grouped chart it crosses the LLM_CALL boundary under the same
   * condition (`buildDynamicAgentChart.ts`). Never seeded to zero: absent
   * means "no provider reported cache reads", which is a different fact
   * from "zero tokens were read from cache".
   */
  totalCacheReadTokens?: number;
  turnStartMs: number;
  // Multi-tenant memory scope. Defaulted in seed when AgentInput.identity
  // is omitted, so non-memory agents work unchanged. Field is named
  // `runIdentity` (not `identity`) so it doesn't collide with the
  // readonly `identity` input arg in scope's typed-args view.
  runIdentity: MemoryIdentity;
  /**
   * The namespace's source: caller, transport session, composition or run.
   * Historical absent entries used the caller or per-run default. A session
   * source is checked against the actual transport session on resume; this
   * provenance marker does not authenticate the caller.
   */
  runIdentitySource?: 'caller' | 'session' | 'composition' | 'run';
  /**
   * The run this agent serves as a composition MEMBER (`core/memberRun.ts`) —
   * the composition's run id and the identity its caller named, if any.
   * Written by seed ONLY on a member's run, where it is the source of the
   * facts the member's tools are handed (`ctx.runId`, `ctx.identity`): the
   * instance's own fields describe some other run. Absent on the agent's own
   * runs, which commit exactly the keys they always did.
   */
  memberRun?: import('../../../memberRun.js').ParentRunRecord;
  /**
   * The actual transport session, string or explicit null on every clean14
   * entry. Absence is an unsupported ambiguous checkpoint, never sessionless.
   * The memory identity cannot supply this fact. Stored data is not authority:
   * hosts authenticate and protect checkpoints at their own trust boundary.
   */
  runSessionId?: string | null;
  /**
   * The redaction policy this run is covered by — the agent's own `redact`
   * joined with any the caller handed it (`agent.run(input, { redact })`) — as
   * plain data: names, and patterns only as references to ones the resuming
   * side holds (never compiled from here). Committed by seed ONLY when the
   * run is covered by one, read off the run itself (never the agent instance),
   * and written back by every resumed leg with that leg's whole policy (a
   * `redact` passed to `resume()` included), so a pause's checkpoint carries it
   * and every later leg is covered by it without being handed it again — a
   * pattern of the caller's own excepted, which the resume must name again
   * (`Agent · resume`). A value this library did not write, or none on a
   * checkpoint whose run kept names out, refuses the resume —
   * `ResumeRedactionError`.
   */
  runRedaction?: CarriedCallerPolicy;
  // Set during the final branch — the (user, assistant) pair the
  // memory write subflows persist for cross-run recall.
  newMessages: readonly LLMMessage[];
  // WHICH TURN of this conversation this run is (9.6.0) — an ordinal, not a
  // count, so gaps are legal and repeats are not. Memory writes KEY their
  // entries on it (`msg-{turn}-{index}`), which is why seed resolves it from
  // the conversation it was handed AND from the memory stores themselves
  // rather than seeding a constant 1 as every release through 9.5.1 did.
  turnNumber: number;
  // Token-budget signal used by memory pickByBudget deciders. Defaults
  // to a permissive cap; consumers tune via PricingTable hooks later.
  contextTokensRemaining: number;
  // Populated by slot subflow outputMappers:
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  toolsInjections: readonly InjectionRecord[];
  // Latest LLM response state:
  llmLatestContent: string;
  llmLatestToolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly argumentsFailure?: import('../../../../provider-contract/types.js').LLMResponse['toolCalls'][number]['argumentsFailure'];
    // Carried, never read here (9.29.0). The adapter that produced the call is
    // the only thing that understands this bag; the loop's job is to keep it
    // attached to its call all the way into the assistant turn, because for
    // Gemini it holds the thought signature the NEXT request must echo.
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }[];
  /** Finite resource references only; active borrows and live handles stay private. */
  toolResourceOwner?: import('../../../../tools/toolResourceOwner.js').ToolOwnerCarrier;
  servedToolParties?: import('../../stages/servedParties.js').ServedPartiesCarrier;
}
