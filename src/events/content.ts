/**
 * content — what every typed event carries, declared ONCE per event type, from
 * the one event registry: which payload fields are the record's STRUCTURE —
 * each with the KIND of value it holds — and which words it quotes under
 * names of its own, with the values those words come from.
 *
 * Pattern: a classification table, exhaustive by type over
 *          `AgentfootprintEventType` (the HOOKS-registry precedent): a new event
 *          type does not compile until it is classified here, and every
 *          structure field — at every depth — is checked against its
 *          payload's own type (`KindFor`).
 * Role:    the data the served path reads (`redaction/served.ts`). It decides
 *          nothing about what is secret — footprintjs's rule does — it says
 *          what each event IS, so the served path can be DEFAULT-DENY:
 *
 *   - `structure` — a field is structure ONLY when its value comes from a
 *     closed set the library or the app DECLARED. Its kind says which:
 *       · `count`        — a finite number;
 *       · `flag`         — a boolean;
 *       · `enum`         — one of the library's verdict words, listed here
 *                          exhaustively (a new member does not compile until
 *                          it is);
 *       · `mintedId`     — an id the library, a provider or a store minted: a
 *                          single token;
 *       · `declaredName` — a name declared at build time (a tool's, an
 *                          argument's, a skill's, the runner's configuration —
 *                          `redaction/names.ts`), or registered by the run from
 *                          a declared source.
 *     Lists, records and maps of those. The KIND IS ENFORCED when the record
 *     is served: a value that does not fit it — a string in a count, a name
 *     nothing declared (a tool the model made up), free text in an id — is
 *     served as the placeholder. A misclassified field fails loudly, never
 *     silently.
 *   - `words` — content carried under a name of its own, with the values it
 *     is derived from (a parser's message quotes the model's draft): kept out
 *     whenever the rule keeps out any part of one of them — under ANY policy.
 *   - every other field, at every depth — CONTENT BY DEFAULT: under a policy
 *     that keeps the conversation out (`conversationRedaction()` or more),
 *     served as the placeholder. A field nobody classified can never carry the
 *     conversation into a record.
 *
 * Anything whose value can carry what a person, the model, a tool or the data
 * wrote is content: free text, a label or description, a tool-written date or
 * source, a data-derived id, an error's name or class. Checked against real
 * runs: under the vocabulary no canary of any feature reaches a record
 * (`test/redaction/agent-redaction.vocabulary.test.ts`), and every structure
 * field is fed a value outside its kind and must mask it
 * (`test/redaction/event-content.test.ts`).
 */

import type { NameSpace } from '../redaction/names.js';
import type { AgentfootprintEventMap, AgentfootprintEventType } from './registry.js';

/** Content an event carries under a name of its own, and the values it is derived from. */
export interface EventWords {
  /** Where it sits in the payload: dotted, `name[]` for each element of a list. */
  readonly paths: readonly string[];
  /** The names it is derived from: kept out whenever the rule keeps out any part of one. */
  readonly from: readonly string[];
  /**
   * A field beside the value that NAMES the argument it quotes (a validation
   * issue's `path`, `'customer.ssn'`): the value is kept out too when the rule
   * would keep out a value at that path of a call's arguments.
   */
  readonly namedBy?: string;
  /**
   * A path, from the payload's root, to the object the value was RENDERED from
   * (a check-in's `willDo` writes the call's arguments as `k=v` text): the
   * value is kept out too whenever the rule kept out anything inside it.
   */
  readonly namesAt?: string;
}

/** The payload of event type `K`. */
type PayloadOf<K extends AgentfootprintEventType> = AgentfootprintEventMap[K]['payload'];

// ─── kinds ──────────────────────────────────────────────────────────

/** A finite number — a count, a size, a timing, a score, a numeric timestamp. */
export interface CountKind {
  readonly kind: 'count';
}
/** A boolean. */
export interface FlagKind {
  readonly kind: 'flag';
}
/** One of a closed set of the library's verdict words — every member listed. */
export interface EnumKind<L extends string = string> {
  readonly kind: 'enum';
  readonly of: { readonly [W in L]: true };
}
/** An id the library, a provider or a store minted: one token, no whitespace. */
export interface MintedIdKind {
  readonly kind: 'mintedId';
}
/** A name declared at build time, or registered by the run from a declared source. */
export interface DeclaredNameKind {
  readonly kind: 'declaredName';
  readonly of: NameSpace;
}
/** A list whose every element is of kind `of`. */
export interface ListKind<K extends StructureKind = StructureKind> {
  readonly kind: 'list';
  readonly of: K;
}
/** A record: the declared fields, each of its kind; every other field is content. */
export interface RecordKind<T = Record<string, unknown>> {
  readonly kind: 'record';
  readonly fields: { readonly [F in keyof T & string]?: KindFor<T[F]> };
}
/** A map: every key of kind `key` (or the whole map is content), every value of kind `value`. */
export interface MapKind {
  readonly kind: 'map';
  readonly key: StructureKind;
  readonly value: StructureKind;
}
/** A value that fits any one of `of` — a field one of several closed sets fill. */
export interface AnyOfKind {
  readonly kind: 'anyOf';
  readonly of: readonly StructureKind[];
}

/** Every kind a structure field can have. */
export type StructureKind =
  | CountKind
  | FlagKind
  | EnumKind
  | MintedIdKind
  | DeclaredNameKind
  | ListKind
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record's own fields are checked where it is declared (`KindFor`)
  | RecordKind<any>
  | MapKind
  | AnyOfKind;

type Present<V> = Exclude<V, undefined | null>;

/**
 * The kinds a field of type `V` may be declared with — so a classification
 * names only fields its payload has, at every depth, and lists every member
 * of a verdict-word union (`EnumKind`'s `of` is exhaustive by construction).
 */
export type KindFor<V> = [Present<V>] extends [boolean]
  ? FlagKind
  : [Present<V>] extends [number]
  ? CountKind
  : [Present<V>] extends [string]
  ? string extends Present<V>
    ? MintedIdKind | DeclaredNameKind | AnyOfKind
    : EnumKind<Present<V> & string> | MintedIdKind | DeclaredNameKind | AnyOfKind
  : [Present<V>] extends [readonly (infer E)[]]
  ? ListKind<KindFor<E>>
  : [Present<V>] extends [object]
  ? RecordKind<Present<V>> | MapKind
  : StructureKind;

const COUNT: CountKind = { kind: 'count' };
const FLAG: FlagKind = { kind: 'flag' };
const MINTED_ID: MintedIdKind = { kind: 'mintedId' };
const TOOL_NAME: DeclaredNameKind = { kind: 'declaredName', of: 'tool' };
const ARGUMENT_NAME: DeclaredNameKind = { kind: 'declaredName', of: 'argument' };
const SKILL_ID: DeclaredNameKind = { kind: 'declaredName', of: 'skill' };
const CONFIG_NAME: DeclaredNameKind = { kind: 'declaredName', of: 'config' };

/** One event type's classification — its structure fields checked against its payload's own type. */
export interface EventContent<K extends AgentfootprintEventType = AgentfootprintEventType> {
  /** Payload fields that carry no content, each with its kind — every other field is content. */
  readonly structure: { readonly [F in keyof PayloadOf<K> & string]?: KindFor<PayloadOf<K>[F]> };
  /** Words carried under names of their own, kept out with what they come from. */
  readonly words?: readonly EventWords[];
}

/** The classification as the served path reads it — every type alike. */
export interface ClassifiedContent {
  readonly structure: Readonly<Record<string, StructureKind>>;
  readonly words?: readonly EventWords[];
}

/** The words a person or the model wrote, wherever the library quotes them. */
const CONVERSATION_TEXT = ['userMessage', 'message', 'history'] as const;
const MODEL_TEXT = ['llmLatestContent', 'finalContent', 'content'] as const;

/**
 * The words of a coverage declaration's lists at `at` (`''` = the payload's
 * root) — prose a tool composes at run time, often from its call's arguments
 * and its result. The lists, their length and each item's `kind` are structure.
 */
function coverageWords(at: string, lists: readonly string[]): readonly string[] {
  const prefix = at === '' ? '' : `${at}.`;
  return lists.flatMap((list) =>
    ['what', 'why', 'short'].map((field) => `${prefix}${list}[].${field}`),
  );
}

