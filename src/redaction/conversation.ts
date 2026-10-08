/**
 * conversationRedaction — the names an agent's record carries the
 * conversation under, as one footprintjs `RedactionPolicy`.
 *
 * Pattern: a vocabulary the library owns, handed out as data (a policy), with
 *          the caller's own selectors joined on (`unionRedactionPolicies`).
 * Role:    the Map half of `src/redaction/` for the question "what do I name
 *          to keep the conversation out?" — `Agent.create({ redact })` is the
 *          one door; this is the value most callers hand it.
 *
 * WHY THE LIBRARY OWNS THE LIST. footprintjs selects by NAME: a policy keeps a
 * value out of every record when it names the state key, or the event field
 * (at any depth), the value travels under. An agent's record carries the
 * conversation under many names, nearly all of them the library's own — the
 * person's message, the model's words and thinking, tool arguments and
 * results, what memory and retrieval recalled, what was injected into the
 * model's context, a paused call's arguments, the draft a schema check
 * rejected. A caller cannot be expected to know them; the library can, and
 * `test/redaction/agent-redaction.vocabulary.test.ts` runs each feature listed
 * in `CONVERSATION_FEATURES` with a canary in every place the conversation
 * goes, and fails when a canary reaches any record.
 *
 * WHAT IS NOT ON IT, by design:
 *   - values an app's own tools or rules put in the record under names of
 *     their own (a tool's result is covered by `result`, but a field inside an
 *     event your middleware emits is yours to name) — join them:
 *     `conversationRedaction({ patterns: [/ssn|email/i] })`;
 *   - error text written by code (`error`, `errorMessage`, `lastError`): a
 *     message a tool or provider throws can quote what it failed on, and
 *     `error` also names a flag the record's readers count on
 *     (`stream.tool_end`'s `error: true`). A parser message that quotes the
 *     model's draft IS covered: it is served as the placeholder whenever the
 *     draft (`rawOutput`) is kept out (`served.ts` · `DERIVED`);
 *   - structure: ids, counts, kinds, tool names, timings and verdict words
 *     stay readable — the record still shows WHAT happened, without the words;
 *   - content the library quotes under names of its own (a validation issue's
 *     quoted argument, a check-in's evidence pack, a matcher's witness, a
 *     route guard's judged result, the words of a tool's coverage declaration
 *     and a described result's data on their events, …) is not named here:
 *     generic names (`value`, `text`, `note`, `checked`) would hide structure
 *     across every event. It is kept out with the value it came from
 *     (`served.ts` · `DERIVED`).
 *
 * Names it shares with structure, kept out with it: `permission.check`'s
 * `result` (its verdict word — a refused call still reads as refused, from
 * `stream.tool_end`'s `notExecuted`).
 */

import type { RedactionPolicy } from 'footprintjs';
import { RedactionRule } from 'footprintjs/advanced';

import { assertRedactionPolicy, unionRedactionPolicies } from './policy.js';

/** The features whose records the vocabulary is proven against, by the test above. */
export const CONVERSATION_FEATURES: readonly string[] = Object.freeze([
  'the turn (message, answer, history, streamed tokens)',
  'tools (arguments, results, tool-result rules, a paused call)',
  'model thinking',
  'asking a person (askHuman) and resuming',
  'the inputs layer (an argument the person is asked for)',
  'structured output (schema retries, the output fallback)',
  'memory (episodic, semantic, summarize, top-k) and retrieval (RAG)',
  'the evidence gate (names and numbers)',
  'a tool’s declared coverage and described results (absent, coverage, describedResult)',
  'compaction (the window folding the conversation)',
  'a person approving a call (check-in)',
  'skill graphs (routing on the person’s words)',
  'compositions (Sequence, Parallel, Conditional, Loop, Graph)',
]);

/**
 * The state keys and event fields the conversation travels under, grouped by
 * where it comes from. A key names a state key AND an event field of that
 * name at any depth (footprintjs's by-name law).
 */
