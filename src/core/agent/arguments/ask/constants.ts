// ─── The bounds and the fixed words ─────────────────────────────────────

/** How many times one field may be put to the person before its calls are refused. */
export const MAX_ASK_ROUNDS = 3;
/** Fields per declaration — the typed ask's own limit (`tools/inputRequest.ts`). */
export const MAX_ASK_FIELDS = 32;
/** The declaration's `context` bound — the typed ask's own. */
export const ASK_CONTEXT_CHARS = 16384;
/** The declaration id — the author's reusable id; each round is stamped with its own `requestId`. */
export const ARGUMENT_ASK_ID = 'agentfootprint.arguments';

// LENS · person-facing · the typed ask's question
// reads: nothing — one fixed sentence; each field's description is its author's question
// law: says what is needed and why the fields exist; promises nothing a later path can break.
/** The question of a first ask. Each field's `description` is its author's question. */
export const ARGUMENT_ASK_QUESTION =
  'Before the next step can run, a few values are needed. Each field says what it is for.';

// LENS · person-facing · the typed ask's question
// reads: nothing — one fixed sentence
// law: says what happened to the earlier answer, in the past tense, and what is asked now.
/** The question of a re-ask, after an answer that did not fit the tool's own schema. */
export const ARGUMENT_REASK_QUESTION =
  'One answer did not fit what the tool accepts. Please answer that field again.';

// LENS · tool-result · persistent-history (through `core/agent/arguments/serve.ts` · `unansweredRefusal`)
// reads: nothing — fixed expectations for a window answer a tool's period forms cannot take
// law: names the rule, never the answer.
/** What a window answer must be when no period form of a tool holds it. */
export const WINDOW_FORM_EXPECTATION = "a window one of the tool's declared period forms can hold";
/** What a zone answer must be when the person's words name no time in it. */
export const WINDOW_ZONE_EXPECTATION = 'a time zone in which the time the person wrote exists';
