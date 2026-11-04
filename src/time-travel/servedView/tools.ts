import type { LLMToolSchema } from '../../provider-contract/types.js';
import { toolsWithheld } from '../../core/agent/composeRequest.js';
import { FORCED_OUTPUT_TOOL_KEY } from '../../core/agent/receipt/receipt.js';
import type { EpochLocation } from '../epochs.js';
import { readAtCall, readRunConstant } from './recordReads.js';

/** A committed tool list, or `undefined` when the key held no array — which is
 *  what makes it a FALLBACK CHAIN and not a merge: the first key that holds a
 *  list is the list this call served, and an empty array is an answer. */
function toolListOf(value: unknown): LLMToolSchema[] | undefined {
  return Array.isArray(value) ? (value as LLMToolSchema[]) : undefined;
}

/** Select the lazy schema fallback, then the recorded forced-tool name. */
export function toolsAt(
  location: EpochLocation,
  served: boolean,
): readonly [
  registered: LLMToolSchema[],
  withheld: ReturnType<typeof toolsWithheld>,
  forced: string | undefined,
] {
  // ── the tools ──────────────────────────────────────────────────────────
  // `dynamicToolSchemas` is the PRE-assembly list. Two rules run after it and
  // both are on the record: a withheld call (the wrap-up, or any call after
  // the evidence revision under an enforcing answer validation —
  // `composeRequest.ts` · `toolsWithheld`) is served no tool, and a
  // 'tool-forced' strategy adds one.
  //
  // TWO committed sources, for the same reason the conversation above has two
  // and with the same ordering rule (9.91.0). The agent charts map the tools
  // slot's output onto `dynamicToolSchemas` at the mount boundary; the
  // message-API charts carry it out under the slot's own name. Reading only
  // the first reported an EMPTY tool list on a chart that served three — a
  // Lens DENYING, about a fact the log holds perfectly well. The agent key is
  // read first and the fallback is reached only when it holds no array, so no
  // agent recording changes.
  const withheld = toolsWithheld(
    readAtCall(location, 'wrapUpAsked', served),
    readAtCall(location, 'toolsOffAfterRevision', served),
  );
  const dynamic =
    toolListOf(readAtCall(location, 'dynamicToolSchemas', served)) ??
    toolListOf(readAtCall(location, 'toolSchemas', served)) ??
    [];
  const registered = withheld !== null ? [] : dynamic;
  const forcedRaw = readRunConstant(location, FORCED_OUTPUT_TOOL_KEY, served);
  const forced = typeof forcedRaw === 'string' && forcedRaw.length > 0 ? forcedRaw : undefined;
  return [registered, withheld, forced];
}
