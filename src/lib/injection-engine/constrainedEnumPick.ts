/**
 * constrainedEnumPick — ONE model call that can only answer from a fixed
 * list (9.19.0). The machinery extracted from `llmClassifier` so the tier-3
 * decider (RouteTurn's out-of-band menu resolver) and the classifier share
 * one enum discipline instead of two drifting copies:
 *
 *   • On a provider that declares `carriesForcedToolChoice`, the pick rides
 *     a forced synthetic tool whose single argument is `enum: allowed` —
 *     the same mechanism the `'tool-forced'` output strategy uses. The
 *     provider constrains generation; an answer outside the enum cannot be
 *     emitted at all.
 *   • On any other provider it is a strict single-line parse validated
 *     against the enum, ONE structured re-ask, then the caller's fallback.
 *
 * An off-enum answer is a PARSE FAILURE, never a pick — this function can
 * never return an id it was not given (the `allowed` list plus `fallback`).
 * Callers put their own "none" sentinel INTO `allowed` (and as `fallback`)
 * so the model can decline explicitly; the sentinel is a first-class enum
 * member on the wire, exactly as `llmClassifier` has always sent it.
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMToolSchema } from '../../adapters/types.js';

/** The synthetic pick tool, named by the caller (the wire shows this name). */
export interface EnumPickTool {
  readonly name: string;
  readonly description: string;
  /** The single argument's name (`'intent'` for the classifier, `'skill'`
   *  for the decider) — a reader of the raw request sees the domain word. */
  readonly argName: string;
  readonly argDescription: string;
}

export interface ConstrainedEnumPickRequest {
  readonly provider: LLMProvider;
  /** Model id for the call. Left unset, the request carries an empty model
   *  id, which only the mock tolerates — name it for any real provider. */
  readonly model?: string;
  /** The catalog/context prompt — WITHOUT the parse instruction; the parse
   *  path appends its own, so both paths read one catalog. */
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  /** The complete enum, the caller's decline-sentinel included. */
  readonly allowed: readonly string[];
  /** Returned on parse failure / off-enum after the one re-ask (callers pass
   *  their decline-sentinel, conventionally `'none'`). */
  readonly fallback: string;
  readonly pickTool: EnumPickTool;
  readonly signal?: AbortSignal;
}

/** Run the pick. Resolves to a member of `allowed`, else `fallback`. */
export async function constrainedEnumPick(req: ConstrainedEnumPickRequest): Promise<string> {
  return req.provider.carriesForcedToolChoice === true ? pickByForcedTool(req) : pickByParse(req);
}

/** The forced-tool path: the provider constrains generation to the enum. */
async function pickByForcedTool(req: ConstrainedEnumPickRequest): Promise<string> {
  const tool: LLMToolSchema = {
    name: req.pickTool.name,
    description: req.pickTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        [req.pickTool.argName]: {
          type: 'string',
          enum: [...req.allowed],
          description: req.pickTool.argDescription,
        },
      },
      required: [req.pickTool.argName],
      additionalProperties: false,
    },
  };
  const resp = await complete(req.provider, {
    systemPrompt: req.systemPrompt,
    messages: req.messages,
    tools: [tool],
    toolChoice: { type: 'tool', name: req.pickTool.name },
    ...(req.model !== undefined && { model: req.model }),
    ...(req.signal !== undefined && { signal: req.signal }),
  });
  const call = resp.toolCalls.find((tc) => tc.name === req.pickTool.name);
  const picked = (call?.args as Record<string, unknown> | undefined)?.[req.pickTool.argName];
  // Off-enum = parse failure, never a pick.
  return typeof picked === 'string' && req.allowed.includes(picked) ? picked : req.fallback;
}

/** The parse path: strict single line, one structured re-ask, then fallback. */
async function pickByParse(req: ConstrainedEnumPickRequest): Promise<string> {
  const instruction = `Answer with EXACTLY one id from this list and nothing else: ${req.allowed.join(
    ', ',
  )}`;
  const first = await complete(req.provider, {
    systemPrompt: `${req.systemPrompt}\n\n${instruction}`,
    messages: req.messages,
    ...(req.model !== undefined && { model: req.model }),
    ...(req.signal !== undefined && { signal: req.signal }),
  });
  const parsed = parseEnumLine(first.content, req.allowed);
  if (parsed !== undefined) return parsed;
  const retry = await complete(req.provider, {
    systemPrompt: `${req.systemPrompt}\n\n${instruction}`,
    messages: [
      ...req.messages,
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content:
          `That answer was not one of the allowed ids. Reply with exactly one of: ` +
          `${req.allowed.join(', ')} — a bare id, no punctuation, no explanation.`,
      },
    ],
    ...(req.model !== undefined && { model: req.model }),
    ...(req.signal !== undefined && { signal: req.signal }),
  });
  return parseEnumLine(retry.content, req.allowed) ?? req.fallback;
}

/** A trimmed single-token answer that IS one of the allowed ids, else undefined. */
function parseEnumLine(content: string, allowed: readonly string[]): string | undefined {
  const line = content.trim().replace(/^["'`]+|["'`.,]+$/g, '');
  return allowed.includes(line) ? line : undefined;
}

/** One `complete()` with only the fields this machinery uses. */
async function complete(
  provider: LLMProvider,
  req: {
    systemPrompt: string;
    messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    tools?: readonly LLMToolSchema[];
    toolChoice?: { type: 'tool'; name: string };
    model?: string;
    signal?: AbortSignal;
  },
): Promise<LLMResponse> {
  const request: LLMRequest = {
    systemPrompt: req.systemPrompt,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.tools !== undefined && { tools: req.tools }),
    ...(req.toolChoice !== undefined && { toolChoice: req.toolChoice }),
    model: req.model ?? '',
    ...(req.signal !== undefined && { signal: req.signal }),
  };
  return provider.complete(request);
}
