import { copyJson, ownData, readOwnList } from '../../../../../lib/boundedJson.js';
import { canonicalJson } from '../../../../../lib/canonicalJson.js';
import { sha256Hex } from '../../../../../lib/sha256.js';
import type { AskPayload, ToolMiddleware } from '../../../middleware/types.js';
import type { PausedGatePolicy } from '../../../types/state/pause.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';

const fields = ['toolCallId', 'iteration', 'gate', 'permission', 'middleware', 'question'];
type GateAddress = Pick<PausedGatePolicy, 'toolCallId' | 'iteration' | 'gate'>;

export function beforeToolPolicyNames(chain: readonly ToolMiddleware[] | undefined): string[] {
  return chain?.flatMap((link) => (typeof link.onToolCall === 'function' ? [link.name] : [])) ?? [];
}

/** A comparison for the whole shown question. A referred component cannot be compared here. */
export function fingerprintAskedQuestion(ask: AskPayload): string | undefined {
  try {
    const data = copyJson(ask, Infinity, false) as AskPayload;
    if (data.component?.propsRef !== undefined) return undefined;
    return sha256Hex(`agentfootprint/paused-tool-question/v1\u001f${canonicalJson(data)}`);
  } catch {
    return undefined;
  }
}

export function pauseGatePolicy(
  deps: Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolMiddleware'>,
  address: GateAddress,
  ask?: AskPayload,
): readonly [PausedGatePolicy] {
  const question = ask === undefined ? undefined : fingerprintAskedQuestion(ask);
  return [
    {
      ...address,
      permission: deps.permissionChecker !== undefined,
      middleware: beforeToolPolicyNames(deps.toolMiddleware),
      ...(question !== undefined && { question }),
    },
  ];
}

/** Read the pause's policy only for the exact call and gate that own it. */
export function pausedGatePolicyOf(
  raw: unknown,
  address: GateAddress,
): PausedGatePolicy | undefined {
  try {
    const list = readOwnList(raw, 1);
    if (!list || list.unread !== 0 || list.entries.length !== 1) return undefined;
    const row = ownData(list.entries[0], fields);
    const middleware = copyJson(row.middleware, Infinity, false);
    if (
      typeof row.toolCallId !== 'string' ||
      !Number.isSafeInteger(row.iteration) ||
      row.toolCallId !== address.toolCallId ||
      row.iteration !== address.iteration ||
      row.gate !== address.gate ||
      typeof row.permission !== 'boolean' ||
      !Array.isArray(middleware) ||
      !middleware.every((name) => typeof name === 'string') ||
      (row.question !== undefined &&
        (row.gate !== 'ask' ||
          typeof row.question !== 'string' ||
          !/^[0-9a-f]{64}$/.test(row.question)))
    )
      return undefined;
    return {
      ...address,
      permission: row.permission,
      middleware,
      ...(typeof row.question === 'string' && { question: row.question }),
    };
  } catch {
    return undefined;
  }
}