const COVERAGE_LISTS = ['checked', 'notChecked', 'cannotCover'] as const;

/** A check-in's evidence pack (`core/checkin.ts` · `CheckInRequest`) at `at` in a payload. */
function checkInPack(at: string): readonly EventWords[] {
  return [
    { paths: [`${at}.intent`], from: MODEL_TEXT },
    { paths: [`${at}.evidence.willDo`], from: ['args'], namesAt: `${at}.args` },
    {
      paths: [`${at}.evidence.read[].summary`, `${at}.evidence.drivers[].text`],
      from: [...CONVERSATION_TEXT, 'result'],
    },
  ];
}

/**
 * Every event type, classified. `Object.freeze`d data, read by the served path
 * only — never a registry of runs, values or listeners.
 */
export const EVENT_CONTENT: { readonly [K in AgentfootprintEventType]: EventContent<K> } = {
  // ── composition ────────────────────────────────────────────────────────
  'agentfootprint.composition.enter': {
    structure: {
      kind: { kind: 'enum', of: { Sequence: true, Parallel: true, Conditional: true, Loop: true } },
      id: CONFIG_NAME,
      name: CONFIG_NAME,
      childCount: COUNT,
    },
  },
  'agentfootprint.composition.exit': {
    structure: {
      kind: { kind: 'enum', of: { Sequence: true, Parallel: true, Conditional: true, Loop: true } },
      id: CONFIG_NAME,
      name: CONFIG_NAME,
      status: { kind: 'enum', of: { ok: true, err: true, break: true, budget_exhausted: true } },
      durationMs: COUNT,
    },
  },
  'agentfootprint.composition.fork_start': {
    structure: {
      parentId: CONFIG_NAME,
      branches: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: CONFIG_NAME,
            name: CONFIG_NAME,
          },
        },
      },
    },
  },
  'agentfootprint.composition.branch_complete': {
    structure: {
      parentId: CONFIG_NAME,
      branchId: CONFIG_NAME,
      status: { kind: 'enum', of: { ok: true, err: true } },
      durationMs: COUNT,
    },
  },
  'agentfootprint.composition.merge_end': {
    structure: {
      parentId: CONFIG_NAME,
      strategy: { kind: 'enum', of: { llm: true, fn: true, 'outcomes-fn': true } },
      mergedBranchCount: COUNT,
      totalBranchCount: COUNT,
    },
  },
  'agentfootprint.composition.route_decided': {
    structure: {
      conditionalId: CONFIG_NAME,
      chosen: CONFIG_NAME,
    },
  },
  'agentfootprint.composition.iteration_start': {
    structure: {
      loopId: CONFIG_NAME,
      iteration: COUNT,
    },
  },
  'agentfootprint.composition.iteration_exit': {
    structure: {
      loopId: CONFIG_NAME,
      iteration: COUNT,
      reason: {
        kind: 'enum',
        of: { break: true, budget: true, guard_false: true, body_complete: true },
      },
    },
  },

  // ── agent ──────────────────────────────────────────────────────────────
  'agentfootprint.agent.turn_start': {
    structure: {
      turnIndex: COUNT,
    },
  },
  'agentfootprint.agent.turn_end': {
    structure: {
      turnIndex: COUNT,
      totalInputTokens: COUNT,
      totalOutputTokens: COUNT,
      iterationCount: COUNT,
      durationMs: COUNT,
      stoppedEarly: {
        kind: 'record',
        fields: {
          reason: { kind: 'enum', of: { 'max-iterations': true, 'cost-budget': true } },
          iteration: COUNT,
          pendingToolCalls: COUNT,
          wrappedUp: FLAG,
        },
      },
      answerAssessment: {
        kind: 'record',
        fields: {
          assessment: {
            kind: 'enum',
            of: { known: true, unrefuted: true, unknown: true, 'not-applicable': true },
          },
          standing: {
            kind: 'enum',
            of: {
              known: true,
              consistent: true,
              'not-sure': true,
              ask: true,
              'not-assessed': true,
            },
          },
          reasons: {
            kind: 'list',
            of: {
              kind: 'enum',
              of: {
                asked: true,
                'argument-asked': true,
                'argument-assumed': true,
                'argument-unverified': true,
                'argument-read': true,
                'value-contingent': true,
                'declared-absent': true,
                'coverage-gap': true,
                'empty-undeclared': true,
                'period-not-held': true,
                'period-partly-held': true,
                'period-unknown': true,
                'period-undeclared': true,
                'period-differs-from-asked': true,
                'period-beyond-retention': true,
                'sources-conflict': true,
                'value-unsupported': true,
                'value-survived-revision': true,
                'derived-from-reading': true,
                'stopped-early': true,
                'steps-unfinished': true,
                'answer-check-failed': true,
                'check-unreachable': true,
              },
            },
          },
          checked: {
            kind: 'list',
            of: {
              kind: 'record',
              fields: {
                layer: COUNT,
                check: {
                  kind: 'enum',
                  of: {
                    'argument-rules': true,
                    'argument-sources': true,
                    'result-period': true,
                    'tool-coverage': true,
                    'result-shape': true,
                    'names-and-numbers': true,
                    'answer-checks': true,
                  },
                },
                ran: COUNT,
                of: COUNT,
              },
            },
          },
        },
      },
      refused: {
        kind: 'record',
        fields: {
          by: { kind: 'enum', of: { 'evidence-rails': true } },
        },
      },
    },
    words: [
      { paths: ['answerCoverage.assumed[].value'], from: ['args'], namedBy: 'argument' },
      { paths: coverageWords('answerCoverage', COVERAGE_LISTS), from: ['args', 'result'] },
    ],
  },
  'agentfootprint.agent.iteration_start': {
    structure: {
      turnIndex: COUNT,
      iterIndex: COUNT,
    },
  },
  'agentfootprint.agent.iteration_end': {
    structure: {
      turnIndex: COUNT,
      iterIndex: COUNT,
      toolCallCount: COUNT,
    },
  },
  'agentfootprint.agent.route_decided': {
    structure: {
      turnIndex: COUNT,
      iterIndex: COUNT,
      chosen: {
        kind: 'enum',
        of: {
          'tool-calls': true,
          final: true,
          'output-retry': true,
          'step-nudge': true,
          'evidence-recheck': true,
          'wrap-up': true,
        },
      },
    },
  },
  'agentfootprint.agent.handoff': {
    structure: {
      fromAgentId: CONFIG_NAME,
      toAgentId: CONFIG_NAME,
      viaProtocol: { kind: 'enum', of: { native: true, mcp: true, http: true } },
    },
  },
  'agentfootprint.agent.output_schema_validation_failed': {
    structure: {
      stage: { kind: 'enum', of: { 'json-parse': true, 'schema-validate': true } },
      draftWithheld: FLAG,
      attempt: COUNT,
      cumulativeRetries: COUNT,
    },
    words: [{ paths: ['message'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.output_contract_unmet': {
    structure: {
      stage: { kind: 'enum', of: { 'json-parse': true, 'schema-validate': true } },
      attempts: COUNT,
      retriesSpent: COUNT,
      fallbackConfigured: FLAG,
      iteration: COUNT,
    },
    words: [{ paths: ['error'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.output_schema_retry': {
    structure: {
      attempt: COUNT,
      retriesRemaining: COUNT,
      iteration: COUNT,
      stage: { kind: 'enum', of: { 'json-parse': true, 'schema-validate': true } },
      correctiveMessageHash: MINTED_ID,
    },
    words: [{ paths: ['error'], from: ['rawOutput'] }],
  },
  'agentfootprint.agent.evidence_checked': {
    structure: {
      iteration: COUNT,
      posture: { kind: 'enum', of: { assist: true, guard: true, rails: true } },
      candidates: COUNT,
      lookedUp: COUNT,
      action: {
        kind: 'enum',
        of: { grounded: true, flagged: true, 'revision-asked': true, refused: true },
      },
      afterRevision: FLAG,
      evidenceTruncated: FLAG,
      carriedBy: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            toolCallId: MINTED_ID,
            values: COUNT,
            only: COUNT,
          },
        },
      },
      stagedRefs: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            ref: MINTED_ID,
          },
        },
      },
      spenderTools: { kind: 'list', of: TOOL_NAME },
      computed: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            shape: {
              kind: 'anyOf',
              of: [{ kind: 'enum', of: { identifier: true, number: true } }],
            },
            derivation: {
              kind: 'anyOf',
              of: [
                {
                  kind: 'enum',
                  of: {
                    rounded: true,
                    'unit-scale': true,
                    'column-sum': true,
                    'column-ratio': true,
                    'column-difference': true,
                    complement: true,
                  },
                },
              ],
            },
          },
        },
      },
    },
    words: [{ paths: ['computed[].value', 'computed[].from'], from: [...MODEL_TEXT, 'result'] }],
  },
  'agentfootprint.agent.grounding_nudged': {
    structure: {
      iteration: COUNT,
      refs: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            ref: MINTED_ID,
          },
        },
      },
      refsOmitted: COUNT,
      tools: { kind: 'list', of: TOOL_NAME },
    },
  },
  'agentfootprint.agent.run_configured': {
    structure: {
      agentId: CONFIG_NAME,
      llm: {
        kind: 'record',
        fields: {
          provider: CONFIG_NAME,
          model: CONFIG_NAME,
          modelOverrides: {
            kind: 'list',
            of: { kind: 'enum', of: { configure: true, 'skill-brains': true } },
          },
        },
      },
      reactMode: { kind: 'enum', of: { classic: true, dynamic: true, 'dynamic-grouped': true } },
      memories: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: CONFIG_NAME,
            type: {
              kind: 'enum',
              of: { episodic: true, semantic: true, narrative: true, causal: true },
            },
            strategy: {
              kind: 'enum',
              of: {
                budget: true,
                window: true,
                summarize: true,
                topK: true,
                extract: true,
                decay: true,
                hybrid: true,
              },
            },
            retrieval: CONFIG_NAME,
            embedderId: CONFIG_NAME,
            flavor: { kind: 'enum', of: { memory: true, rag: true } },
          },
        },
      },
      window: CONFIG_NAME,
      skillGraph: {
        kind: 'record',
        fields: {
          routing: { kind: 'enum', of: { assist: true, guard: true, rails: true } },
          continuity: { kind: 'enum', of: { turn: true, conversation: true } },
          scorer: CONFIG_NAME,
        },
      },
      evidenceGate: { kind: 'enum', of: { assist: true, guard: true, rails: true } },
      artifacts: {
        kind: 'record',
        fields: {
          placement: FLAG,
          recordings: FLAG,
        },
      },
      recipes: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: CONFIG_NAME,
            version: CONFIG_NAME,
          },
        },
      },
    },
  },
  'agentfootprint.agent.thinking_parse_failed': {
    structure: {
      providerName: CONFIG_NAME,
      subflowId: MINTED_ID,
      iteration: COUNT,
    },
  },
  'agentfootprint.agent.budget_exhausted': {
    structure: {
      reason: { kind: 'enum', of: { 'max-iterations': true, 'cost-budget': true } },
      iteration: COUNT,
      limit: COUNT,
      pendingToolCalls: COUNT,
      action: { kind: 'enum', of: { 'wrapped-up': true, 'cut-short': true } },
    },
  },

  // ── stream ─────────────────────────────────────────────────────────────
  'agentfootprint.stream.llm_start': {
    structure: {
      iteration: COUNT,
      provider: CONFIG_NAME,
      model: CONFIG_NAME,
      systemPromptChars: COUNT,
      messagesCount: COUNT,
      toolsCount: COUNT,
      tools: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            name: TOOL_NAME,
          },
        },
      },
      estimatedPromptTokens: COUNT,
      temperature: COUNT,
      providerRequestRef: MINTED_ID,
      brain: {
        kind: 'record',
        fields: {
          via: { kind: 'enum', of: { skill: true, escalation: true } },
          skillId: SKILL_ID,
        },
      },
    },
  },
  'agentfootprint.stream.llm_end': {
    structure: {
      iteration: COUNT,
      contentWithheld: FLAG,
      toolCallCount: COUNT,
      usage: {
        kind: 'record',
        fields: {
          input: COUNT,
          output: COUNT,
          cacheRead: COUNT,
          cacheWrite: COUNT,
          thinking: COUNT,
        },
      },
      stopReason: MINTED_ID,
      durationMs: COUNT,
      providerResponseRef: MINTED_ID,
    },
  },
  'agentfootprint.stream.token': {
    structure: {
      iteration: COUNT,
      tokenIndex: COUNT,
    },
  },
  'agentfootprint.stream.tool_start': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      parallelCount: COUNT,
      protocol: { kind: 'enum', of: { native: true, mcp: true, http: true, 'python-fn': true } },
      notDispatched: {
        kind: 'record',
        fields: {
          pausedCall: {
            kind: 'record',
            fields: {
              toolCallId: MINTED_ID,
              toolName: TOOL_NAME,
            },
          },
        },
      },
    },
  },
  'agentfootprint.stream.tool_progress': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
    },
    words: [{ paths: ['payload'], from: ['result'] }],
  },
  'agentfootprint.stream.tool_end': {
    structure: {
      toolCallId: MINTED_ID,
      error: FLAG,
      durationMs: COUNT,
      status: {
        kind: 'enum',
        of: {
          success: true,
          failure: true,
          denied: true,
          invalid: true,
          partial: true,
          pending: true,
          absent: true,
        },
      },
      notDispatched: {
        kind: 'record',
        fields: {
          pausedCall: {
            kind: 'record',
            fields: {
              toolCallId: MINTED_ID,
              toolName: TOOL_NAME,
            },
          },
        },
      },
      changedArgKeys: { kind: 'list', of: ARGUMENT_NAME },
      notExecuted: FLAG,
    },
  },
  'agentfootprint.stream.thinking_delta': {
    structure: {
      iteration: COUNT,
      tokenIndex: COUNT,
    },
  },
  'agentfootprint.stream.thinking_end': {
    structure: {
      iteration: COUNT,
      blockCount: COUNT,
      totalChars: COUNT,
      tokens: COUNT,
    },
  },

  // ── context ────────────────────────────────────────────────────────────
  'agentfootprint.context.injected': {
    structure: {
      contentHash: MINTED_ID,
      slot: { kind: 'enum', of: { 'system-prompt': true, messages: true, tools: true } },
      asRole: { kind: 'enum', of: { system: true, user: true, assistant: true, tool: true } },
      asRecency: { kind: 'enum', of: { latest: true, earlier: true } },
      position: COUNT,
      source: {
        kind: 'enum',
        of: {
          memory: true,
          rag: true,
          custom: true,
          skill: true,
          user: true,
          assistant: true,
          instructions: true,
          'evidence-recovery': true,
          findings: true,
          ontology: true,
          steering: true,
          fact: true,
          'tool-result': true,
          base: true,
          registry: true,
        },
      },
      sourceId: { kind: 'anyOf', of: [CONFIG_NAME, SKILL_ID, TOOL_NAME, MINTED_ID] },
      retrievalScore: COUNT,
      rankPosition: COUNT,
      threshold: COUNT,
      budgetSpent: {
        kind: 'record',
        fields: {
          tokens: COUNT,
          fractionOfCap: COUNT,
        },
      },
      expiresAfter: {
        kind: 'enum',
        of: { turn: true, iteration: true, run: true, persistent: true },
      },
    },
  },
  'agentfootprint.context.evicted': {
    structure: {
      slot: { kind: 'enum', of: { 'system-prompt': true, messages: true, tools: true } },
      contentHash: MINTED_ID,
      reason: {
        kind: 'enum',
        of: { budget: true, stale: true, low_score: true, policy: true, user_revoked: true },
      },
      survivalMs: COUNT,
    },
  },
  'agentfootprint.context.slot_composed': {
    structure: {
      slot: { kind: 'enum', of: { 'system-prompt': true, messages: true, tools: true } },
      iteration: COUNT,
      budget: {
        kind: 'record',
        fields: {
          cap: COUNT,
          used: COUNT,
          headroomChars: COUNT,
        },
      },
      sourceBreakdown: {
        kind: 'record',
        fields: {
          memory: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          rag: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          custom: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          skill: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          user: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          assistant: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          instructions: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          'evidence-recovery': { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          findings: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          ontology: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          steering: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          fact: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          'tool-result': { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          base: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
          registry: { kind: 'record', fields: { chars: COUNT, count: COUNT } },
        },
      },
      orderingStrategy: {
        kind: 'anyOf',
        of: [
          {
            kind: 'enum',
            of: {
              'history-order': true,
              'registry+injections': true,
              'registry+provider+injections': true,
            },
          },
        ],
      },
      droppedCount: COUNT,
    },
  },
  'agentfootprint.context.budget_pressure': {
    structure: {
      slot: { kind: 'enum', of: { 'system-prompt': true, messages: true, tools: true } },
      overflowBy: COUNT,
      planAction: { kind: 'enum', of: { summarize: true, evict: true, abort: true, none: true } },
      unit: { kind: 'enum', of: { chars: true, tokens: true } },
      cap: COUNT,
      projected: COUNT,
    },
  },
  'agentfootprint.context.evaluated': {
    structure: {
      iteration: COUNT,
      activeCount: COUNT,
      skippedCount: COUNT,
      evaluatedTotal: COUNT,
      activeIds: { kind: 'list', of: CONFIG_NAME },
      skippedDetails: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: CONFIG_NAME,
            reason: {
              kind: 'enum',
              of: {
                'predicate-threw': true,
                'unknown-trigger-kind': true,
                'unknown-fact': true,
                parked: true,
              },
            },
          },
        },
      },
      triggerKindCounts: {
        kind: 'map',
        key: {
          kind: 'anyOf',
          of: [
            {
              kind: 'enum',
              of: { always: true, rule: true, 'on-tool-return': true, 'llm-activated': true },
            },
          ],
        },
        value: COUNT,
      },
      skillCatalog: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: SKILL_ID,
          },
        },
      },
      routing: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            injectionId: CONFIG_NAME,
            flavor: {
              kind: 'anyOf',
              of: [
                {
                  kind: 'enum',
                  of: {
                    memory: true,
                    rag: true,
                    custom: true,
                    skill: true,
                    user: true,
                    assistant: true,
                    instructions: true,
                    'evidence-recovery': true,
                    findings: true,
                    ontology: true,
                    steering: true,
                    fact: true,
                    'tool-result': true,
                    base: true,
                    registry: true,
                  },
                },
              ],
            },
            via: {
              kind: 'anyOf',
              of: [{ kind: 'enum', of: { tree: true, entry: true, route: true, model: true } }],
            },
            from: SKILL_ID,
            triggerKind: {
              kind: 'anyOf',
              of: [
                {
                  kind: 'enum',
                  of: { always: true, rule: true, 'on-tool-return': true, 'llm-activated': true },
                },
              ],
            },
            tools: { kind: 'list', of: TOOL_NAME },
          },
        },
      },
      cursorMove: {
        kind: 'record',
        fields: {
          from: SKILL_ID,
          to: SKILL_ID,
          by: {
            kind: 'anyOf',
            of: [
              {
                kind: 'enum',
                of: {
                  entry: true,
                  route: true,
                  'model-pick': true,
                  'tool-proposal': true,
                  intent: true,
                  continuity: true,
                  decider: true,
                  stay: true,
                  none: true,
                },
              },
            ],
          },
          offered: { kind: 'list', of: SKILL_ID },
          declinedOffer: FLAG,
          guard: {
            kind: 'record',
            fields: {
              from: SKILL_ID,
              to: SKILL_ID,
              toolName: TOOL_NAME,
              toolCallId: MINTED_ID,
              verdict: FLAG,
              conditions: {
                kind: 'list',
                of: {
                  kind: 'record',
                  fields: {
                    op: {
                      kind: 'anyOf',
                      of: [
                        {
                          kind: 'enum',
                          of: {
                            eq: true,
                            ne: true,
                            gt: true,
                            gte: true,
                            lt: true,
                            lte: true,
                            in: true,
                            notIn: true,
                          },
                        },
                      ],
                    },
                    passed: FLAG,
                  },
                },
              },
            },
          },
          guardsClosed: {
            kind: 'list',
            of: {
              kind: 'record',
              fields: {
                from: SKILL_ID,
                to: SKILL_ID,
                toolName: TOOL_NAME,
                toolCallId: MINTED_ID,
                verdict: FLAG,
                conditions: {
                  kind: 'list',
                  of: {
                    kind: 'record',
                    fields: {
                      op: {
                        kind: 'anyOf',
                        of: [
                          {
                            kind: 'enum',
                            of: {
                              eq: true,
                              ne: true,
                              gt: true,
                              gte: true,
                              lt: true,
                              lte: true,
                              in: true,
                              notIn: true,
                            },
                          },
                        ],
                      },
                      passed: FLAG,
                    },
                  },
                },
              },
            },
          },
          reachable: { kind: 'list', of: SKILL_ID },
        },
      },
      supersededIds: { kind: 'list', of: CONFIG_NAME },
    },
    words: [
      { paths: ['cursorMove.witness.text'], from: CONVERSATION_TEXT },
      {
        paths: [
          'cursorMove.guard.conditions[].actualSummary',
          'cursorMove.guardsClosed[].conditions[].actualSummary',
        ],
        from: ['result'],
      },
    ],
  },

  // ── memory ─────────────────────────────────────────────────────────────
  'agentfootprint.memory.strategy_applied': {
    structure: {
      strategyId: CONFIG_NAME,
      strategyKind: {
        kind: 'enum',
        of: {
          semantic: true,
          hybrid: true,
          'sliding-window': true,
          summarizing: true,
          'fact-extraction': true,
        },
      },
      inputMemoryCount: COUNT,
      outputMemoryCount: COUNT,
    },
  },
  'agentfootprint.memory.attached': {
    structure: {
      score: COUNT,
      rank: COUNT,
      source: { kind: 'enum', of: { store: true, 'auto-extract': true, manual: true } },
      retriever: {
        kind: 'enum',
        of: { custom: true, pinecone: true, weaviate: true, qdrant: true, chroma: true },
      },
    },
  },
  'agentfootprint.memory.retrieved': {
    structure: {
      strategy: CONFIG_NAME,
      queryHash: MINTED_ID,
      k: COUNT,
      threshold: COUNT,
      maxChars: COUNT,
      charsUsed: COUNT,
      embedderId: CONFIG_NAME,
      dimensions: COUNT,
      consideredCount: COUNT,
      admittedCount: COUNT,
      rejectedCount: COUNT,
      candidates: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            score: COUNT,
            rank: COUNT,
            admitted: FLAG,
            reason: {
              kind: 'enum',
              of: {
                'below-threshold': true,
                'over-budget': true,
                'over-max-entries': true,
                'over-char-budget': true,
              },
            },
            page: COUNT,
          },
        },
      },
      candidatesComplete: FLAG,
      corpusEmpty: FLAG,
    },
    words: [{ paths: ['candidates[].heading'], from: ['retrieved'] }],
  },
  'agentfootprint.memory.detached': {
    structure: {
      reason: { kind: 'enum', of: { budget: true, stale: true, policy: true, score_low: true } },
    },
  },
  'agentfootprint.memory.written': {
    structure: {
      source: { kind: 'enum', of: { manual: true, auto: true } },
    },
  },

  // ── tools ──────────────────────────────────────────────────────────────
  'agentfootprint.tools.offered': {
    structure: {
      availableIds: { kind: 'list', of: TOOL_NAME },
      withheldIds: { kind: 'list', of: TOOL_NAME },
      withheldReasons: {
        kind: 'map',
        key: TOOL_NAME,
        value: {
          kind: 'enum',
          of: { permission: true, skill_inactive: true, gated: true, cost_guard: true },
        },
      },
    },
  },
  'agentfootprint.tools.activated': {
    structure: {
      toolId: TOOL_NAME,
      reason: {
        kind: 'enum',
        of: { skill_activated: true, autoActivate: true, permission_granted: true },
      },
    },
  },
  'agentfootprint.tools.deactivated': {
    structure: {
      toolId: TOOL_NAME,
      reason: { kind: 'enum', of: { skill_deactivated: true, permission_revoked: true } },
    },
  },
  'agentfootprint.tools.discovery_started': {
    structure: {
      providerId: CONFIG_NAME,
      iteration: COUNT,
    },
  },
  'agentfootprint.tools.discovery_completed': {
    structure: {
      providerId: CONFIG_NAME,
      iteration: COUNT,
      durationMs: COUNT,
      toolCount: COUNT,
    },
  },
  'agentfootprint.tools.discovery_failed': {
    structure: {
      providerId: CONFIG_NAME,
      iteration: COUNT,
      durationMs: COUNT,
    },
  },
  'agentfootprint.tools.shadowed': {
    structure: {
      toolName: TOOL_NAME,
      iteration: COUNT,
      schemaFrom: {
        kind: 'enum',
        of: { skill: true, registry: true, provider: true, framework: true },
      },
      schemaFromId: { kind: 'anyOf', of: [SKILL_ID, CONFIG_NAME] },
      dispatchTo: {
        kind: 'enum',
        of: { skill: true, registry: true, provider: true, framework: true },
      },
      dispatchToId: { kind: 'anyOf', of: [SKILL_ID, CONFIG_NAME] },
    },
  },
  'agentfootprint.tools.claim_swallowed': {
    structure: {
      toolName: TOOL_NAME,
      iteration: COUNT,
      lostBy: {
        kind: 'enum',
        of: { skill: true, registry: true, provider: true, framework: true },
      },
      lostById: { kind: 'anyOf', of: [SKILL_ID, CONFIG_NAME] },
      wonBy: { kind: 'enum', of: { skill: true, registry: true, provider: true, framework: true } },
      wonById: { kind: 'anyOf', of: [SKILL_ID, CONFIG_NAME] },
    },
  },
  'agentfootprint.tools.answered_off_wire': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      answeredBy: {
        kind: 'enum',
        of: { skill: true, registry: true, provider: true, framework: true },
      },
      answeredById: { kind: 'anyOf', of: [SKILL_ID, CONFIG_NAME] },
    },
  },
  'agentfootprint.tools.session_started': {
    structure: {
      tool: TOOL_NAME,
      scope: { kind: 'enum', of: { run: true, call: true, session: true, shutdown: true } },
      keyHash: MINTED_ID,
      runnerId: CONFIG_NAME,
    },
  },
  'agentfootprint.tools.session_reused': {
    structure: {
      calls: COUNT,
      tool: TOOL_NAME,
      scope: { kind: 'enum', of: { run: true, call: true, session: true, shutdown: true } },
      keyHash: MINTED_ID,
      runnerId: CONFIG_NAME,
    },
  },
  'agentfootprint.tools.session_closed': {
    structure: {
      reason: {
        kind: 'enum',
        of: {
          shutdown: true,
          'call-end': true,
          'run-end': true,
          'session-end': true,
          idle: true,
          evicted: true,
        },
      },
      durationMs: COUNT,
      tool: TOOL_NAME,
      scope: { kind: 'enum', of: { run: true, call: true, session: true, shutdown: true } },
      keyHash: MINTED_ID,
      runnerId: CONFIG_NAME,
    },
  },
  'agentfootprint.tools.session_close_failed': {
    structure: {
      reason: {
        kind: 'enum',
        of: {
          shutdown: true,
          'call-end': true,
          'run-end': true,
          'session-end': true,
          idle: true,
          evicted: true,
        },
      },
      durationMs: COUNT,
      tool: TOOL_NAME,
      scope: { kind: 'enum', of: { run: true, call: true, session: true, shutdown: true } },
      keyHash: MINTED_ID,
      runnerId: CONFIG_NAME,
    },
  },
  'agentfootprint.tools.effect': {
    structure: {
      kind: { kind: 'enum', of: { 'propose-transition': true, 'require-instruction': true } },
      outcome: { kind: 'enum', of: { refused: true, accepted: true, superseded: true } },
      stay: FLAG,
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      targetSkillId: SKILL_ID,
      deliveryLease: { kind: 'enum', of: { 'next-call': true, 'until-skill-exit': true } },
      supersededBy: { kind: 'enum', of: { 'earlier-proposal': true } },
    },
    words: [{ paths: ['reason', 'refusalReason'], from: ['args', 'result'] }],
  },
  'agentfootprint.tools.result_refused': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      sizeChars: COUNT,
      maxChars: COUNT,
      narrowBy: { kind: 'list', of: ARGUMENT_NAME },
      declaredStatus: {
        kind: 'enum',
        of: {
          success: true,
          failure: true,
          denied: true,
          invalid: true,
          partial: true,
          pending: true,
          absent: true,
        },
      },
    },
  },
  'agentfootprint.tools.repeated_call': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      occurrences: COUNT,
      argsFingerprint: MINTED_ID,
      resultFingerprint: MINTED_ID,
      mode: { kind: 'enum', of: { arguments: true } },
    },
  },
  'agentfootprint.tools.absent': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      checked: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      notChecked: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      cannotCover: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      tryInsteadTool: {
        kind: 'record',
        fields: {
          tool: TOOL_NAME,
        },
      },
      provenance: {
        kind: 'record',
        fields: {
          ageSeconds: COUNT,
        },
      },
    },
    words: [
      {
        paths: [
          'lookedFor',
          'tryInstead',
          'tryInsteadTool.why',
          ...coverageWords('', COVERAGE_LISTS),
        ],
        from: ['args', 'result'],
      },
    ],
  },
  'agentfootprint.tools.code_run': {
    structure: {
      tool: TOOL_NAME,
      stagedInputs: COUNT,
      outputChars: COUNT,
      truncated: FLAG,
      ok: FLAG,
      shapeHash: MINTED_ID,
    },
  },
  'agentfootprint.tools.coverage_declared': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      checked: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      notChecked: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      cannotCover: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            kind: { kind: 'enum', of: { existence: true, scope: true } },
          },
        },
      },
      inProgress: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            count: COUNT,
          },
        },
      },
    },
    words: [
      { paths: coverageWords('', [...COVERAGE_LISTS, 'inProgress']), from: ['args', 'result'] },
    ],
  },
  'agentfootprint.tools.semantics_declared': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      semantics: {
        kind: 'record',
        fields: {
          af_semantics: FLAG,
        },
      },
    },
    words: [
      {
        paths: [
          'semantics.facts',
          'semantics.series',
          'semantics.edges',
          'semantics.clarify.candidates',
        ],
        from: ['result'],
      },
      {
        paths: [
          'semantics.clarify.question',
          'semantics.not_covered',
          ...coverageWords('semantics.coverage', ['checked', 'not_checked', 'cannot_cover']),
          'semantics.render.filter_note',
          'semantics.render.chart_hint',
          'semantics.render.columns',
          'semantics.render.sort',
          'semantics.grain.collapsed',
        ],
        from: ['args', 'result'],
      },
    ],
  },

  // ── skill ──────────────────────────────────────────────────────────────
  'agentfootprint.skill.activated': {
    structure: {
      skillId: SKILL_ID,
      reason: { kind: 'enum', of: { manual: true, autoActivate: true, read_skill_result: true } },
      injectedTools: { kind: 'list', of: TOOL_NAME },
      injectedSystemPromptChars: COUNT,
    },
  },
  'agentfootprint.skill.graph_declared': {
    structure: {
      nodes: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: SKILL_ID,
            kind: { kind: 'anyOf', of: [{ kind: 'enum', of: { skill: true, predicate: true } }] },
          },
        },
      },
      edges: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            from: SKILL_ID,
            to: SKILL_ID,
            kind: {
              kind: 'anyOf',
              of: [
                {
                  kind: 'enum',
                  of: {
                    entry: true,
                    predicate: true,
                    'on-tool-return': true,
                    'on-tool-status': true,
                    guard: true,
                    model: true,
                  },
                },
              ],
            },
            guard: {
              kind: 'record',
              fields: {
                conditions: {
                  kind: 'list',
                  of: {
                    kind: 'record',
                    fields: {
                      op: {
                        kind: 'anyOf',
                        of: [
                          {
                            kind: 'enum',
                            of: {
                              eq: true,
                              ne: true,
                              gt: true,
                              gte: true,
                              lt: true,
                              lte: true,
                              in: true,
                              notIn: true,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  'agentfootprint.skill.deactivated': {
    structure: {
      skillId: SKILL_ID,
    },
  },
  'agentfootprint.skill.rejected': {
    structure: {
      requestedId: SKILL_ID,
      currentSkillId: SKILL_ID,
      allowed: { kind: 'list', of: SKILL_ID },
      iteration: COUNT,
      posture: { kind: 'enum', of: { guard: true, rails: true } },
      reason: { kind: 'enum', of: { 'self-call': true, unreachable: true, posture: true } },
    },
  },
  'agentfootprint.skill.reroute_superseded': {
    structure: {
      volunteeredId: SKILL_ID,
      wonId: SKILL_ID,
      fromSkillId: SKILL_ID,
      iteration: COUNT,
      source: { kind: 'enum', of: { 'tool-proposal': true } },
    },
  },
  'agentfootprint.skill.route_conflict': {
    structure: {
      iteration: COUNT,
      fromSkillId: SKILL_ID,
      winner: {
        kind: 'record',
        fields: {
          toolCallId: MINTED_ID,
          toolName: TOOL_NAME,
          target: SKILL_ID,
        },
      },
      losers: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            toolCallId: MINTED_ID,
            toolName: TOOL_NAME,
            target: SKILL_ID,
          },
        },
      },
      source: { kind: 'enum', of: { 'tool-proposal': true } },
    },
  },
  'agentfootprint.skill.turn_routed': {
    structure: {
      by: {
        kind: 'enum',
        of: { none: true, entry: true, intent: true, continuity: true, menu: true, decider: true },
      },
      from: SKILL_ID,
      to: SKILL_ID,
      scorer: CONFIG_NAME,
      scores: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            id: SKILL_ID,
            score: COUNT,
            relevance: COUNT,
          },
        },
      },
      runnerUp: {
        kind: 'record',
        fields: {
          id: SKILL_ID,
          gap: COUNT,
        },
      },
      decisive: FLAG,
      offered: { kind: 'list', of: SKILL_ID },
      stayOffered: FLAG,
      policy: {
        kind: 'record',
        fields: {
          nearTieMargin: COUNT,
          menuSize: COUNT,
          floor: COUNT,
        },
      },
      window: COUNT,
      droppedResume: {
        kind: 'record',
        fields: {
          reason: { kind: 'enum', of: { 'unknown-skill': true } },
        },
      },
      decider: {
        kind: 'record',
        fields: {
          provider: CONFIG_NAME,
          model: CONFIG_NAME,
          picked: SKILL_ID,
        },
      },
    },
    words: [{ paths: ['witness.text'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.skill.step_advanced': {
    structure: {
      skillId: SKILL_ID,
      step: {
        kind: 'record',
        fields: {
          index: COUNT,
          total: COUNT,
          tool: TOOL_NAME,
        },
      },
      iteration: COUNT,
      toolCallId: MINTED_ID,
      completed: FLAG,
    },
  },
  'agentfootprint.skill.step_skipped': {
    structure: {
      skillId: SKILL_ID,
      step: {
        kind: 'record',
        fields: {
          index: COUNT,
          total: COUNT,
          tool: TOOL_NAME,
        },
      },
      policy: { kind: 'enum', of: { advance: true, hold: true } },
      iteration: COUNT,
      toolCallId: MINTED_ID,
    },
    words: [{ paths: ['reason'], from: ['args'] }],
  },
  'agentfootprint.skill.steps_unfinished': {
    structure: {
      skillId: SKILL_ID,
      remaining: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            index: COUNT,
            tool: TOOL_NAME,
          },
        },
      },
      total: COUNT,
      action: { kind: 'enum', of: { 'cut-short': true, accepted: true, nudged: true } },
      iteration: COUNT,
    },
  },
  'agentfootprint.skill.escalated': {
    structure: {
      iteration: COUNT,
      afterRefusals: COUNT,
      refusals: COUNT,
      from: {
        kind: 'record',
        fields: {
          provider: CONFIG_NAME,
          model: CONFIG_NAME,
        },
      },
      to: {
        kind: 'record',
        fields: {
          provider: CONFIG_NAME,
          model: CONFIG_NAME,
        },
      },
    },
  },

  // ── governance ─────────────────────────────────────────────────────────
  'agentfootprint.validation.args_invalid': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      issues: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            path: ARGUMENT_NAME,
          },
        },
      },
      enforced: FLAG,
    },
    words: [{ paths: ['issues[].value'], from: ['args'], namedBy: 'path' }],
  },
  'agentfootprint.permission.check': {
    structure: {
      capability: {
        kind: 'enum',
        of: {
          memory_read: true,
          memory_write: true,
          external_net: true,
          user_data: true,
          tool_call: true,
          skill_read: true,
        },
      },
      target: { kind: 'anyOf', of: [TOOL_NAME, SKILL_ID, CONFIG_NAME] },
      policyEngine: { kind: 'enum', of: { custom: true, opa: true, cerbos: true } },
    },
    words: [{ paths: ['rationale', 'reason'], from: ['args', 'result', ...CONVERSATION_TEXT] }],
  },
  'agentfootprint.permission.gate_opened': {
    structure: {
      gateId: CONFIG_NAME,
      expiresAt: COUNT,
    },
  },
  'agentfootprint.permission.gate_closed': {
    structure: {
      gateId: CONFIG_NAME,
    },
  },
  'agentfootprint.permission.halt': {
    structure: {
      checkerId: CONFIG_NAME,
      target: { kind: 'anyOf', of: [TOOL_NAME, SKILL_ID, CONFIG_NAME] },
      iteration: COUNT,
      sequenceLength: COUNT,
    },
  },
  'agentfootprint.credential.requested': {
    structure: {
      service: CONFIG_NAME,
      mode: { kind: 'enum', of: { user: true, machine: true } },
    },
  },
  'agentfootprint.credential.acquired': {
    structure: {
      service: CONFIG_NAME,
      expiresAt: COUNT,
    },
  },
  'agentfootprint.credential.authorization_required': {
    structure: {
      service: CONFIG_NAME,
      sessionId: MINTED_ID,
    },
  },
  'agentfootprint.credential.failed': {
    structure: {
      service: CONFIG_NAME,
      tool: TOOL_NAME,
    },
  },
  'agentfootprint.risk.flagged': {
    structure: {
      severity: { kind: 'enum', of: { low: true, medium: true, high: true, critical: true } },
      category: {
        kind: 'enum',
        of: {
          pii: true,
          prompt_injection: true,
          runaway_loop: true,
          cost_overrun: true,
          hallucination_flag: true,
        },
      },
      detector: {
        kind: 'enum',
        of: { custom: true, nemo_guardrails: true, llama_guard: true, heuristic: true },
      },
      action: { kind: 'enum', of: { abort: true, warn: true, redact: true } },
    },
  },
  'agentfootprint.fallback.triggered': {
    structure: {
      kind: { kind: 'enum', of: { skill: true, tool: true, provider: true } },
      primary: { kind: 'anyOf', of: [TOOL_NAME, SKILL_ID, CONFIG_NAME] },
      fallback: { kind: 'anyOf', of: [TOOL_NAME, SKILL_ID, CONFIG_NAME] },
    },
  },

  // ── cost, eval, errors ─────────────────────────────────────────────────
  'agentfootprint.cost.tick': {
    structure: {
      scope: { kind: 'enum', of: { turn: true, iteration: true, run: true } },
      model: CONFIG_NAME,
      provider: CONFIG_NAME,
      tokensInput: COUNT,
      tokensOutput: COUNT,
      estimatedUsd: COUNT,
      cumulative: {
        kind: 'record',
        fields: {
          tokensInput: COUNT,
          tokensOutput: COUNT,
          estimatedUsd: COUNT,
        },
      },
    },
  },
  'agentfootprint.cost.limit_hit': {
    structure: {
      kind: {
        kind: 'enum',
        of: { max_tokens: true, max_cost: true, max_iterations: true, max_wallclock: true },
      },
      limit: COUNT,
      actual: COUNT,
      action: { kind: 'enum', of: { abort: true, warn: true, degrade: true } },
    },
  },
  'agentfootprint.eval.score': {
    structure: {
      metricId: CONFIG_NAME,
      value: COUNT,
      threshold: COUNT,
      target: { kind: 'enum', of: { turn: true, iteration: true, run: true, toolCall: true } },
      targetRef: MINTED_ID,
      evaluator: { kind: 'enum', of: { llm: true, fn: true, heuristic: true } },
    },
  },
  'agentfootprint.eval.threshold_crossed': {
    structure: {
      metricId: CONFIG_NAME,
      direction: { kind: 'enum', of: { above: true, below: true } },
      value: COUNT,
      threshold: COUNT,
    },
  },
  'agentfootprint.error.retried': {
    structure: {
      attempt: COUNT,
      maxAttempts: COUNT,
      backoffMs: COUNT,
      statedWaitMs: COUNT,
    },
  },
  'agentfootprint.error.recovered': {
    structure: {
      attempt: COUNT,
      totalDurationMs: COUNT,
    },
  },
  'agentfootprint.error.fatal': {
    structure: {
      stage: MINTED_ID,
    },
  },
  'agentfootprint.error.circuit_changed': {
    structure: {
      state: { kind: 'enum', of: { closed: true, open: true, 'half-open': true } },
      providerName: CONFIG_NAME,
    },
  },
  'agentfootprint.reliability.fail_fast': {
    structure: {
      phase: { kind: 'enum', of: { 'pre-check': true, 'post-decide': true } },
      attempt: COUNT,
      providerUsed: CONFIG_NAME,
    },
    words: [{ paths: ['errorMessage'], from: ['rawOutput'] }],
  },
  'agentfootprint.reliability.retried': {
    structure: {
      attempt: COUNT,
      action: { kind: 'enum', of: { retry: true, 'retry-other': true } },
      fromProvider: CONFIG_NAME,
      toProvider: CONFIG_NAME,
    },
  },
  'agentfootprint.reliability.recovered': {
    structure: {
      attempt: COUNT,
      recoveredVia: { kind: 'enum', of: { retry: true, 'retry-other': true, fallback: true } },
      priorFailures: COUNT,
    },
  },
  'agentfootprint.resilience.output_fallback_triggered': {
    structure: {
      stage: { kind: 'enum', of: { 'json-parse': true, 'schema-validate': true } },
      retriesSpent: COUNT,
    },
    words: [{ paths: ['primaryErrorMessage'], from: ['rawOutput'] }],
  },
  'agentfootprint.resilience.output_canned_used': {
    structure: {
      retriesSpent: COUNT,
    },
    words: [{ paths: ['fallbackErrorMessage'], from: ['rawOutput'] }],
  },

  // ── pause, check-in, middleware ────────────────────────────────────────
  'agentfootprint.pause.request': {
    structure: {},
    words: [
      ...checkInPack('questionPayload.checkIn'),
      // The library's own copy of the pause payload's reason (`RunnerBase · emitPauseRequest`).
      { paths: ['reason'], from: ['questionPayload'] },
    ],
  },
  'agentfootprint.pause.resume': {
    structure: {
      pausedDurationMs: COUNT,
      componentId: CONFIG_NAME,
    },
  },
  'agentfootprint.checkin.request': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
    },
    words: checkInPack('request'),
  },
  'agentfootprint.checkin.decision': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      approved: FLAG,
      componentId: CONFIG_NAME,
    },
    words: [{ paths: ['note'], from: ['resumeInput'] }],
  },
  'agentfootprint.middleware.decision': {
    structure: {
      middleware: CONFIG_NAME,
      moment: {
        kind: 'enum',
        of: { window: true, input: true, 'before-tool': true, 'after-tool': true, output: true },
      },
      at: { kind: 'enum', of: { tool: true, message: true } },
      phase: { kind: 'enum', of: { input: true, output: true } },
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      outcome: { kind: 'enum', of: { ask: true, allow: true, deny: true } },
      changed: FLAG,
      componentId: CONFIG_NAME,
    },
    words: [{ paths: ['why'], from: ['args', 'result', ...CONVERSATION_TEXT] }],
  },

  // ── findings, honesty, tool choice ─────────────────────────────────────
  'agentfootprint.findings.declared': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      basis: { kind: 'enum', of: { direct: true, exploratory: true } },
      expect: { kind: 'enum', of: { low: true, medium: true, high: true } },
      hasProposition: FLAG,
      malformed: COUNT,
    },
  },
  'agentfootprint.findings.standing': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      standing: { kind: 'enum', of: { fact: true, open: true, noise: true, 'ruled-out': true } },
      declaredOn: { kind: 'enum', of: { 'tool-call': true, answer: true } },
      assertionCount: COUNT,
      unknownId: FLAG,
      agrees: FLAG,
    },
  },
  'agentfootprint.findings.judged': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      against: { kind: 'enum', of: { proposition: true, question: true } },
      standing: { kind: 'enum', of: { fact: true, open: true, noise: true, 'ruled-out': true } },
      confidence: COUNT,
      latencyMs: COUNT,
      inputTokens: COUNT,
      outputTokens: COUNT,
    },
  },
  'agentfootprint.findings.judge_failed': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      status: COUNT,
      latencyMs: COUNT,
    },
  },
  'agentfootprint.findings.contingent': {
    structure: {
      iteration: COUNT,
      declaredOn: { kind: 'enum', of: { 'tool-call': true, answer: true } },
      toolCallId: MINTED_ID,
      carriers: COUNT,
      standings: {
        kind: 'list',
        of: { kind: 'enum', of: { fact: true, open: true, noise: true, 'ruled-out': true } },
      },
      valueChars: COUNT,
    },
  },
  'agentfootprint.findings.argument': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      turn: COUNT,
      argument: ARGUMENT_NAME,
      rule: { kind: 'enum', of: { ask: true, assume: true } },
      period: FLAG,
      source: {
        kind: 'enum',
        of: { said: true, answered: true, result: true, app: true, default: true, model: true },
      },
      asked: { kind: 'enum', of: { missing: true, unverified: true, 'invalid-answer': true } },
      claimed: {
        kind: 'enum',
        of: { turn: true, user: true, none: true, result: true, app: true, assumed: true },
      },
      matched: { kind: 'enum', of: { quote: true, phrase: true, spelling: true, mention: true } },
      reading: FLAG,
      earlier: FLAG,
      setAside: { kind: 'enum', of: { open: true, noise: true, 'ruled-out': true } },
      argumentsFrom: { kind: 'enum', of: { listed: true, unlisted: true } },
      coincides: { kind: 'enum', of: { result: true, app: true, person: true } },
      free: FLAG,
      failed: {
        kind: 'enum',
        of: {
          'quote-not-found': true,
          'composed-message': true,
          'unknown-result': true,
          'placed-result': true,
          'not-in-result': true,
          'no-earlier-turn': true,
          'not-in-earlier-turns': true,
          'only-in-model-answer': true,
          'not-in-app-text': true,
          uncheckable: true,
        },
      },
      malformed: COUNT,
      valueChars: COUNT,
    },
  },
  'agentfootprint.findings.period': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      turn: COUNT,
      verdict: {
        kind: 'enum',
        of: {
          unknown: true,
          covered: true,
          'partly-held': true,
          'not-held': true,
          undeclared: true,
        },
      },
      timeChecks: {
        kind: 'list',
        of: {
          kind: 'enum',
          of: {
            'period-differs-from-asked': true,
            'period-beyond-retention': true,
            'period-shifted': true,
            'partly-beyond-retention': true,
          },
        },
      },
    },
  },
  'agentfootprint.tool_choice.picked': {
    structure: {
      iteration: COUNT,
      chosen: TOOL_NAME,
      confidence: COUNT,
      offered: COUNT,
      served: COUNT,
      narrowed: FLAG,
      narrowedSkipped: {
        kind: 'enum',
        of: { 'wrap-up': true, unavailable: true, 'too-few': true, 'after-miss': true },
      },
      latencyMs: COUNT,
      inputTokens: COUNT,
      outputTokens: COUNT,
    },
  },
  'agentfootprint.tool_choice.outcome': {
    structure: {
      iteration: COUNT,
      called: { kind: 'list', of: TOOL_NAME },
      firstAgrees: FLAG,
      missed: { kind: 'list', of: TOOL_NAME },
    },
  },
  'agentfootprint.tool_choice.failed': {
    structure: {
      iteration: COUNT,
      status: COUNT,
      latencyMs: COUNT,
    },
  },
  'agentfootprint.ontology.served': {
    structure: {
      iteration: COUNT,
      id: CONFIG_NAME,
      version: CONFIG_NAME,
      hash: MINTED_ID,
      nodes: COUNT,
      sources: COUNT,
      edges: COUNT,
    },
  },
  'agentfootprint.answer.assessed': {
    structure: {
      turn: COUNT,
      iteration: COUNT,
      assessment: {
        kind: 'enum',
        of: { known: true, unrefuted: true, unknown: true, 'not-applicable': true },
      },
      standing: {
        kind: 'enum',
        of: { known: true, consistent: true, 'not-sure': true, ask: true, 'not-assessed': true },
      },
      reasons: {
        kind: 'list',
        of: {
          kind: 'enum',
          of: {
            asked: true,
            'argument-asked': true,
            'argument-assumed': true,
            'argument-unverified': true,
            'argument-read': true,
            'value-contingent': true,
            'declared-absent': true,
            'coverage-gap': true,
            'empty-undeclared': true,
            'period-not-held': true,
            'period-partly-held': true,
            'period-unknown': true,
            'period-undeclared': true,
            'period-differs-from-asked': true,
            'period-beyond-retention': true,
            'sources-conflict': true,
            'value-unsupported': true,
            'value-survived-revision': true,
            'derived-from-reading': true,
            'stopped-early': true,
            'steps-unfinished': true,
            'answer-check-failed': true,
            'check-unreachable': true,
          },
        },
      },
      checked: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            layer: COUNT,
            check: {
              kind: 'enum',
              of: {
                'argument-rules': true,
                'argument-sources': true,
                'result-period': true,
                'tool-coverage': true,
                'result-shape': true,
                'names-and-numbers': true,
                'answer-checks': true,
              },
            },
            ran: COUNT,
            of: COUNT,
          },
        },
      },
    },
  },
  'agentfootprint.embedding.generated': {
    structure: {
      model: CONFIG_NAME,
      provider: {
        kind: 'enum',
        of: { openai: true, cohere: true, local: true, custom: true, voyage: true },
      },
      inputKind: { kind: 'enum', of: { query: true, document: true } },
      dimension: COUNT,
      count: COUNT,
      durationMs: COUNT,
      tokensSpent: COUNT,
    },
  },

  // ── artifacts, maps, integrity ─────────────────────────────────────────
  'agentfootprint.artifacts.minted': {
    structure: {
      ref: MINTED_ID,
      bytes: COUNT,
      digest: MINTED_ID,
      expiresAt: COUNT,
      origin: {
        kind: 'record',
        fields: {
          runId: MINTED_ID,
          toolCallId: MINTED_ID,
        },
      },
      parentRefs: { kind: 'list', of: MINTED_ID },
      timeAxis: {
        kind: 'record',
        fields: {
          unit: { kind: 'enum', of: { iso: true, 'epoch-s': true, 'epoch-ms': true } },
        },
      },
      tool: TOOL_NAME,
    },
  },
  'agentfootprint.artifacts.resolved': {
    structure: {
      ref: MINTED_ID,
      via: { kind: 'enum', of: { head: true, get: true } },
      bytes: COUNT,
      tool: TOOL_NAME,
    },
  },
  'agentfootprint.artifacts.expired': {
    structure: {
      ref: MINTED_ID,
      reason: { kind: 'enum', of: { ttl: true, 'max-bytes': true, 'max-count': true } },
      bytes: COUNT,
      tool: TOOL_NAME,
    },
  },
  'agentfootprint.artifacts.refused': {
    structure: {
      op: {
        kind: 'enum',
        of: { head: true, get: true, put: true, delete: true, list: true, dispatch: true },
      },
      reason: {
        kind: 'enum',
        of: {
          'no-store': true,
          'missing-or-expired': true,
          'unknown-parent': true,
          'digest-mismatch': true,
          'invalid-input': true,
          'kind-mismatch': true,
        },
      },
      tool: TOOL_NAME,
    },
    words: [{ paths: ['ref', 'detail'], from: ['args', 'result'] }],
  },
  'agentfootprint.artifacts.presented': {
    structure: {
      ref: MINTED_ID,
      snapshot: {
        kind: 'record',
        fields: {
          bytes: COUNT,
        },
      },
      toolCallId: MINTED_ID,
      iteration: COUNT,
    },
    words: [{ paths: ['snapshot.label'], from: ['args', 'result'] }],
  },
  'agentfootprint.artifacts.hand_over_failed': {
    structure: {
      cause: {
        kind: 'enum',
        of: { abort: true, hook: true, operation: true, timeout: true, expired: true },
      },
      op: {
        kind: 'enum',
        of: { head: true, get: true, put: true, delete: true, list: true, dispatch: true },
      },
    },
  },
  'agentfootprint.map.engaged': {
    structure: {
      mapId: CONFIG_NAME,
      iteration: COUNT,
      by: {
        kind: 'enum',
        of: { semantic: true, assumed: true, explicit: true, structural: true, lexical: true },
      },
      reengaged: FLAG,
      upgraded: FLAG,
      foundedBy: {
        kind: 'enum',
        of: { semantic: true, assumed: true, explicit: true, structural: true, lexical: true },
      },
      tenantChanged: FLAG,
    },
    words: [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.map.parked': {
    structure: {
      mapId: CONFIG_NAME,
      iteration: COUNT,
      by: {
        kind: 'enum',
        of: { semantic: true, assumed: true, explicit: true, structural: true, lexical: true },
      },
      idleCalls: COUNT,
    },
    words: [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  },
  'agentfootprint.integrity.context_error': {
    structure: {
      kind: {
        kind: 'enum',
        of: {
          'invariant-violation': true,
          'unsupported-argument': true,
          'dangling-reference': true,
          'duplicate-execution': true,
          'unsupported-claim': true,
          'empty-lookup': true,
          'column-type-mismatch': true,
          'missing-column': true,
          'prior-turn-evidence': true,
        },
      },
      seam: {
        kind: 'enum',
        of: { write: true, compose: true, wire: true, choice: true, claim: true },
      },
      epoch: COUNT,
      synthetic: FLAG,
      iteration: COUNT,
    },
  },
  'agentfootprint.integrity.disposition': {
    structure: {
      posture: { kind: 'enum', of: { observe: true, dev: true } },
      workExisted: FLAG,
      rows: {
        kind: 'list',
        of: {
          kind: 'record',
          fields: {
            check: {
              kind: 'anyOf',
              of: [
                {
                  kind: 'enum',
                  of: {
                    'invariant-violation': true,
                    'unsupported-argument': true,
                    'dangling-reference': true,
                    'duplicate-execution': true,
                    'unsupported-claim': true,
                    'empty-lookup': true,
                    'column-type-mismatch': true,
                    'missing-column': true,
                    'prior-turn-evidence': true,
                  },
                },
              ],
            },
            seam: {
              kind: 'enum',
              of: { write: true, compose: true, wire: true, choice: true, claim: true },
            },
            checked: COUNT,
            findings: COUNT,
            notApplicable: COUNT,
            unreachable: COUNT,
            lastFiredAt: COUNT,
            synthetic: COUNT,
          },
        },
      },
    },
  },
  'agentfootprint.integrity.external_ground_used': {
    structure: {
      toolName: TOOL_NAME,
      toolCallId: MINTED_ID,
      iteration: COUNT,
      path: ARGUMENT_NAME,
    },
    words: [{ paths: ['value'], from: ['args'], namedBy: 'path' }],
  },
};

/** Frozen to the last list: what the served path reads cannot be edited at run time. */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value as object)) deepFreeze(child);
  Object.freeze(value);
}
deepFreeze(EVENT_CONTENT);
