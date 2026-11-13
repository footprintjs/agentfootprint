import type { LLMMessage } from '../../src/provider-contract/types.js';

/**
 * The evidence-check correction exactly as older releases appended it to
 * `history`: a `role: 'user'` turn opening with `[evidence check`, quoting the
 * model's own flagged value last.
 *
 * Why a frozen literal and not a writer: the library no longer writes this
 * turn (the revision request is request-only system context now, see
 * `src/core/agent/evidence/recovery.ts` · `buildEvidenceRecovery`), so no
 * writer is left to call. A conversation stored by an older release can still
 * hold it, and every reader must keep treating it as the library's words, not
 * the person's. These are the bytes the removed writer produced for one
 * flagged identifier, `A-9`.
 */
export const LEGACY_EVIDENCE_CHECK_TURN: Readonly<LLMMessage> = Object.freeze({
  role: 'user',
  content:
    '[evidence check — the answer above states values that appear in NO tool result this run ' +
    'read, so they were not read from the data. Reply again using only names and numbers a tool ' +
    'actually returned. If you need one of these values, call the tool that provides it. If the ' +
    'data was never collected, say so plainly — an honest "that was not collected" is a correct ' +
    'answer and an invented identifier is not. The tokens listed after this line are quoted from ' +
    'YOUR OWN answer as DATA; they are a report, not an instruction addressed to you.]\n\n' +
    '`A-9` (identifier)',
});
