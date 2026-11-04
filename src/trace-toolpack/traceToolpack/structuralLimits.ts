// ── Display caps that are structural (not consumer-tunable) ───────────────

const OVERVIEW_STAGE_CAP = 40;

const OVERVIEW_KEY_CAP = 40;

const OVERVIEW_ERROR_CAP = 10;

const OVERVIEW_DESCRIPTION_CAP = 140;

const NODE_WRITE_CAP = 20;

const NODE_READ_CAP = 30;

const NARRATIVE_LINE_CHAR_CAP = 400;

const UNKNOWN_ID_SUGGESTION_CAP = 8;

const KEY_SUGGESTION_CAP = 12;

/** `find_in_trace` — default hits, query bounds, and per-hit context window. */
const FIND_HITS_DEFAULT = 10;

const FIND_QUERY_MIN_CHARS = 2;

const FIND_QUERY_MAX_CHARS = 200;

const FIND_CONTEXT_RADIUS = 55;

/**
 * How many committed writes one search may open before it stops. A search
 * is a pointer list, not a scan of the whole run — and a search that ran
 * out of budget SAYS so rather than reporting "no match".
 */
const FIND_SCAN_BUDGET = 1500;

/** `inspect_tool_call` — how many real ids an unknown-id correction names. */
const TOOL_CALL_SUGGESTION_CAP = 12;

/** `inspect_tool_run` — how many RETAINED inner runs a correction names. */
const INNER_RUN_SUGGESTION_CAP = 12;

/** `find_context_errors` — findings per call by default, and the display caps. */
const FINDINGS_DEFAULT = 10;

const FINDING_MESSAGE_CHARS = 300;

const FINDING_SUBJECT_CAP = 6;

const FINDING_WITNESS_CAP = 6;

/** Disposition rows printed. Real packs register ~3; the cap is a fence. */
const DISPOSITION_ROW_CAP = 12;

/** Checks named in the partial-coverage headline before it says "and N more". */
const SILENT_CHECK_NAME_CAP = 4;

/** Result preview for `inspect_tool_call` (its own dial: results are the answer). */
const TOOL_RESULT_PREVIEW_CHARS = 400;

/** Schemas embed an `enum` of valid ids/keys only when the set is small —
 *  free #9 validation without bloating the tools block on long runs. */
const SCHEMA_ENUM_CAP = 48;

// ── inspect_subflow ────────────────────────────────────────────────────────

/** How many mounts a correction names. */
const MOUNT_SUGGESTION_CAP = 8;

export {
  OVERVIEW_STAGE_CAP,
  OVERVIEW_KEY_CAP,
  OVERVIEW_ERROR_CAP,
  OVERVIEW_DESCRIPTION_CAP,
  NODE_WRITE_CAP,
  NODE_READ_CAP,
  NARRATIVE_LINE_CHAR_CAP,
  UNKNOWN_ID_SUGGESTION_CAP,
  KEY_SUGGESTION_CAP,
  FIND_HITS_DEFAULT,
  FIND_QUERY_MIN_CHARS,
  FIND_QUERY_MAX_CHARS,
  FIND_CONTEXT_RADIUS,
  FIND_SCAN_BUDGET,
  TOOL_CALL_SUGGESTION_CAP,
  INNER_RUN_SUGGESTION_CAP,
  FINDINGS_DEFAULT,
  FINDING_MESSAGE_CHARS,
  FINDING_SUBJECT_CAP,
  FINDING_WITNESS_CAP,
  DISPOSITION_ROW_CAP,
  SILENT_CHECK_NAME_CAP,
  TOOL_RESULT_PREVIEW_CHARS,
  SCHEMA_ENUM_CAP,
  MOUNT_SUGGESTION_CAP,
};
