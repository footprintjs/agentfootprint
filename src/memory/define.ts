/**
 * defineMemory — the single factory the consumer uses to register a
 * memory subsystem on an Agent.
 *
 *     defineMemory({ id, type, strategy, store }) → MemoryDefinition
 *
 * The factory's job:
 *   1. Switch on `type` (Episodic / Semantic / Narrative / Causal)
 *      to pick the right family of pipelines.
 *   2. Switch on `strategy.kind` within that family to wire stage
 *      configs (loadCount / topK / threshold / extractor / ...).
 *   3. Return an opaque `MemoryDefinition` that step-4's
 *      `Agent.memory()` builder method consumes.
 *
 * Pattern: Factory + Strategy (GoF). One factory, N strategies, four
 *          types — all reduce to two compiled FlowCharts (`read`,
 *          `write?`) that mount as subflows.
 *
 * Role:    Layer-2 of the memory stack. Sits between the const-objects
 *          contract (Layer 1) and the Agent builder method (Layer 4).
 *
 * Emits:   Indirectly — the compiled subflows emit
 *          `agentfootprint.context.injected` with `source: 'memory'`
 *          when their formatter writes to the system-prompt slot.
 *
 * @see ./define.types.ts        for the const-objects + types
 * @see ./asRoleRefusal.ts       for why `asRole` is refused, not honoured
 * @see ./pipeline/*.ts          for the existing pipeline factories this dispatches to
 */

import { refuseAsRole } from './asRoleRefusal.js';
import { assertStrategyRequirements } from './strategies.js';
import { resolveRankingMode } from './store/capability.js';

import { defaultPipeline, type DefaultPipelineConfig } from './pipeline/default.js';
import { ephemeralPipeline } from './pipeline/ephemeral.js';
import { semanticPipeline, type SemanticPipelineConfig } from './pipeline/semantic.js';
import { factPipeline, type FactPipelineConfig } from './pipeline/fact.js';
import { narrativePipeline, type NarrativePipelineConfig } from './pipeline/narrative.js';
import { autoPipeline, type AutoPipelineConfig } from './pipeline/auto.js';
import { snapshotPipeline, type SnapshotPipelineConfig } from './causal/index.js';
import type { MemoryPipeline } from './pipeline/types.js';

import {
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  type DefineMemoryOptions,
  type DefineCausalOptions,
  type DefineEpisodicOptions,
  type DefineNarrativeOptions,
  type DefineSemanticOptions,
  type Strategy,
  type MemoryWindowStrategy,
  type BudgetStrategy,
  type SummarizeStrategy,
  type TopKStrategy,
  type ExtractStrategy,
  type DecayStrategy,
  type HybridStrategy,
} from './define.types.js';
import type { MemoryDefinition, ReadonlyMemoryFlowChart } from './define.types.js';

// ─── Public factory ────────────────────────────────────────────────

/**
 * Build a `MemoryDefinition` from a high-level `{ type, strategy, store }`
 * config. Internally dispatches to one of the existing pipeline factories
 * (defaultPipeline / semanticPipeline / factPipeline / narrativePipeline /
 * autoPipeline / ephemeralPipeline) and wires the compiled flowcharts
 * into the opaque definition that `Agent.memory()` consumes.
 *
 * Supported combinations:
 *
 * | type      | strategy.kind | underlying pipeline      |
 * | --------- | ------------- | ------------------------ |
 * | EPISODIC  | WINDOW        | defaultPipeline          |
 * | EPISODIC  | BUDGET        | defaultPipeline          |
 * | EPISODIC  | SUMMARIZE     | defaultPipeline (the compression stage is NOT composed in yet — see `listMemoryStrategies()`) |
 * | EPISODIC  | DECAY         | defaultPipeline + filterByDecay stage |
 * | SEMANTIC  | TOP_K         | semanticPipeline         |
 * | SEMANTIC  | EXTRACT       | factPipeline             |
 * | SEMANTIC  | WINDOW        | factPipeline (recency-load) |
 * | NARRATIVE | EXTRACT       | narrativePipeline        |
 * | NARRATIVE | WINDOW        | narrativePipeline (recency-load) |
 * | (any)     | HYBRID        | autoPipeline (when sub-strategies map cleanly) |
 *
 * Unsupported combinations throw with a remediation hint pointing to a
 * working alternative or to the raw `mountMemoryRead`/`mountMemoryWrite`
 * helpers for power users.
 */
