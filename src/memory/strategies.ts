/**
 * Named memory strategies — what each one does, which TYPES accept it, and
 * what the host must supply before it can run.
 *
 * `MEMORY_STRATEGIES` is a const of seven bare strings. A string is enough to
 * WRITE `strategy: { kind: … }` and not nearly enough to OFFER the choice: a
 * host rendering a strategy picker off that const offers seven options, and
 * learns which of them this deployment can actually run by calling
 * `defineMemory` and reading the exception. That is a selector that discovers
 * its own capabilities by failing.
 *
 * So each strategy declares itself, and `listMemoryStrategies()` enumerates
 * the declarations. The shape mirrors the influence exemplar in this same
 * package (`listInfluenceStrategies()` → `{ name, description, requirements,
 * scorer }`), with two deliberate differences:
 *
 *   • the id is `kind`, not `name` — it is the value the caller writes into
 *     `strategy.kind`, so a picker's option value IS the id;
 *   • there is no `scorer`, because a memory strategy is not a function the
 *     host calls; what it needs instead is `types` — the memory TYPES that
 *     accept it, which is the other half of "can I offer this?" (`decay` on a
 *     SEMANTIC store is refused however good the host's credentials are).
 *
 * `requirements` is what a host must SUPPLY (an embedder, an LLM, a store
 * that can search). Empty means the strategy runs anywhere, at $0.
 *
 * Pattern: declared capability descriptors + the two guards that enforce
 *          them — SHAPE first (`assertStrategyShape`: is this even a
 *          strategy?), REQUIREMENTS after (`assertStrategyRequirements`: can
 *          this deployment run it?).
 * Role:    memory/ layer-1, beside the const it describes.
 * Emits:   N/A — build-time only.
 *
 * @see ./define.types.ts  for `MEMORY_STRATEGIES` and the strategy union
 * @see ../lib/influence-core/strategies.ts  for the exemplar this follows
 */

import {
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type DefineMemoryOptions,
  type MemoryStrategyKind,
  type MemoryType,
  type Strategy,
} from './define.types.js';
import { resolveRankingMode } from './store/capability.js';
import type { MemoryStore } from './store/index.js';

/**
 * What a strategy needs the host to supply before it can run. A picker greys
 * out (or refuses to offer) strategies whose requirements it cannot meet.
 *
 * Three well-known values ship; the type stays open so a consumer's own
 * strategy descriptor can name something else:
 *
 *   - `'embedder'`     — an `Embedder` that turns text into a vector.
 *   - `'vector-store'` — a store that implements `search()`. Not the same
 *                        requirement as an embedder: the embedder makes the
 *                        query vector, the store is what ranks against it,
 *                        and a deployment can easily have one without the
 *                        other (`RedisStore` is a full memory store with no
 *                        `search()` at all).
 *   - `'llm'`          — a chat provider the strategy calls on the host's
 *                        behalf.
 *   - `'model'`        — the model id that provider is called WITH. Its own
 *                        requirement rather than part of `'llm'`, because a
 *                        deployment can hold a provider and still have no
 *                        answer for which model compression should run on —
 *                        and a library that picked one for you would be
 *                        picking your invoice (9.14.0).
 */
export type MemoryStrategyRequirement =
  | 'embedder'
  | 'vector-store'
  | 'llm'
  | 'model'
  | (string & Record<never, never>);

/**
 * A memory strategy, described: enough for a host to render it in a picker
 * and know, before it offers the option, whether this deployment can run it.
 */
export interface MemoryStrategyInfo {
  /** The value written as `strategy.kind` — a member of `MEMORY_STRATEGIES`. */
  readonly kind: MemoryStrategyKind;
  /** One-or-two-sentence plain description, current-truth caveats included. */
  readonly description: string;
  /** What the host must supply. Empty = runs anywhere, no dependency, $0. */
  readonly requirements: readonly MemoryStrategyRequirement[];
  /** The memory TYPES that accept this strategy. Any other pair is refused. */
  readonly types: readonly MemoryType[];
}

