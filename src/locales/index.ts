/**
 * agentfootprint/locales — Message Catalog Pattern.
 *
 * The Block D piece. agentfootprint emits user-facing prose at two
 * audience levels:
 *
 *   - **Commentary** — third-person prose for the bottom panel of any
 *     viewer (Lens, CLI tail, log files). "The agent dispatched the
 *     refund tool, which returned successfully."
 *   - **Thinking** — first-person status for chat-bubble UIs.
 *     "Looking up your order…"
 *
 * v2.4 shipped these as `defaultCommentaryTemplates` and
 * `defaultThinkingTemplates` (flat `Record<string, string>` maps with
 * `{{var}}` substitution). The names worked but the framing was
 * generic — "templates" collides with TypeScript / templating-engine
 * terminology, and there was no first-class place to ship locale
 * packs.
 *
 * **Block D formalizes this as the Message Catalog Pattern:**
 *
 *   - `defaultCommentaryMessages` / `defaultThinkingMessages` —
 *     canonical English bundles. Aliases of the v2.4 names; symbol
 *     identity preserved (`defaultCommentaryMessages ===
 *     defaultCommentaryTemplates`).
 *   - `composeMessages(defaults, overrides)` — spread overrides on
 *     top of defaults; missing keys fall back to the default bundle.
 *   - `validateMessages(catalog, requiredKeys)` — assert every
 *     required key is present (and non-empty). Catches drift between
 *     a consumer's locale pack and the framework's required key set.
 *
 * The natural consumer pattern is to ship locale packs alongside the
 * agent code:
 *
 *   import { defaultCommentaryMessages, composeMessages } from 'agentfootprint/locales';
 *   import { esCommentaryMessages } from './locales/es.js';
 *
 *   const merged = composeMessages(defaultCommentaryMessages, esCommentaryMessages);
 *
 *   const agent = Agent.create({...})
 *     .commentaryTemplates(merged)
 *     .build();
 *
 * Pattern: i18n locale resolution (Resource Bundle, Fowler 2002) +
 *          plain object merge for overrides. No catalog inheritance
 *          chain — overrides win OR fall back to defaults.
 *
 * @example  Locale pack drop-in
 *   const esThinking = composeMessages(defaultThinkingMessages, {
 *     'stream.llm_start.iter1':   '{{appName}} está pensando...',
 *     'stream.tool_start':        'Llamando a {{toolName}}...',
 *   });
 *   const agent = Agent.create({...}).thinkingTemplates(esThinking).build();
 *
 * @example  Validate a locale pack against the framework's required keys
 *   import { defaultCommentaryMessages, validateMessages } from 'agentfootprint/locales';
 *
 *   const myCatalog = composeMessages(defaultCommentaryMessages, customOverrides);
 *   validateMessages(myCatalog, Object.keys(defaultCommentaryMessages));
 *   // throws on first missing OR empty key — fail-fast at boot
 */

import { defaultCommentaryTemplates } from '../recorders/observability/commentary/commentaryTemplates.js';
import { defaultThinkingTemplates } from '../recorders/observability/thinking/thinkingTemplates.js';

export type {
  CommentaryTemplates as MessageCatalog,
} from '../recorders/observability/commentary/commentaryTemplates.js';

/**
 * Canonical English commentary bundle. Alias of v2.4's
 * `defaultCommentaryTemplates` — same symbol, friendlier framing.
 *
 * Keys mirror agentfootprint event types; values may contain
 * `{{var}}` placeholders for runtime substitution.
 */
export const defaultCommentaryMessages = defaultCommentaryTemplates;

/**
 * Canonical English thinking bundle. Alias of v2.4's
 * `defaultThinkingTemplates`.
 *
 * Keys mirror agentfootprint event types; values may contain
 * `{{var}}` placeholders for runtime substitution.
 */
export const defaultThinkingMessages = defaultThinkingTemplates;

/**
 * Spread `overrides` on top of `defaults` so every key in `defaults`
 * has a value (the override or the original). The result is a fresh
 * object — neither input is mutated.
 *
 * Missing override keys fall back to the default; extra override
 * keys are preserved (forward-compat for consumer-defined keys).
 *
 * @example
 *   const merged = composeMessages(defaultCommentaryMessages, {
 *     'stream.llm_start.iter1': 'My custom thinking line',
 *   });
 */
export function composeMessages<T extends Readonly<Record<string, string>>>(
  defaults: T,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return Object.freeze({ ...defaults, ...overrides });
}

/**
 * Validation options for `validateMessages`.
 */
export interface ValidateMessagesOptions {
  /**
   * Optional label for the error message (e.g., `'es-MX commentary'`).
   * Defaults to `'message catalog'`.
   */
  readonly label?: string;
  /**
   * When `true`, empty-string values FAIL validation (treated like a
   * missing key). When `false` (default), empty strings are valid —
   * the framework's default catalogs intentionally use empty values
   * for events the consumer should skip rendering for.
   */
  readonly forbidEmpty?: boolean;
}

/**
 * Assert that every key in `requiredKeys` is present in `catalog`.
 * Throws an Error listing every missing key — batched so consumers
 * fix all at once instead of error-by-error.
 *
 * Useful at boot to catch drift between a consumer's locale pack and
 * the framework's required key set.
 *
 * Empty-string values are VALID by default — the framework's default
 * catalogs use `''` to signal "render nothing for this event."
 * Pass `{ forbidEmpty: true }` to also reject empty values.
 *
 * @param catalog       The (composed) message catalog to validate.
 * @param requiredKeys  The keys consumers must define. Typically
 *                      `Object.keys(defaultCommentaryMessages)` or
 *                      `Object.keys(defaultThinkingMessages)`.
 * @param opts          Optional `{ label, forbidEmpty }` (or a bare
 *                      string label for back-compat with simple use).
 *
 * @throws Error when any required key is missing (or empty under
 *               `forbidEmpty`).
 */
export function validateMessages(
  catalog: Readonly<Record<string, string>>,
  requiredKeys: readonly string[],
  opts: ValidateMessagesOptions | string = {},
): void {
  const resolved: ValidateMessagesOptions =
    typeof opts === 'string' ? { label: opts } : opts;
  const label = resolved.label ?? 'message catalog';
  const forbidEmpty = resolved.forbidEmpty ?? false;

  const missing: string[] = [];
  const empty: string[] = [];
  for (const key of requiredKeys) {
    const value = catalog[key];
    if (value === undefined) {
      missing.push(key);
    } else if (forbidEmpty && value.length === 0) {
      empty.push(key);
    }
  }
  if (missing.length === 0 && empty.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing keys: ${missing.join(', ')}`);
  }
  if (empty.length > 0) {
    parts.push(`empty values: ${empty.join(', ')}`);
  }
  throw new Error(`validateMessages(${label}): ${parts.join('; ')}.`);
}