export function defineMemory(options: DefineMemoryOptions): MemoryDefinition {
  validate(options);

  const pipeline = buildPipeline(options);

  // The declared-requirements backstop (9.5.0), deliberately AFTER the
  // dispatch: the arms above know things this check does not (the
  // server-text exemption, that it does not apply to CAUSAL, that EXTRACT's
  // `llm` matters only for `extractor: 'llm'`), so they speak first and this
  // says something only when nothing better did. What it guarantees is that
  // no requirement `listMemoryStrategies()` DECLARES can go unchecked —
  // including the ones a composed pipeline would have quietly ignored.
  assertStrategyRequirements(options, `defineMemory[${options.id}]`);

  // `readOnly` drops the write half entirely (8.8.0). Not "writes are
  // skipped at runtime" — the subflow is never compiled and never mounted,
  // so a read-only memory has no write stage in its chart, no write commit
  // in its log, and nothing to disable later by accident.
  const write = options.readOnly === true ? undefined : pipeline.write;

  const definition: MemoryDefinition = {
    id: options.id,
    ...(options.description !== undefined && { description: options.description }),
    type: options.type,
    read: brandPipeline(pipeline.read),
    ...(write !== undefined && { write: brandPipeline(write) }),
    timing: options.timing ?? MEMORY_TIMING.TURN_START,
    ...(options.redact !== undefined && { redact: options.redact }),
    ...(options.corpus !== undefined && { corpus: options.corpus }),
    ...(options.flavor !== undefined && { flavor: options.flavor }),
    ...(options.type === MEMORY_TYPES.CAUSAL &&
      (options as DefineCausalOptions).projection !== undefined && {
        projection: (options as DefineCausalOptions).projection,
      }),
  };

  return Object.freeze(definition);
}

// ─── Validation ────────────────────────────────────────────────────

function validate(options: DefineMemoryOptions): void {
  if (!options.id || options.id.trim() === '') {
    throw new Error('defineMemory: `id` is required and must be non-empty.');
  }
  // `asRole` no longer type-checks; this catches JavaScript callers and
  // casts. Refused before anything else is validated so the message is
  // about the option the caller actually wrote.
  refuseAsRole(options, `defineMemory('${options.id}')`);
  if (!options.store) {
    throw new Error(
      `defineMemory[id=${options.id}]: \`store\` is required. ` +
        'Pass `new InMemoryStore()` for dev/tests, or a backed store for production.',
    );
  }
  // The shorthand and the spelled-out rule EXCLUDE. Accepting both would
  // mean one of two numbers silently loses, and the recording would name
  // a `k` the run did not use.
  // Read through a structural shape, not the union: the union's arms
  // declare the OTHER spelling as `never`, so intersecting them here
  // would make the very field this check reads unreadable.
  const strategy = options.strategy as {
    readonly topK?: number;
    readonly threshold?: number;
    readonly retrieval?: { readonly name: string };
  };
  if (strategy?.retrieval !== undefined) {
    const shorthand: string[] = [];
    if (strategy.topK !== undefined) shorthand.push('`topK`');
    if (strategy.threshold !== undefined) shorthand.push('`threshold`');
    if (shorthand.length > 0) {
      throw new Error(
        `defineMemory[id=${options.id}]: ${shorthand.join(' and ')} cannot be combined with ` +
          '`retrieval` — they are two spellings of the same rule and could disagree. ' +
          `Keep the strategy (\`retrieval: ${strategy.retrieval.name}({ ... })\`) and drop ` +
          `${shorthand.join('/')}, or drop \`retrieval\`.`,
      );
    }
  }
}

// ─── Pipeline dispatch ─────────────────────────────────────────────

function buildPipeline(options: DefineMemoryOptions): MemoryPipeline {
  switch (options.type) {
    case MEMORY_TYPES.EPISODIC:
      return buildEpisodicPipeline(options);
    case MEMORY_TYPES.SEMANTIC:
      return buildSemanticPipeline(options);
    case MEMORY_TYPES.NARRATIVE:
      return buildNarrativePipeline(options);
    case MEMORY_TYPES.CAUSAL:
      return buildCausalPipeline(options);
    default: {
      const _exhaustive: never = options;
      void _exhaustive;
      throw new Error(`defineMemory: unknown type — ${(options as { type: string }).type}`);
    }
  }
}

// ─── EPISODIC type ─────────────────────────────────────────────────