const WINDOW: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.WINDOW,
  description:
    'Keeps the last `size` entries — messages on an Episodic store, facts or beats on the ' +
    'others. A pure rule: no LLM, no embeddings, nothing to configure but the number. The ' +
    'right default for short-to-medium chats.',
  requirements: Object.freeze([] as const),
  types: Object.freeze([MEMORY_TYPES.EPISODIC, MEMORY_TYPES.SEMANTIC, MEMORY_TYPES.NARRATIVE]),
});

const BUDGET: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.BUDGET,
  description:
    'Injects as many recent entries as fit a token budget, and injects none at all when the ' +
    'budget is below the floor. Free — the count is estimated, not modelled by a tokenizer ' +
    'call. The decision (pick / skip-empty / skip-no-budget) is recorded as branch evidence.',
  requirements: Object.freeze([] as const),
  types: Object.freeze([MEMORY_TYPES.EPISODIC]),
});

const SUMMARIZE: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.SUMMARIZE,
  description:
    'Compresses what falls out of the verbatim tail: the most recent `recent` entries stay raw ' +
    'and everything older is folded by ONE call to the named cheap model. The summary is ' +
    'WRITTEN BACK to the store, so a span is paid for once rather than once per turn, and the ' +
    'originals are kept — they are excluded from recall by the summary, not deleted. Costs a ' +
    'model call: name the `model` explicitly, and give the summarizer its own provider ' +
    'instance. (`.compaction()` on the Agent is this same move applied to the LIVE window.)',
  requirements: Object.freeze(['llm', 'model'] as const),
  types: Object.freeze([MEMORY_TYPES.EPISODIC]),
});

const TOP_K: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.TOP_K,
  description:
    'Embeds the query and returns the closest stored entries above a threshold — strictly: ' +
    'when nothing clears the threshold, nothing is injected. The embedder is exempt for a ' +
    "store that declares `ranksBy: 'server-text'`, which takes the question as words and " +
    'ranks it on its own side.',
  requirements: Object.freeze(['embedder', 'vector-store'] as const),
  types: Object.freeze([MEMORY_TYPES.SEMANTIC, MEMORY_TYPES.CAUSAL]),
});

const EXTRACT: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.EXTRACT,
  description:
    'Distills each turn into structured facts or narrative beats on the WRITE side. ' +
    "`extractor: 'pattern'` is regex heuristics — free, no dependency, which is why this " +
    "strategy requires nothing. `extractor: 'llm'` additionally needs an `llm`, and is " +
    'refused without one.',
  requirements: Object.freeze([] as const),
  types: Object.freeze([MEMORY_TYPES.SEMANTIC, MEMORY_TYPES.NARRATIVE]),
});

const DECAY: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.DECAY,
  description:
    'Lets old memory fade: each loaded entry is scored by age against a half-life and ' +
    'dropped below `minScore`, so a long-running agent stops rehearsing last month. Free — ' +
    'arithmetic on a timestamp, no LLM and no embeddings.',
  requirements: Object.freeze([] as const),
  types: Object.freeze([MEMORY_TYPES.EPISODIC]),
});

const HYBRID: MemoryStrategyInfo = Object.freeze({
  kind: MEMORY_STRATEGIES.HYBRID,
  description:
    'Composes several strategies on one store. It requires nothing of its own — each ' +
    'sub-strategy carries its own requirements, and every one of them is checked at build ' +
    'so a hybrid cannot smuggle in a strategy this deployment cannot run.',
  requirements: Object.freeze([] as const),
  types: Object.freeze([MEMORY_TYPES.EPISODIC, MEMORY_TYPES.SEMANTIC, MEMORY_TYPES.NARRATIVE]),
});

const BUILT_IN: readonly MemoryStrategyInfo[] = Object.freeze([
  WINDOW,
  BUDGET,
  SUMMARIZE,
  TOP_K,
  EXTRACT,
  DECAY,
  HYBRID,
]);

/**
 * Every memory strategy, described — cheapest first, in the order the docs
 * teach them. Frozen: a host renders its picker straight off this.
 *
 * @example Offer only what this deployment can actually run
 * ```ts
 * import { listMemoryStrategies } from 'agentfootprint/memory';
 *
 * const available = new Set(embedder ? ['embedder', 'vector-store'] : []);
 * const offerable = listMemoryStrategies().filter(
 *   (s) => s.types.includes('episodic') && s.requirements.every((r) => available.has(r)),
 * );
 * // → window, budget, decay, hybrid — the four that cost nothing to run.
 * ```
 */
