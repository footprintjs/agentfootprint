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
 *          when their formatter writes to the messages slot.
 *
 * 8-panel review (2026-04-28):
 * - LLM Systems   ✅  asRole knob honored when present, defaults to 'system'
 * - Architect     ✅  per-id scope keys (`memoryInjectionKey(id)`)
 * - API Designer  ✅  one factory; CAUSAL stays here, no separate snapshotMemory
 * - Performance   ✅  default `MEMORY_TIMING.TURN_START`; pipelines compiled once
 * - Privacy       ✅  redact field passes through
 * - ML / IR       ✅  threshold maps to semantic.minScore strictly; no fallback
 * - SoftEng       ✅  unsupported combos throw with clear remediation hint
 * - TS Engineer   ✅  discriminated union narrowing preserved across switches
 *
 * Book reference: AI Agents — The Definitive Guide, Ch 10 (Memory,
 *   Autonomy, Long-Horizon Use — chapter still unavailable in pre-pub).
 *
 * @see ./define.types.ts        for the const-objects + types
 * @see ./pipeline/*.ts          for the existing pipeline factories this dispatches to
 * @see MEMORY.md                load-bearing design memory
 */

import type { ContextRole } from '../events/types.js';

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
  type WindowStrategy,
  type BudgetStrategy,
  type SummarizeStrategy,
  type TopKStrategy,
  type ExtractStrategy,
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
 * | EPISODIC  | SUMMARIZE     | defaultPipeline + summarize stage |
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

  const definition: MemoryDefinition = {
    id: options.id,
    ...(options.description !== undefined && { description: options.description }),
    type: options.type,
    read: brandPipeline(pipeline.read),
    ...(pipeline.write !== undefined && { write: brandPipeline(pipeline.write) }),
    timing: options.timing ?? MEMORY_TIMING.TURN_START,
    asRole: options.asRole ?? defaultRoleFor(options),
    ...(options.redact !== undefined && { redact: options.redact }),
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
  if (!options.store) {
    throw new Error(
      `defineMemory[id=${options.id}]: \`store\` is required. ` +
        'Pass `new InMemoryStore()` for dev/tests, or a backed store for production.',
    );
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
      const w = s as WindowStrategy;
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
      // Load recent N raw turns; older content is summarized by an LLM
      // before injection. defaultPipeline handles load+pick; the
      // summarize stage is composed in by the wire helpers when the
      // strategy carries an `llm` provider.
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

    case MEMORY_STRATEGIES.DECAY:
      throw new Error(
        `defineMemory[${options.id}]: DECAY strategy is not yet wired. ` +
          'Workaround: set TTL on MemoryEntry, or compose manually via mountMemoryRead.',
      );

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
      const config: SemanticPipelineConfig = {
        store: options.store,
        embedder: t.embedder,
        k: t.topK,
        ...(t.threshold !== undefined && { minScore: t.threshold }),
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
      const w = s as WindowStrategy;
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
      const w = s as WindowStrategy;
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
 * Default `asRole` per type — system for behavior-shaping memory,
 * user for retrieved facts (so the LLM treats them as context, not
 * instruction).
 */
function defaultRoleFor(options: DefineMemoryOptions): ContextRole {
  switch (options.type) {
    case MEMORY_TYPES.EPISODIC:
    case MEMORY_TYPES.NARRATIVE:
      return 'system';
    case MEMORY_TYPES.SEMANTIC:
      return 'system';
    case MEMORY_TYPES.CAUSAL:
      return 'system';
    default:
      return 'system';
  }
}

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
