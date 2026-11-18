/** Flat map of template keys to template strings. Keys use a dotted
 *  hierarchy mirroring event types + payload branches
 *  (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 *  contain `{{name}}` placeholders that `renderCommentary` substitutes. */
export type CommentaryTemplates = Readonly<Record<string, string>>;

/** Context the var-extractor reads from. Anything that's NOT in the
 *  event payload (consumer-supplied appName, tool registry lookup) goes
 *  here. Pure data — no closures, no I/O. */
export interface CommentaryContext {
  /** The system that orchestrates the LLM. Substituted as the active
   *  actor in every line ("Acme called the LLM"). Default: `'Chatbot'`. */
  readonly appName: string;
  /** Resolves a tool name to its registered description ("Get current
   *  weather for a city"). Used to compose the optional `descClause`
   *  for `stream.tool_start`. Sync — Lens-style consumers precompute
   *  the lookup map from `context.injected source='registry'` events. */
  readonly getToolDescription?: (toolName: string) => string | undefined;
}