export function listMemoryStrategies(): readonly MemoryStrategyInfo[] {
  return BUILT_IN;
}

/**
 * One strategy's description by `kind`, or `undefined` for a string that is
 * not a strategy at all.
 */
export function memoryStrategyInfo(kind: string): MemoryStrategyInfo | undefined {
  return BUILT_IN.find((s) => s.kind === kind);
}

// ─── The guard that makes the SHAPE true ────────────────────────────

/**
 * One correct line per kind — what a caller writes to get that strategy.
 * These are quoted verbatim into refusals, so a reader can copy the fix out
 * of the message instead of going to look for a doc.
 */
const EXAMPLE: Readonly<Record<MemoryStrategyKind, string>> = Object.freeze({
  [MEMORY_STRATEGIES.WINDOW]: `{ kind: 'window', size: 20 }`,
  [MEMORY_STRATEGIES.BUDGET]: `{ kind: 'budget', maxEntries: 20 }`,
  [MEMORY_STRATEGIES.SUMMARIZE]: `{ kind: 'summarize', recent: 6, llm, model: 'claude-haiku-4-5' }`,
  [MEMORY_STRATEGIES.TOP_K]: `{ kind: 'topK', topK: 3, embedder }`,
  [MEMORY_STRATEGIES.EXTRACT]: `{ kind: 'extract', extractor: 'pattern' }`,
  [MEMORY_STRATEGIES.DECAY]: `{ kind: 'decay', halfLifeMs: 86_400_000 }`,
  [MEMORY_STRATEGIES.HYBRID]: `{ kind: 'hybrid', strategies: [{ kind: 'window', size: 20 }] }`,
});

const LISTING_HINT =
  `  \`listMemoryStrategies()\` describes all seven kinds — what each one does, which memory ` +
  `TYPES accept it, and what it needs supplied.`;

/**
 * Refuse a strategy whose SHAPE is wrong, before anything reads into it.
 *
 * WHY it runs FIRST, ahead of both the pipeline dispatch and the
 * requirements walk: those two read FIELDS off the strategy
 * (`strategies[0]`, `s.embedder`, `for (const sub of strategy.strategies)`),
 * and a field read off a shape that never had it is a `TypeError` with the
 * library's internals in the text — `Cannot read properties of undefined
 * (reading '0')` for `{ kind: 'hybrid', size: 5 }`, which names neither the
 * option the caller got wrong nor the one they meant. A caller cannot act on
 * that. This guard turns every such read into a refusal that names the
 * field, shows the line that would have worked, and points at the catalogue.
 *
 * It checks SHAPE only — is this an object, does it carry a `kind`, does a
 * `hybrid` carry the array that makes it a hybrid. It deliberately does NOT
 * judge whether the kind is real or legal for the type: the dispatch refuses
 * those and names the alternative for that type, which is the better message.
 *
 * @param strategy the strategy exactly as the caller wrote it — `unknown`,
 *                 because the whole point is that it may not be a `Strategy`.
 * @param site     the call to name in the message, e.g. `defineMemory[chat]`.
 */
export function assertStrategyShape(strategy: unknown, site: string): void {
  checkShape(strategy, site, 'strategy');
}

function checkShape(value: unknown, site: string, path: string): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(notAStrategyObject(value, site, path));
  }

  const kind = (value as { readonly kind?: unknown }).kind;
  if (typeof kind !== 'string' || kind === '') {
    throw new Error(missingKind(site, path));
  }

  if (kind !== MEMORY_STRATEGIES.HYBRID) return;

  // A hybrid IS its list. Every other kind can survive a missing field on a
  // default; this one has nothing left to be.
  const subs = (value as { readonly strategies?: unknown }).strategies;
  if (!Array.isArray(subs) || subs.length === 0) {
    throw new Error(hybridWithoutStrategies(subs, site, path));
  }
  subs.forEach((sub, index) => checkShape(sub, site, `${path}.strategies[${index}]`));
}