const NAMES = {
  /** The turn itself: what the person wrote, what the model wrote, the window. */
  turn: [
    'message',
    'messages',
    'userMessage',
    'userPrompt',
    'history',
    'newMessages',
    'content',
    'llmLatestContent',
    'llmLatestToolCalls',
    'finalContent',
    'answer',
    'response',
    'assembledSystem',
    'assembledMessages',
  ],
  /** The window: what a compaction folded away, kept word for word beside its summary. */
  window: ['foldedSpans'],
  /** What the model was given: injected context, the assembled system prompt. */
  context: [
    'rawContent',
    'contentSummary',
    'systemPromptText',
    'systemPromptInjections',
    'messagesInjections',
    'activeInjections',
    'resolvedInstructions',
    'slotCompositions',
    'droppedSummaries',
  ],
  /** The model's thinking. */
  thinking: ['thinkingBlocks', 'rawThinking', 'blocks'],
  /** Tool calls: what they took, what they returned, what a rule saw. */
  tools: [
    'args',
    'result',
    'modelResult',
    'lastToolResult',
    'toolResults',
    'toolCalls',
    'middlewareDecisions',
    'pausedToolArgs',
    'pausedAskArgs',
    'pausedCheckInArgs',
    'pausedCredentialArgs',
    'policyHaltArgs',
    'claimFacts',
    'findingsLedger',
    // The inputs layer's raw answers, held in working state until the calls run
    // (`core/agent/arguments/README.md`).
    'argumentAsk',
    'argumentAnswersKept',
    'argumentResolutions',
  ],
  /**
   * What a tool declared it checked and did not, as state: words the tool
   * composes from its call and its result (`absent()`'s own example quotes its
   * arguments) — every declaration of the run, and a typed answer's limits.
   */
  coverage: ['coverageDeclared', 'answerCoverage'],
  /** A person asked mid-run, and their reply. */
  pause: ['questionPayload', 'resumeInput'],
  /** Checks over the answer: the draft a schema rejected, the values a gate flagged. */
  checks: [
    'rawOutput',
    'rawOutputPreview',
    'primaryErrorMessage',
    'fallbackErrorMessage',
    'outputAttempts',
    'outputSchemaFailure',
    'outputContractUnmet',
    'reliabilityFailCauseMessage',
    'unsupported',
    'unsupportedValues',
    'evidenceRecovery',
    'evidence',
    'explanation',
    // The values a guarding evidence gate found unsupported in the draft.
    'evidenceUnsupported',
  ],

  /** Memory and retrieval: what was loaded, chosen, formatted and written. */
  memory: [
    'loaded',
    'selected',
    'formatted',
    'retrieved',
    'newFacts',
    'loadedFacts',
    'newBeats',
    'loadedBeats',
    'newMessageEmbeddings',
    'runEvidence',
    'scoreEvidence',
  ],
  /** Mounted maps: the engagement standing quotes the words that founded it. */
  maps: ['mapEngagement', 'nextMapEngagement'],
  /** Compositions: what one member hands the next. */
  compositions: [
    'current',
    'results',
    'branchResults',
    'graphInput',
    'routerInput',
    'handoffMessage',
    'echoedMessage',
    'routingReason',
    'packed',
    'resultSummary',
  ],
} as const;

/**
 * Keys named per memory or retrieval definition — `memoryInjection_<id>`,
 * `retrievalEvidence_<id>` (`memory/define.types.ts` · `memoryInjectionKey`,
 * `retrievalEvidenceKey`) — matched by their prefix.
 */
const PATTERN_PREFIXES: readonly string[] = ['memoryInjection_', 'retrievalEvidence_'];
const PATTERNS: readonly RegExp[] = PATTERN_PREFIXES.map((prefix) => new RegExp(`^${prefix}`));

/**
 * State keys whose STRUCTURE stays readable while one field quotes the
 * conversation: the turn's routing verdict keeps its decision and drops the
 * words a matcher found (`fields` — footprintjs's per-key field selector).
 */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  turnRoute: ['witness'],
};

/** The vocabulary as one frozen policy. */
const CONVERSATION: RedactionPolicy = Object.freeze({
  keys: Object.freeze(Object.values(NAMES).flat()) as string[],
  patterns: Object.freeze([...PATTERNS]) as RegExp[],
  fields: Object.freeze(
    Object.fromEntries(Object.entries(FIELDS).map(([key, paths]) => [key, [...paths]])),
  ) as Record<string, string[]>,
});

/**
 * The policy that keeps an agent's conversation out of every record it
 * retains or serves — joined with `extra`, the names your own app adds.
 *
 * Hand it to the one door, `Agent.create({ redact })`. What it covers, what it
 * leaves readable and what it does not name are in this file's header and in
 * `src/redaction/README.md`.
 *
 * @param extra  your own selectors (`keys`, `patterns`, `fields`,
 *               `emitPatterns`, `diagnostics`), validated like `redact`
 *               itself; joined, never replacing the library's names.
 * @returns a frozen `RedactionPolicy`.
 *
 * @example
 * ```ts
 * import { Agent } from 'agentfootprint';
 * import { conversationRedaction } from 'agentfootprint/security';
 *
 * const agent = Agent.create({
 *   provider,
 *   model: 'claude-sonnet-4-5',
 *   redact: conversationRedaction({ patterns: [/ssn|email|phone/i] }),
 * }).build();
 * ```
 */
export function conversationRedaction(extra?: RedactionPolicy): RedactionPolicy {
  if (extra === undefined) return CONVERSATION;
  assertRedactionPolicy(extra, 'conversationRedaction');
  return unionRedactionPolicies(CONVERSATION, extra) as RedactionPolicy;
}

/**
 * Whether `policy` keeps an agent's WHOLE conversation out of its records —
 * every name the vocabulary lists selected by its rule (a pattern of the
 * policy's own that covers a name counts), `conversationRedaction()` or more.
 *
 * The question a chart-backed tool asks before it hands the MODEL a value the
 * calling run's policy selects (`core/servableSnapshot.ts` ·
 * `modelFacingState`): the value travels on in the calling run's conversation
 * — the tool's result in its history and events, whatever the model then
 * says — so only a calling run whose records keep the conversation out keeps
 * that value out of them too.
 *
 * @internal
 */
export function keepsConversationOut(policy: RedactionPolicy | undefined): boolean {
  if (policy === undefined) return false;
  const rule = new RedactionRule(policy);
  // Each pattern's own prefix stands for every key it names (`<prefix><id>`).
  const names = [...(CONVERSATION.keys ?? []), ...PATTERN_PREFIXES.map((p) => `${p}x`)];
  return names.every((name) => rule.isKeyRedacted(name));
}
