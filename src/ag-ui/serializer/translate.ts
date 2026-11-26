import type { AgentfootprintEvent } from '../../events/registry.js';
import { unstreamedText } from '../../hosting/unstreamedText.js';
import { toWireJson } from '../../lib/wireJson.js';
import { newScope, takeCall, type Scope, type OpenText } from '../translationScope.js';
import { failedCallWords } from '../toolResultWords.js';
import { argsShownOf } from '../shownArgs.js';
import type { AgUiEvent, AgUiAddress, AgUiMetadata } from '../types.js';
import type { AgUiIdMinter } from '../ids.js';
import type { AgUiSerializerOptions } from './types.js';
import { record, text, resultText, sameMount, compositionStep, isFixedFailure } from './values.js';

export interface EventTranslationContext {
  readonly options: AgUiSerializerOptions;
  readonly root: Scope;
  readonly scopes: Scope[];
  readonly ids: AgUiIdMinter;
  readonly hostDelivery: boolean;
  readonly reasoning: boolean;
  readonly toolErrors: 'withheld' | 'served';
  readonly scopeOf: (path: readonly string[]) => Scope;
  readonly addressOf: (event: AgentfootprintEvent, extra?: Partial<AgUiAddress>) => AgUiMetadata;
  readonly owned: (
    scope: Scope,
    event?: AgentfootprintEvent,
  ) => { timestamp?: number; subagentRunId?: string };
  readonly closeText: (scope: Scope, out: AgUiEvent[]) => void;
  readonly closeReasoning: (scope: Scope, out: AgUiEvent[]) => void;
  readonly closeSteps: (scope: Scope, out: AgUiEvent[]) => void;
  readonly closeScope: (
    scope: Scope,
    out: AgUiEvent[],
    terminal: (id: string) => AgUiEvent,
  ) => void;
  readonly scopesUnder: (path: readonly string[]) => Scope[];
  readonly endScope: (scope: Scope, out: AgUiEvent[], terminal: (id: string) => AgUiEvent) => void;
  readonly unfinished: (id: string) => AgUiEvent;
  readonly openStep: (
    scope: Scope,
    name: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ) => void;
  readonly finishStep: (
    scope: Scope,
    name: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ) => void;
  readonly wholeText: (
    scope: Scope,
    content: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ) => void;
  readonly pushCustom: (event: AgentfootprintEvent, scope: Scope, out: AgUiEvent[]) => void;
  rootCallText: string | undefined;
  rootResult: string | undefined;
  pause: { readonly event: AgentfootprintEvent; readonly scope: Scope } | undefined;
  fatal: string | undefined;
}