function buildEpisodicPipeline(options: DefineEpisodicOptions): MemoryPipeline {
  const s = options.strategy;

  switch (s.kind) {
    case MEMORY_STRATEGIES.WINDOW: {
      const w = s as MemoryWindowStrategy;
      const config: DefaultPipelineConfig = { store: options.store, loadCount: w.size };
      return defaultPipeline(config);
    }

    case MEMORY_STRATEGIES.BUDGET: {
      const b = s as BudgetStrategy;
      const config: DefaultPipelineConfig = {
        store: options.store,
        ...(b.reserveTokens !== undefined && { reserveTokens: b.reserveTokens }),
        ...(b.minimumTokens !== undefined && { minimumTokens: b.minimumTokens }),
        ...(b.maxEntries !== undefined && { maxEntries: b.maxEntries }),
      };
      return defaultPipeline(config);
    }

    case MEMORY_STRATEGIES.SUMMARIZE: {
      // WHAT THIS ACTUALLY DOES, as of 9.5.0: loads the last `recent` turns
      // and stops. The `summarize` stage exists (stages/summarize.ts) and is
      // composed into NOTHING — the comment that used to sit here said the
      // wire helpers add it "when the strategy carries an `llm`", and they
      // never have. Verified by counting calls: eight turns through this
      // pipeline with a counting provider, zero `complete()` calls.
      //   It is left as-is rather than half-wired because the compressor
      // needs things this strategy does not carry (a model name, cost
      // accounting, the separate-instance law `.compaction()` enforces), and
      // the Agent already has that door. `listMemoryStrategies()` says so in
      // the strategy's own description so a reader learns it from the
      // library rather than from a token bill.
      const sum = s as SummarizeStrategy;
      const config: DefaultPipelineConfig = { store: options.store, loadCount: sum.recent };
      return defaultPipeline(config);
    }

    case MEMORY_STRATEGIES.HYBRID: {
      // Compose multiple sub-strategies onto one store. Currently
      // delegates to the first sub-strategy that's valid for episodic
      // data; richer selector-style merge of all sub-strategies'
      // outputs is planned.
      const h = s as HybridStrategy;
      const inner = h.strategies[0];
      if (!inner) {
        throw new Error(
          `defineMemory[${options.id}]: HYBRID strategy requires at least one sub-strategy.`,
        );
      }
      return buildEpisodicPipeline({ ...options, strategy: inner });
    }

    case MEMORY_STRATEGIES.EXTRACT:
      throw new Error(
        `defineMemory[${options.id}]: EXTRACT strategy on EPISODIC type is not idiomatic — ` +
          'extraction produces structured outputs (facts/beats), so use type=SEMANTIC or NARRATIVE.',
      );

    case MEMORY_STRATEGIES.TOP_K:
      throw new Error(
        `defineMemory[${options.id}]: TOP_K strategy on EPISODIC type requires a vector store. ` +
          'Use type=SEMANTIC for vector retrieval, or type=EPISODIC with strategy=WINDOW for recency.',
      );

    case MEMORY_STRATEGIES.DECAY: {
      // Wired in 9.5.0. Until then this arm threw "not yet wired" while
      // `MEMORY_STRATEGIES` went on offering the choice — a const that
      // advertised seven strategies and built six.
      const d = s as DecayStrategy;
      if (!Number.isFinite(d.halfLifeMs) || d.halfLifeMs < 0) {
        throw new Error(
          `defineMemory[${options.id}]: DECAY needs a \`halfLifeMs\` that is a non-negative ` +
            `number of milliseconds — how long before an untouched entry is worth half as ` +
            `much. Got \`${String(d.halfLifeMs)}\`.\n` +
            `  A negative half-life inverts the curve (older scores HIGHER), which no config ` +
            `means to say, so it is refused rather than obeyed.\n` +
            `  Fix:  a day is \`86_400_000\`; an hour is \`3_600_000\`.`,
        );
      }
      const config: DefaultPipelineConfig = {
        store: options.store,
        decay: {
          halfLifeMs: d.halfLifeMs,
          ...(d.minScore !== undefined && { minScore: d.minScore }),
        },
      };
      return defaultPipeline(config);
    }

    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      throw new Error(`defineMemory: unknown strategy kind`);
    }
  }
}

// ─── SEMANTIC type ─────────────────────────────────────────────────

