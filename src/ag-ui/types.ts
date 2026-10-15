/**
 * types — the AG-UI events this adapter writes, as plain structural types.
 *
 * AG-UI (the Agent–User Interaction protocol, `@ag-ui/core`) is an OPTIONAL
 * peer of this package, so no declaration here imports it: a consumer who
 * only reads these types compiles without it, and nothing in `dist/` names a
 * module they may not have installed. The shapes mirror protocol 1.0 field
 * for field — `test/type-regressions/AgUiEvents.assignability.test.ts`
 * compiles every one of them against `@ag-ui/core`'s own `Event` union, and
 * `test/ag-ui/contract.test.ts` validates every event a real run produces with
 * `@ag-ui/core/schemas` and the official client's verifier.
 *
 * Only the fields this adapter sets are declared. `type` is a string literal
 * here where `@ag-ui/core` uses its `EventType` enum; the wire values are the
 * same strings.
 */

/** The AG-UI protocol version this adapter speaks — stated on `RUN_STARTED`. */
export const AG_UI_PROTOCOL_VERSION = '1.0';

/**
 * Extra information on an event — AG-UI's open `metadata` object. This adapter
 * writes one key, `agentfootprint`, holding the record's ADDRESS for the event
 * (see {@link AgUiAddress}); the key `ag-ui` is the protocol's own.
 */
export interface AgUiMetadata {
  readonly agentfootprint?: AgUiAddress;
  readonly [key: string]: unknown;
}

/**
 * Where an AG-UI event came from in agentfootprint's record: the stage
 * execution and the subflow path — the coordinates a recording, a trace or a
 * commit log is keyed by within its run. Address only: a redaction policy never
 * selects any of it, so it reads the same with or without one. The record's
 * own run id is never written: it counts every run the PROCESS made, and a
 * browser must not learn how many other callers ran.
 */
export interface AgUiAddress {
  /** The stage execution that emitted the source event (`meta.runtimeStageId`). */
  readonly runtimeStageId?: string;
  /** The subflow path of that stage, outermost first (`meta.subflowPath`). */
  readonly subflowPath?: readonly string[];
  /** The tool call's id as the record serves it — the placeholder under a policy. */
  readonly toolCallId?: string;
}

interface AgUiEventBase<T extends string> {
  readonly type: T;
  /** Milliseconds since the epoch — the source event's wall clock. */
  readonly timestamp?: number;
  readonly metadata?: AgUiMetadata;
}

/** Everything a subagent can own carries its invocation handle; absent = the parent agent. */
interface Attributable {
  readonly subagentRunId?: string;
}

export interface AgUiRunStartedEvent extends AgUiEventBase<'RUN_STARTED'> {
  readonly threadId: string;
  readonly runId: string;
  readonly protocolVersion?: string;
}

/** Something a paused run is waiting for. */
export interface AgUiInterrupt extends Attributable {
  readonly id: string;
  readonly reason: string;
  readonly message?: string;
  readonly toolCallId?: string;
  readonly metadata?: AgUiMetadata;
}

/**
 * Why a run ended — absent means success. A success may leave tool calls for
 * the application to answer (a frontend tool): `pendingToolCallIds` names them.
 */
export type AgUiRunOutcome =
  | { readonly type: 'success'; readonly pendingToolCallIds?: readonly string[] }
  | { readonly type: 'interrupt'; readonly interrupts: readonly AgUiInterrupt[] }
  | { readonly type: 'cancelled' };

/** A tool call still open where a run paused. */
export interface AgUiSuspendedCall {
  /** Its AG-UI id — answered under it in the run that continues. */
  readonly toolCallId: string;
  /** Answered by the CLIENT (a frontend tool): its result is never written back. */
  readonly client: boolean;
}

/** One scope open where a run paused — the root, or a sub-agent's turn — and what is open in it. */
export interface AgUiSuspendedScope {
  /** The scope's mount: the subflow path its turn opened at (`[]` for the root). */
  readonly mount: readonly string[];
  /** The sub-agent invocation — absent for the root. */
  readonly subagentRunId?: string;
  /** The sub-agent's name as `SUBAGENT_STARTED` gave it. */
  readonly name?: string;
  /** The sub-agent that spawned it, when one did. */
  readonly parentSubagentRunId?: string;
  /** Its open steps, in the order they opened. */
  readonly steps: readonly string[];
  /**
   * Its open tool calls — the one the pause is about, and a parallel sibling's
   * that paused with it and waits its turn — each answered under its own id.
   */
  readonly calls: readonly AgUiSuspendedCall[];
  /** The assistant message its current model response's calls belong to. */
  readonly messageId?: string;
}