/** `'window'`, `42`, `null` — anything that is not an object at all. */
function notAStrategyObject(value: unknown, site: string, path: string): string {
  const written =
    typeof value === 'string'
      ? `the string \`'${value}'\``
      : value === undefined
      ? 'nothing at all'
      : `\`${String(value)}\``;
  // A bare string is almost always a caller reaching for the right kind with
  // the wrong syntax — so answer with THAT kind's line, not a generic one.
  const example =
    typeof value === 'string' && memoryStrategyInfo(value) !== undefined
      ? EXAMPLE[value as MemoryStrategyKind]
      : EXAMPLE[MEMORY_STRATEGIES.WINDOW];
  return (
    `${site}: \`${path}\` must be an OBJECT with a \`kind\` — got ${written}.\n` +
    `  A bare kind name is not a strategy: the kind names the rule, and the object's other ` +
    `fields configure it.\n` +
    `  Fix:  ${path}: ${example}\n` +
    LISTING_HINT
  );
}

/** `{}`, or an object whose `kind` is not a string. */
function missingKind(site: string, path: string): string {
  return (
    `${site}: \`${path}\` has no \`kind\` — that field is what says which strategy this is, ` +
    `so there is nothing here to build.\n` +
    `  Fix:  ${path}: ${EXAMPLE[MEMORY_STRATEGIES.WINDOW]}\n` +
    LISTING_HINT
  );
}

/** `{ kind: 'hybrid' }` — the field-report shape, and its neighbours. */
function hybridWithoutStrategies(subs: unknown, site: string, path: string): string {
  const written = !Array.isArray(subs)
    ? subs === undefined
      ? 'none was passed'
      : `\`strategies\` is not an array (got \`${typeof subs}\`)`
    : 'the array is empty';
  return (
    `${site}: the \`hybrid\` strategy needs a non-empty \`strategies\` array and ${written} — a ` +
    `hybrid is defined by the strategies it composes, so an empty one has nothing to compose ` +
    `and no behaviour of its own.\n` +
    `  Fix:  ${path}: { kind: 'hybrid', strategies: [{ kind: 'window', size: 20 }, ` +
    `{ kind: 'topK', topK: 3, embedder }] }\n` +
    `  Or:   drop \`hybrid\` and name the one rule you meant, e.g. ` +
    `${EXAMPLE[MEMORY_STRATEGIES.WINDOW]}.\n` +
    LISTING_HINT
  );
}

// ─── The guard that makes the declaration true ──────────────────────

/**
 * Refuse a config whose strategy declares a requirement the caller did not
 * supply — by name, at BUILD, with the fix in the message.
 *
 * WHY it runs LAST, after the pipeline dispatch rather than before it: the
 * dispatch's own refusals know more than this one does. `defineMemory`'s
 * TOP_K arm knows about the `ranksBy: 'server-text'` exemption AND about the
 * write half it takes away; the CAUSAL arm knows that exemption does not
 * apply to it; the EXTRACT arm knows the `llm` matters only for
 * `extractor: 'llm'`. Speaking first would replace those messages with a
 * blunter one. This is the BACKSTOP: it says something only when nothing
 * better already did, and its job is that no declared requirement can go
 * unchecked — the failure it exists to prevent is a missing dependency
 * surfacing as a `TypeError` from five frames inside a stage, halfway
 * through a paid run.
 *
 * @param options the config as written by the caller.
 * @param site    the call to name in the message, e.g. `defineMemory[chat]`.
 */
export function assertStrategyRequirements(options: DefineMemoryOptions, site: string): void {
  checkStrategy(options.strategy, options.type, options.store, site, undefined);
}

function checkStrategy(
  strategy: Strategy,
  type: MemoryType,
  store: MemoryStore,
  site: string,
  insideHybrid: boolean | undefined,
): void {
  const info = memoryStrategyInfo(strategy.kind);
  // An unknown kind, or a kind this TYPE does not accept, is not this guard's
  // business — the dispatch refuses both, and names the alternative.
  if (!info || !info.types.includes(type)) return;

  for (const requirement of info.requirements) {
    if (isSatisfied(requirement, strategy, type, store, site)) continue;
    throw new Error(missingRequirement(requirement, info, site, insideHybrid === true));
  }

  if (strategy.kind === MEMORY_STRATEGIES.HYBRID) {
    // A hybrid is only as runnable as its parts, and the pipelines it builds
    // do not all read every part — so the parts are checked HERE, where the
    // caller's words still exist, rather than trusted to whatever the
    // composed pipeline happens to consume.
    for (const sub of strategy.strategies) checkStrategy(sub, type, store, site, true);
  }
}