export function eventTranslator(
  context: EventTranslationContext,
): (event: AgentfootprintEvent, out: AgUiEvent[]) => void {
  const {
    options,
    root,
    scopes,
    ids,
    hostDelivery,
    reasoning,
    toolErrors,
    scopeOf,
    addressOf,
    owned,
    closeText,
    closeReasoning,
    closeSteps,
    closeScope,
    scopesUnder,
    endScope,
    unfinished,
    openStep,
    finishStep,
    wholeText,
    pushCustom,
  } = context;
  return (event: AgentfootprintEvent, out: AgUiEvent[]): void => {
    const path = event.meta.subflowPath;
    const address = event.meta.runtimeStageId;
    const payload = record(event.payload);
    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        if (path.length === 0) {
          root.isAgent = true;
          return;
        }
        const previous = scopes.find((s) => s !== root && sameMount(s.mount, path));
        if (previous !== undefined) endScope(previous, out, unfinished);
        const parent = scopeOf(path);
        const scope = newScope(
          path,
          ids.next('agent', address).id,
          path.join('/'),
          parent.subagentRunId,
        );
        scope.isAgent = true;
        scopes.push(scope);
        out.push({
          type: 'SUBAGENT_STARTED',
          subagentRunId: scope.subagentRunId as string,
          name: scope.name as string,
          ...(parent.subagentRunId !== undefined && { parentSubagentRunId: parent.subagentRunId }),
          timestamp: event.meta.wallClockMs,
          metadata: addressOf(event),
        });
        return;
      }
      case 'agentfootprint.agent.turn_end': {
        const rootEnd = !hostDelivery && event.meta.rootTurn === true;
        const scope = rootEnd ? root : scopeOf(path);
        if (!scope.isAgent && !rootEnd) {
          // This reader missed the open, and the record doesn't name it as root.
          pushCustom(event, scope, out);
          return;
        }
        closeText(scope, out);
        closeReasoning(scope, out);
        const refused = payload.refused !== undefined;
        const answer = refused ? undefined : text(payload.finalContent);
        if (!hostDelivery && answer !== undefined) {
          const written = scope.streamedText ?? (rootEnd ? context.rootCallText : undefined);
          const rest = unstreamedText(written, answer);
          if (rest !== undefined) wholeText(scope, rest, event, out);
        }
        if (scope === root) {
          context.rootResult = answer;
          closeSteps(scope, out);
          return;
        }
        endScope(scope, out, (subagentRunId) => ({
          type: 'SUBAGENT_FINISHED',
          subagentRunId,
          ...(!hostDelivery && answer !== undefined && { result: answer }),
          timestamp: event.meta.wallClockMs,
        }));
        return;
      }
      case 'agentfootprint.agent.iteration_start':
        openStep(scopeOf(path), `iteration ${String(payload.iterIndex)}`, event, out);
        return;
      case 'agentfootprint.agent.iteration_end':
        finishStep(scopeOf(path), `iteration ${String(payload.iterIndex)}`, event, out);
        return;
      case 'agentfootprint.composition.enter':
        openStep(scopeOf(path), compositionStep(payload.kind, path), event, out);
        return;
      case 'agentfootprint.composition.exit': {
        // A turn under this composition that is still open never answered — a
        // branch a tolerant merge let fail. Said, never left dangling.
        for (const inner of scopesUnder(path)) closeScope(inner, out, unfinished);
        finishStep(scopeOf(path), compositionStep(payload.kind, path), event, out);
        return;
      }
      case 'agentfootprint.stream.llm_start': {
        const scope = scopeOf(path);
        closeText(scope, out);
        closeReasoning(scope, out);
        if (scope === root) context.rootCallText = undefined;
        scope.streamedText = undefined;
        scope.callMessageId = undefined;
        scope.llmAddress = address;
        return;
      }
      case 'agentfootprint.stream.token': {
        if (hostDelivery) return;
        const content = text(payload.content);
        if (content === undefined) return;
        const scope = scopeOf(path);
        const index = typeof payload.tokenIndex === 'number' ? payload.tokenIndex : Number.NaN;
        const open = scope.text;
        if (open === undefined || open.address !== address || !(index > open.lastTokenIndex)) {
          // A new message: the first token of a call, another stage's tokens (an
          // answer released after validation), or a stream that restarted.
          closeText(scope, out);
          const { id } = ids.next('text', address);
          scope.text = { id, address, lastTokenIndex: Number.isNaN(index) ? -1 : index };
          scope.callMessageId = id;
          out.push({
            type: 'TEXT_MESSAGE_START',
            messageId: id,
            role: 'assistant',
            ...owned(scope, event),
            metadata: addressOf(event),
          });
        } else {
          open.lastTokenIndex = index;
        }
        scope.streamedText = (scope.streamedText ?? '') + content;
        out.push({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: (scope.text as OpenText).id,
          delta: content,
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.stream.llm_end': {
        const scope = scopeOf(path);
        if (hostDelivery) return;
        closeText(scope, out);
        // A scope that did not see an agent turn open can already have written
        // the text of a complete-only call by the time its root end arrives.
        const content = text(payload.content);
        const quiet = scope.streamedText === undefined && payload.contentWithheld !== true;
        if (!scope.isAgent && quiet && content) {
          wholeText(scope, content, event, out);
          if (scope === root) context.rootCallText = content;
        }
        return;
      }
      case 'agentfootprint.stream.thinking_delta': {
        const content = text(payload.content);
        if (!reasoning || content === undefined) return;
        const scope = scopeOf(path);
        if (scope.reasoning === undefined || scope.reasoning.iteration !== payload.iteration) {
          closeReasoning(scope, out);
          const { id } = ids.next('reasoning', address);
          scope.reasoning = { id, iteration: payload.iteration };
          out.push({
            type: 'REASONING_START',
            messageId: id,
            ...owned(scope, event),
            metadata: addressOf(event),
          });
          out.push({
            type: 'REASONING_MESSAGE_START',
            messageId: id,
            role: 'reasoning',
            ...owned(scope, event),
          });
        }
        out.push({
          type: 'REASONING_MESSAGE_CONTENT',
          messageId: scope.reasoning.id,
          delta: content,
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.stream.thinking_end': {
        if (!reasoning) return;
        const scope = scopeOf(path);
        if (scope.reasoning !== undefined && scope.reasoning.iteration === payload.iteration) {
          closeReasoning(scope, out);
          return;
        }
        // Nothing streamed for this call: the blocks are the reasoning, one
        // message each, in one span. A redacted block carries no text to show.
        const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
        const thoughts = blocks
          .map((block) => record(block))
          .filter((block) => block.type === 'thinking')
          .map((block) => text(block.content))
          .filter((content): content is string => content !== undefined && content.length > 0);
        if (thoughts.length === 0) return;
        closeReasoning(scope, out);
        const messageIds = thoughts.map(() => ids.next('reasoning', address).id);
        const span = messageIds[0] as string;
        out.push({
          type: 'REASONING_START',
          messageId: span,
          ...owned(scope, event),
          metadata: addressOf(event),
        });
        thoughts.forEach((content, i) => {
          const messageId = messageIds[i] as string;
          out.push({
            type: 'REASONING_MESSAGE_START',
            messageId,
            role: 'reasoning',
            ...owned(scope, event),
          });
          out.push({
            type: 'REASONING_MESSAGE_CONTENT',
            messageId,
            delta: content,
            ...owned(scope, event),
          });
          out.push({ type: 'REASONING_MESSAGE_END', messageId, ...owned(scope, event) });
        });
        out.push({ type: 'REASONING_END', messageId: span, ...owned(scope, event) });
        return;
      }
      case 'agentfootprint.stream.tool_start': {
        const scope = scopeOf(path);
        // The call's arguments are complete: its text message and its reasoning are over.
        closeText(scope, out);
        closeReasoning(scope, out);
        // Every call of one LLM response belongs to ONE assistant message: the
        // call's text message when it wrote any, else a message minted at the
        // LLM call's own address for the first call and held for the rest.
        if (scope.callMessageId === undefined)
          scope.callMessageId = ids.next('text', scope.llmAddress ?? address).id;
        const { id, n } = ids.next('tool', address);
        scope.calls.push({ id, n, address, servedId: payload.toolCallId });
        const toolCallName = text(payload.toolName) ?? '';
        const view = argsShownOf(payload, id, options.toolArguments);
        out.push({
          type: 'TOOL_CALL_START',
          toolCallId: id,
          toolCallName,
          parentMessageId: scope.callMessageId,
          ...owned(scope, event),
          metadata: addressOf(event, view.address),
        });
        out.push({
          type: 'TOOL_CALL_ARGS',
          toolCallId: id,
          delta: toWireJson(view.args),
          ...owned(scope, event),
        });
        out.push({ type: 'TOOL_CALL_END', toolCallId: id, ...owned(scope, event) });
        return;
      }
      case 'agentfootprint.stream.tool_end': {
        const scope = scopeOf(path);
        const call = takeCall(scope, address, payload.toolCallId);
        if (call === undefined) {
          // A result the record cannot tie to a call this run opened — never
          // attached to a call it may not belong to (CUSTOM only if listed).
          pushCustom(event, scope, out);
          return;
        }
        // A frontend tool's result is the one the client sent: it holds it already.
        if (call.client === true) return;
        // A FAILED call's result is the thrown text — a connection string, a
        // stack line, a provider's body. A person reads the fixed words unless
        // the app chose to serve the record's own.
        // Any `error` but an explicit `false` counts — under a policy that
        // selects the key, the flag itself is served as the placeholder.
        const failed =
          payload.error !== undefined && payload.error !== false && toolErrors !== 'served';
        out.push({
          type: 'TOOL_CALL_RESULT',
          messageId:
            call.n < 0 ? ids.next('result', address).id : ids.at('result', call.n, call.address),
          toolCallId: call.id,
          content: failed
            ? failedCallWords(payload)
            : resultText(
                options.toolResults === undefined
                  ? payload.result
                  : options.toolResults(payload, {
                      toolCallId: call.id,
                      ...(typeof payload.toolName === 'string' && { toolName: payload.toolName }),
                    }),
              ),
          role: 'tool',
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.pause.request':
        context.pause = { event, scope: scopeOf(path) };
        return;
      case 'agentfootprint.error.fatal': {
        // Only a FIXED sentence goes to a browser. The record's own fallback
        // quotes the raw thrown message ("The AI call failed: …"), which may
        // hold anything a provider or a tool put in it.
        const said = text(payload.error);
        if (said !== undefined && isFixedFailure(said)) context.fatal = said;
        return;
      }
      default:
        pushCustom(event, scopeOf(path), out);
    }
  };
}