/**
 * What a PAUSED run's translation hands the run that continues it
 * (`agUiSerializer({ resume })`): the ids the paused run gave the client, so the
 * answer can be matched and the continuation is the same invocation —
 * suspended sub-agents re-open under their own `subagentRunId`, open steps
 * re-open, and the call the run stopped in is answered under its own id.
 *
 * Plain JSON — keep it with the paused run (a host stores it beside the
 * checkpoint). It holds ids and step names only, never a value of the run.
 */
export interface AgUiSuspension {
  readonly version: 1;
  /** The AG-UI run that paused. */
  readonly runId: string;
  /** The interrupt the run waits on — absent when it waits on a frontend tool's result. */
  readonly interruptId?: string;
  /**
   * The call the pause is about: its AG-UI id, where it is, and whether the
   * CLIENT answers it (a frontend tool — `pendingToolCallIds`) rather than the
   * run continuing it after the interrupt. It is also among its scope's `calls`.
   */
  readonly call?: AgUiSuspendedCall & { readonly mount: readonly string[] };
  /** The run's root is an agent's turn (its answer is the run's result). */
  readonly rootAgent: boolean;
  /** The scopes open at the pause, outermost first — the root always first. */
  readonly scopes: readonly AgUiSuspendedScope[];
}

export interface AgUiRunFinishedEvent extends AgUiEventBase<'RUN_FINISHED'> {
  readonly threadId: string;
  readonly runId: string;
  readonly result?: unknown;
  readonly outcome?: AgUiRunOutcome;
}

export interface AgUiRunErrorEvent extends AgUiEventBase<'RUN_ERROR'> {
  readonly message: string;
  readonly code?: string;
}

export interface AgUiStepStartedEvent extends AgUiEventBase<'STEP_STARTED'>, Attributable {
  readonly stepName: string;
}

export interface AgUiStepFinishedEvent extends AgUiEventBase<'STEP_FINISHED'>, Attributable {
  readonly stepName: string;
}

export interface AgUiTextMessageStartEvent
  extends AgUiEventBase<'TEXT_MESSAGE_START'>,
    Attributable {
  readonly messageId: string;
  readonly role: 'assistant';
}

export interface AgUiTextMessageContentEvent
  extends AgUiEventBase<'TEXT_MESSAGE_CONTENT'>,
    Attributable {
  readonly messageId: string;
  readonly delta: string;
}

export interface AgUiTextMessageEndEvent extends AgUiEventBase<'TEXT_MESSAGE_END'>, Attributable {
  readonly messageId: string;
}

export interface AgUiToolCallStartEvent extends AgUiEventBase<'TOOL_CALL_START'>, Attributable {
  readonly toolCallId: string;
  readonly toolCallName: string;
  readonly parentMessageId?: string;
}

export interface AgUiToolCallArgsEvent extends AgUiEventBase<'TOOL_CALL_ARGS'>, Attributable {
  readonly toolCallId: string;
  readonly delta: string;
}

export interface AgUiToolCallEndEvent extends AgUiEventBase<'TOOL_CALL_END'>, Attributable {
  readonly toolCallId: string;
}

export interface AgUiToolCallResultEvent extends AgUiEventBase<'TOOL_CALL_RESULT'>, Attributable {
  readonly messageId: string;
  readonly toolCallId: string;
  readonly content: string;
  readonly role: 'tool';
}

export interface AgUiReasoningStartEvent extends AgUiEventBase<'REASONING_START'>, Attributable {
  readonly messageId: string;
}

export interface AgUiReasoningMessageStartEvent
  extends AgUiEventBase<'REASONING_MESSAGE_START'>,
    Attributable {
  readonly messageId: string;
  readonly role: 'reasoning';
}

export interface AgUiReasoningMessageContentEvent
  extends AgUiEventBase<'REASONING_MESSAGE_CONTENT'>,
    Attributable {
  readonly messageId: string;
  readonly delta: string;
}

export interface AgUiReasoningMessageEndEvent
  extends AgUiEventBase<'REASONING_MESSAGE_END'>,
    Attributable {
  readonly messageId: string;
}

export interface AgUiReasoningEndEvent extends AgUiEventBase<'REASONING_END'>, Attributable {
  readonly messageId: string;
}