function buildSemanticPipeline(options: DefineSemanticOptions): MemoryPipeline {
  const s = options.strategy;

  switch (s.kind) {
    case MEMORY_STRATEGIES.TOP_K: {
      const t = s as TopKStrategy;
      // Whether an embedder is required is a fact about the STORE, which the
      // type cannot see — so the requirement lives here (9.3.0). Absence is
      // legal for exactly one store shape and refused for every other.
      const ranksBy = resolveRankingMode(options.store, `defineMemory[${options.id}]`);
      if (t.embedder === undefined) {
        if (ranksBy !== 'server-text') {
          throw new Error(
            `defineMemory[${options.id}]: TOP_K needs an \`embedder\` — somebody has to turn ` +
              `the query into a vector before this store can rank it.\n` +
              `  Omit it only for a store that declares \`ranksBy: 'server-text'\`, which ` +
              `embeds and ranks the question on its own side.`,
          );
        }
        if (options.readOnly !== true) {
          throw new Error(
            `defineMemory[${options.id}]: a store that declares \`ranksBy: 'server-text'\` has ` +
              `no write half here — this library cannot embed the turn (no embedder) and the ` +
              `backend does its own ingestion.\n` +
              `  Fix:  pass \`readOnly: true\` (which \`defineRAG\` sets for you), so the write ` +
              `subflow is never compiled rather than compiled and silently doing nothing.`,
          );
        }
      }
      const config: SemanticPipelineConfig = {
        store: options.store,
        ...(t.embedder !== undefined && { embedder: t.embedder }),
        ...(t.topK !== undefined && { k: t.topK }),
        ...(t.threshold !== undefined && { minScore: t.threshold }),
        // Composes with either spelling — a size bound, not a second
        // spelling of the count rule. See TopKRetrievalStrategy.maxChars.
        ...(t.maxChars !== undefined && { maxChars: t.maxChars }),
        ...(t.embedderId !== undefined && { embedderId: t.embedderId }),
        ...(t.retrieval !== undefined && { retrieval: t.retrieval }),
        ...(options.flavor !== undefined && { flavor: options.flavor }),
      };
      return semanticPipeline(config);
    }

    case MEMORY_STRATEGIES.EXTRACT: {
      const e = s as ExtractStrategy;
      if (e.extractor === 'llm' && !e.llm) {
        throw new Error(
          `defineMemory[${options.id}]: EXTRACT with extractor='llm' requires \`llm\` provider. ` +
            "Pass `extractor: 'pattern'` to use the regex-heuristics extractor instead.",
        );
      }
      const config: FactPipelineConfig = { store: options.store };
      return factPipeline(config);
    }

    case MEMORY_STRATEGIES.WINDOW: {
      // SEMANTIC × WINDOW: load top-N recent facts (no embedding query).
      // factPipeline already loads by recency by default; size is interpreted
      // as the load limit.
      const w = s as MemoryWindowStrategy;
      const config: FactPipelineConfig = { store: options.store, loadLimit: w.size };
      return factPipeline(config);
    }

    case MEMORY_STRATEGIES.HYBRID: {
      // SEMANTIC × HYBRID — compose facts + beats via autoPipeline.
      const config: AutoPipelineConfig = { store: options.store };
      return autoPipeline(config);
    }

    case MEMORY_STRATEGIES.BUDGET:
    case MEMORY_STRATEGIES.SUMMARIZE:
    case MEMORY_STRATEGIES.DECAY:
      throw new Error(
        `defineMemory[${options.id}]: ${String(
          s.kind,
        )} strategy is not supported on SEMANTIC type. ` +
          'Use TOP_K (vector retrieval), EXTRACT (LLM/pattern fact extraction), ' +
          'WINDOW (recency-load), or HYBRID (auto compose).',
      );

    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      throw new Error(`defineMemory: unknown strategy kind`);
    }
  }
}

// ─── NARRATIVE type ────────────────────────────────────────────────

function buildNarrativePipeline(options: DefineNarrativeOptions): MemoryPipeline {
  const s = options.strategy;

  switch (s.kind) {
    case MEMORY_STRATEGIES.EXTRACT: {
      const e = s as ExtractStrategy;
      if (e.extractor === 'llm' && !e.llm) {
        throw new Error(
          `defineMemory[${options.id}]: EXTRACT with extractor='llm' requires \`llm\` provider.`,
        );
      }
      const config: NarrativePipelineConfig = { store: options.store };
      return narrativePipeline(config);
    }

    case MEMORY_STRATEGIES.WINDOW: {
      const w = s as MemoryWindowStrategy;
      const config: NarrativePipelineConfig = { store: options.store, loadCount: w.size };
      return narrativePipeline(config);
    }

    case MEMORY_STRATEGIES.HYBRID: {
      const config: AutoPipelineConfig = { store: options.store };
      return autoPipeline(config);
    }

    case MEMORY_STRATEGIES.TOP_K:
    case MEMORY_STRATEGIES.BUDGET:
    case MEMORY_STRATEGIES.SUMMARIZE:
    case MEMORY_STRATEGIES.DECAY:
      throw new Error(
        `defineMemory[${options.id}]: ${String(
          s.kind,
        )} strategy is not supported on NARRATIVE type. ` +
          'Use EXTRACT (LLM/heuristic beat extraction), WINDOW (recency-load), or HYBRID.',
      );

    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      throw new Error(`defineMemory: unknown strategy kind`);
    }
  }
}