function isSatisfied(
  requirement: MemoryStrategyRequirement,
  strategy: Strategy,
  type: MemoryType,
  store: MemoryStore,
  site: string,
): boolean {
  // Read through a structural shape: the union's arms declare each other's
  // fields as `never`, so the union itself cannot be asked these questions.
  const s = strategy as {
    readonly embedder?: unknown;
    readonly llm?: unknown;
    readonly model?: unknown;
  };
  switch (requirement) {
    case 'embedder':
      // The one exemption, and it is a fact about the STORE: a backend that
      // ranks TEXT on its own side has nothing here to embed. It does not
      // extend to CAUSAL, which matches a stored query VECTOR — there is
      // always a vector to produce there.
      if (type !== MEMORY_TYPES.CAUSAL && resolveRankingMode(store, site) === 'server-text') {
        return true;
      }
      return s.embedder !== undefined;
    case 'vector-store':
      return typeof store.search === 'function';
    case 'llm':
      return s.llm !== undefined;
    case 'model':
      return typeof s.model === 'string' && s.model.trim() !== '';
    default:
      // A requirement this library does not know how to check is not a
      // requirement it may fail the caller over.
      return true;
  }
}

function missingRequirement(
  requirement: MemoryStrategyRequirement,
  info: MemoryStrategyInfo,
  site: string,
  insideHybrid: boolean,
): string {
  const where = insideHybrid
    ? `the \`${info.kind}\` strategy inside \`hybrid\``
    : `the \`${info.kind}\` strategy`;
  const declared =
    `  Every strategy declares what it needs — \`listMemoryStrategies()\` reports ` +
    `\`requirements: [${info.requirements.map((r) => `'${r}'`).join(', ')}]\` for this one, so a ` +
    `host can check before it offers the choice.\n`;

  switch (requirement) {
    case 'embedder':
      return (
        `${site}: ${where} needs an \`embedder\` and none was passed — somebody has to turn ` +
        `the query into a vector before a store can rank it.\n` +
        declared +
        `  Fix:  pass \`embedder\` on the strategy (\`mockEmbedder()\` for dev/tests), or omit ` +
        `it only for a store that declares \`ranksBy: 'server-text'\` and embeds on its own side.`
      );
    case 'vector-store':
      return (
        `${site}: ${where} needs a store that can \`search()\`, and the store you passed does ` +
        `not implement one — nothing would ever rank the entries written to it.\n` +
        declared +
        `  Fix:  pass a vector-capable store — \`InMemoryStore\` (dev/tests), ` +
        `\`sqliteVectorStore\` (durable, one file), \`pgVectorStore\`, \`s3VectorsStore\`, or any ` +
        `adapter that ranks the vectors you give it.\n` +
        `  Or:   keep this store and pick a strategy that ranks nothing — \`window\` (last N) ` +
        `or \`budget\` (fit-to-tokens).`
      );
    case 'llm':
      return (
        `${site}: ${where} names an \`llm\` and none was passed — nothing would write the ` +
        `summary.\n` +
        declared +
        `  Fix:  pass \`llm\` on the strategy, with its own provider instance — a cheap model ` +
        `is the point of it.\n` +
        `  Or:   use \`{ kind: 'window', size: <recent> }\`, which keeps the last N entries ` +
        `verbatim, needs nothing, and costs nothing.`
      );
    case 'model':
      return (
        `${site}: ${where} needs a \`model\` — the id its \`llm\` is called with — and none was ` +
        `passed.\n` +
        declared +
        `  There is no fall back to the agent's own model: the same provider family would ` +
        `quietly bill your MAIN model for compression, and a different vendor would be sent a ` +
        `model id it has never heard of.\n` +
        `  Fix:  \`model: 'claude-haiku-4-5'\` — or whatever your summarizer's cheap model is ` +
        `called.`
      );
    default:
      return (
        `${site}: ${where} declares \`${requirement}\` and it was not supplied.\n` +
        declared +
        `  Fix:  supply it, or pick a strategy whose \`requirements\` are empty.`
      );
  }
}