export interface AgUiSubagentStartedEvent extends AgUiEventBase<'SUBAGENT_STARTED'> {
  readonly subagentRunId: string;
  readonly name: string;
  readonly parentSubagentRunId?: string;
}

export interface AgUiSubagentFinishedEvent extends AgUiEventBase<'SUBAGENT_FINISHED'> {
  readonly subagentRunId: string;
  readonly result?: unknown;
  readonly outcome?:
    | { readonly type: 'success' }
    | { readonly type: 'suspended'; readonly interruptIds?: readonly string[] };
}

export interface AgUiSubagentErrorEvent extends AgUiEventBase<'SUBAGENT_ERROR'> {
  readonly subagentRunId: string;
  readonly message: string;
  readonly code?: string;
}

export interface AgUiCustomEvent extends AgUiEventBase<'CUSTOM'>, Attributable {
  readonly name: string;
  readonly value: unknown;
}

/** Every AG-UI event this adapter writes. */
export type AgUiEvent =
  | AgUiRunStartedEvent
  | AgUiRunFinishedEvent
  | AgUiRunErrorEvent
  | AgUiStepStartedEvent
  | AgUiStepFinishedEvent
  | AgUiTextMessageStartEvent
  | AgUiTextMessageContentEvent
  | AgUiTextMessageEndEvent
  | AgUiToolCallStartEvent
  | AgUiToolCallArgsEvent
  | AgUiToolCallEndEvent
  | AgUiToolCallResultEvent
  | AgUiReasoningStartEvent
  | AgUiReasoningMessageStartEvent
  | AgUiReasoningMessageContentEvent
  | AgUiReasoningMessageEndEvent
  | AgUiReasoningEndEvent
  | AgUiSubagentStartedEvent
  | AgUiSubagentFinishedEvent
  | AgUiSubagentErrorEvent
  | AgUiCustomEvent;

/** The `type` of every AG-UI event this adapter writes. */
export type AgUiEventType = AgUiEvent['type'];

// ─── The request: `RunAgentInput`, as this adapter reads it ───────────────

/** A text part of a message body. */
export interface AgUiTextPart {
  readonly type: 'text';
  readonly text: string;
}

/** A part of a message body: text, or a media part (named so it can be refused by name). */
export type AgUiContentPart =
  | AgUiTextPart
  | { readonly type: 'image' | 'audio' | 'video' | 'document'; readonly [key: string]: unknown };

/** A call an assistant message made. */
export interface AgUiToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** A message of the conversation a request carries, by role. */
export type AgUiMessage =
  | {
      readonly id: string;
      readonly role: 'user';
      readonly content: string | readonly AgUiContentPart[];
    }
  | {
      readonly id: string;
      readonly role: 'assistant';
      readonly content?: string;
      readonly toolCalls?: readonly AgUiToolCall[];
    }
  | {
      readonly id: string;
      readonly role: 'tool';
      readonly toolCallId: string;
      readonly content: string | readonly AgUiContentPart[];
    }
  | { readonly id: string; readonly role: 'system' | 'developer'; readonly content: string }
  | { readonly id: string; readonly role: 'reasoning'; readonly content: string }
  | {
      readonly id: string;
      readonly role: 'activity';
      readonly activityType: string;
      readonly content: Readonly<Record<string, unknown>>;
    };

/** An answer to one interrupt, sent on the run that continues from it. */
export interface AgUiResumeEntry {
  readonly interruptId: string;
  readonly status: 'resolved' | 'cancelled';
  readonly payload?: unknown;
}

/**
 * An AG-UI request (`RunAgentInput`) as the browser sent it — UNTRUSTED. Read
 * by `readAgUiRunInput` (shape and id format), then planned against what the
 * server holds: only the newest USER message, an answer to the pause the
 * server is keeping, the names of tools the app allow-listed, and the
 * `state`/`context` the app's own validators accept are ever used.
 */
export interface AgUiRunInput {
  readonly threadId: string;
  readonly runId: string;
  readonly protocolVersion?: string;
  readonly parentRunId?: string;
  readonly messages: readonly AgUiMessage[];
  readonly tools: readonly { readonly name: string; readonly description?: string }[];
  readonly context: readonly { readonly description: string; readonly value: string }[];
  readonly state?: unknown;
  readonly forwardedProps?: unknown;
  readonly resume?: readonly AgUiResumeEntry[];
}