// ─── CAUSAL type ───────────────────────────────────────────────────

function buildCausalPipeline(options: DefineCausalOptions): MemoryPipeline {
  const s = options.strategy;

  // Causal memory writes (query, finalContent) snapshots tagged with
  // the original user query. Retrieval embeds the new query and
  // cosine-matches against past queries, returning the most relevant
  // snapshot for replay. Strict threshold: no match → no injection.
  if (s.kind !== MEMORY_STRATEGIES.TOP_K) {
    throw new Error(
      `defineMemory[${options.id}]: CAUSAL type only supports TOP_K strategy. ` +
        'Snapshots are matched semantically against the new user query; ' +
        "WINDOW/BUDGET/SUMMARIZE/EXTRACT/DECAY/HYBRID don't apply.",
    );
  }

  if (!options.store.search) {
    throw new Error(
      `defineMemory[${options.id}]: CAUSAL type requires a vector-capable store. ` +
        'Pass `new InMemoryStore({ embedder })` for dev/tests, or a vector adapter ' +
        '(pgvector, Pinecone, Qdrant) for production.',
    );
  }

  // CAUSAL predates the retrieval seam and reads the shorthand only. A
  // strategy passed here would be accepted and ignored, so it is refused.
  if (s.retrieval !== undefined) {
    throw new Error(
      `defineMemory[${options.id}]: CAUSAL type does not read \`retrieval\` — snapshot recall ` +
        'matches a stored query vector, not a document pool. Use `topK` + `threshold`.',
    );
  }

  // Same law, same reason (8.19.0): the snapshot pipeline has no character
  // budget, so accepting one here would be an option the run does not read.
  if (s.maxChars !== undefined) {
    throw new Error(
      `defineMemory[${options.id}]: CAUSAL type does not read \`maxChars\` — it recalls whole ` +
        'past-run snapshots, not a pool of passages to spend a character budget across. ' +
        'Bound it with `topK` (snapshots recalled) or `projection` (how much of each one).',
    );
  }

  // CAUSAL matches a stored QUERY VECTOR against a new one — there is no
  // server-side text path into a snapshot pool, so the embedder stays
  // unconditionally required here even though the type made it optional for
  // the semantic case (9.3.0).
  if (s.embedder === undefined) {
    throw new Error(
      `defineMemory[${options.id}]: CAUSAL type requires an \`embedder\` — snapshot recall ` +
        'matches the new query against the query vector each past run was filed under, so ' +
        "there is always a vector to produce. (`ranksBy: 'server-text'` relaxes this for " +
        'SEMANTIC retrieval only.)',
    );
  }

  const config: SnapshotPipelineConfig = {
    store: options.store,
    embedder: s.embedder,
    topK: s.topK,
    ...(s.threshold !== undefined && { minScore: s.threshold }),
    ...(options.projection !== undefined && { projection: options.projection }),
  };
  return snapshotPipeline(config);
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * The factory hands back an opaque `ReadonlyMemoryFlowChart<T>` brand
 * to keep consumers from reaching into the FlowChart shape directly —
 * step-4's `Agent.memory()` is the only place that unwraps it.
 */
function brandPipeline<T>(fc: unknown): ReadonlyMemoryFlowChart<T> {
  return fc as ReadonlyMemoryFlowChart<T>;
}

/**
 * Internal — unwrap the brand. Used by `Agent.memory()` (step 4)
 * to mount the pipeline. NOT exported.
 *
 * @internal
 */
export function unwrapMemoryFlowChart<T>(branded: ReadonlyMemoryFlowChart<T>): unknown {
  return branded;
}

// Suppress ESLint unused-import warning for `ephemeralPipeline` —
// reserved for a future `readOnly: true` config flag.
void ephemeralPipeline;
// Suppress for `Strategy` — kept as exported type for consumers.
void (null as unknown as Strategy);
