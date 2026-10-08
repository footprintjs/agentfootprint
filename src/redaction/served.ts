/**
 * served — what an event of a run is SERVED as: its payload and the identity
 * on its meta, through the run's redaction rule.
 *
 * Pattern: one projection, decided once per event, by footprintjs's rule.
 * Role:    the Lens half of `src/redaction/`. It decides nothing about what is
 *          secret — `RedactionRule` (footprintjs/advanced) does, the ONE owner
 *          of every verdict. This file only says which of the rule's own
 *          decisions applies to a typed event:
 *
 *   - THE EVENT'S NAME — `retainEmit`: an event whose name `emitPatterns`
 *     selects is served with the placeholder for a payload, exactly as
 *     footprintjs serves a `$emit` payload it selects by name.
 *   - THE PAYLOAD — `retainBoundary`: a typed event's payload is a record
 *     handed out whole, the class footprintjs serves a pause payload, a run's
 *     input and output, a subflow's seed and a thrown value as — a selected
 *     key at ANY depth, and a declared field under a key of its name.
 *   - THE META'S IDENTITY — `principal` and `tenant` are who asked: values the
 *     caller passed, selected by their names like any other. Every other meta
 *     field (run, stage, session, trace, correlation ids; timestamps) is the
 *     record's ADDRESS — how an event joins its run — and is never selected:
 *     masking an address would detach the record from itself, not protect it.
 *
 * A payload whose scrub cannot run (an uncloneable value under a selected
 * field) is served as the placeholder whole, never raw — footprintjs's own
 * rule for a pause payload it cannot scrub.
 *
 * One more decision, the rule's own TAINT law applied to the library's own
 * copies: a field the library DERIVES from another value and carries under a
 * name of its own (`DERIVED` — a parser's message quotes the model's draft)
 * is served as the placeholder whenever the rule keeps the value it was
 * derived from out. footprintjs marks a subflow mapper's computed copy of a
 * selected value the same way; the verdict is still the rule's, by name.
 */

import type { RedactionRule } from 'footprintjs/advanced';

import type { EventMeta } from '../events/types.js';

/** The placeholder footprintjs serves a record handed out whole with. */
export const SERVED_PLACEHOLDER = '[REDACTED]';

/** What one run's events are served as. */
export interface EventServing {
  /** True when the run's rule can select anything — the no-policy fast path is `false`. */
  active(): boolean;
  /** The payload as served: the placeholder, a scrubbed copy, or the payload itself. */
  payload(type: string, payload: unknown): unknown;
  /** The meta as served: the same object unless its identity was selected. */
  meta<M extends EventMeta>(meta: M): M;
}

/**
 * Serving through `ruleOf()` — read on every event, because the rule a run
 * decides with is the executor's own and footprintjs builds a fresh one per
 * leg (a resume continues the paused run's marks on a new rule).
 *
 * @param ruleOf      the rule in force for the current event
 * @param hasEmitNames whether the policy selects any event by NAME
 *                    (`emitPatterns`) — a policy with only those keeps the
 *                    state rule inert, and inertness alone would skip them
 */
export function eventServing(ruleOf: () => RedactionRule, hasEmitNames: boolean): EventServing {
  const active = (): boolean => hasEmitNames || !ruleOf().isInert();
  return {
    active,
    payload(type, payload) {
      if (!active()) return payload;
      return servedPayload(ruleOf(), type, payload);
    },
    meta(meta) {
      if (meta.principal === undefined && meta.tenant === undefined) return meta;
      if (!active()) return meta;
      return servedMeta(ruleOf(), meta);
    },
  };
}

/** One kind of content an event carries under a name of its own. */
interface Derived {
  /** Where it sits in the payload: dotted, `name[]` for each element of a list. */
  readonly paths: readonly string[];
  /** The names it is derived from: kept out whenever the rule keeps out any of them. */
  readonly from: readonly string[];
  /**
   * A field beside the value that NAMES what it quotes (a validation issue's
   * argument `path`): the value is kept out too when the rule keeps out any
   * name on it — the by-name verdict of the value it was copied from.
   */
  readonly namedBy?: string;
  /**
   * A path, from the payload's root, to the object the value was RENDERED from
   * (a check-in's `willDo` writes the call's arguments as `k=v` text): the
   * value is kept out too when the rule keeps out any key of that object, at
   * any depth — the by-name verdict of every value the text can quote.
   */
  readonly namesAt?: string;
}

/** The words a person or the model wrote, wherever the library quotes them. */
const CONVERSATION_TEXT = ['userMessage', 'message', 'history'] as const;
const MODEL_TEXT = ['llmLatestContent', 'finalContent', 'content'] as const;

/** A check-in's evidence pack (`core/checkin.ts` · `CheckInRequest`) at `at` in a payload. */
function checkInPack(at: string): readonly Derived[] {
  return [
    { paths: [`${at}.intent`], from: MODEL_TEXT },
    // `willDo` renders the call's arguments as text: kept out with `args`, or
    // with any argument name the rule keeps out.
    { paths: [`${at}.evidence.willDo`], from: ['args'], namesAt: `${at}.args` },
    {
      paths: [`${at}.evidence.read[].summary`, `${at}.evidence.drivers[].text`],
      from: [...CONVERSATION_TEXT, 'result'],
    },
  ];
}

/**
 * The content the library DERIVES from a conversation value and carries under
 * a name of its own, per event type — each kept out whenever the rule keeps out
 * a value it came from. Generic names (`value`, `note`, `text`, `payload`) are
 * never put on a policy: selected by name they would hide structure across
 * every event. Pinned per feature by
 * `test/redaction/agent-redaction.vocabulary.test.ts`.
 */
const DERIVED: Readonly<Record<string, readonly Derived[]>> = {
  // A parser's or a fallback's message quotes the draft it could not read.
  'agentfootprint.agent.output_schema_validation_failed': [
    { paths: ['message'], from: ['rawOutput'] },
  ],
  'agentfootprint.agent.output_schema_retry': [{ paths: ['error'], from: ['rawOutput'] }],
  'agentfootprint.agent.output_contract_unmet': [{ paths: ['error'], from: ['rawOutput'] }],
  'agentfootprint.reliability.fail_fast': [{ paths: ['errorMessage'], from: ['rawOutput'] }],
  'agentfootprint.resilience.output_fallback_triggered': [
    { paths: ['primaryErrorMessage'], from: ['rawOutput'] },
  ],
  'agentfootprint.resilience.output_canned_used': [
    { paths: ['fallbackErrorMessage'], from: ['rawOutput'] },
  ],
  // A string argument a validation issue quotes.
  'agentfootprint.validation.args_invalid': [
    { paths: ['issues[].value'], from: ['args'], namedBy: 'path' },
  ],
  // An argument value an external ground stood in for, and a value an `assume` rule filled.
  'agentfootprint.integrity.external_ground_used': [
    { paths: ['value'], from: ['args'], namedBy: 'path' },
  ],
  'agentfootprint.agent.turn_end': [
    { paths: ['answerCoverage.assumed[].value'], from: ['args'], namedBy: 'argument' },
  ],
  // Figures the answer computed, quoted with the operands they came from.
  'agentfootprint.agent.evidence_checked': [
    { paths: ['computed[].value', 'computed[].from'], from: [...MODEL_TEXT, 'result'] },
  ],
  // A check-in's evidence pack: the model's words, the rendered arguments, the
  // context it quotes — and the person's note on the decision. The pack rides
  // the check-in event AND the pause it asks with (`pause.request`'s question).
  'agentfootprint.checkin.request': checkInPack('request'),
  'agentfootprint.pause.request': checkInPack('questionPayload.checkIn'),
  'agentfootprint.checkin.decision': [{ paths: ['note'], from: ['resumeInput'] }],
  // Words a matcher found in the conversation; a tool result a route guard judged.
  'agentfootprint.context.evaluated': [
    { paths: ['cursorMove.witness.text'], from: CONVERSATION_TEXT },
    {
      paths: [
        'cursorMove.guard.conditions[].actualSummary',
        'cursorMove.guardsClosed[].conditions[].actualSummary',
      ],
      from: ['result'],
    },
  ],
  'agentfootprint.skill.turn_routed': [{ paths: ['witness.text'], from: CONVERSATION_TEXT }],
  'agentfootprint.map.engaged': [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  'agentfootprint.map.parked': [{ paths: ['witness'], from: CONVERSATION_TEXT }],
  // A tool's own progress report; a retrieved passage's heading.
  'agentfootprint.stream.tool_progress': [{ paths: ['payload'], from: ['result'] }],
  'agentfootprint.memory.retrieved': [{ paths: ['candidates[].heading'], from: ['retrieved'] }],
};

/**
 * The DERIVED table as rows — for the test that pins it against the event
 * registry and the conversation vocabulary (every row's event type exists, and
 * the vocabulary keeps out a name each row is derived from).
 *
 * @internal
 */
export function derivedRows(): readonly {
  readonly type: string;
  readonly paths: readonly string[];
  readonly from: readonly string[];
  readonly namedBy?: string;
}[] {
  return Object.entries(DERIVED).flatMap(([type, entries]) =>
    entries.map((entry) => ({ type, ...entry })),
  );
}

/** The served form of one payload — see the file header for the decisions. */
function servedPayload(rule: RedactionRule, type: string, payload: unknown): unknown {
  try {
    const named = rule.retainEmit(type, payload);
    if (named !== payload) return named;
    return withDerivedKeptOut(rule, type, rule.retainBoundary(payload));
  } catch {
    return SERVED_PLACEHOLDER;
  }
}

/** `served` with the content derived from a kept-out value served as the placeholder. */
function withDerivedKeptOut(rule: RedactionRule, type: string, served: unknown): unknown {
  const entries = DERIVED[type];
  if (entries === undefined || !isPlainRecord(served)) return served;
  let out: unknown = served;
  for (const entry of entries) {
    const whole =
      entry.from.some((name) => rule.isKeyRedacted(name)) ||
      (entry.namesAt !== undefined &&
        keysAt(served, entry.namesAt).some((name) => rule.isKeyRedacted(name)));
    if (!whole && entry.namedBy === undefined) continue;
    const keptOut = (owner: Readonly<Record<string, unknown>>): boolean =>
      whole || (entry.namedBy !== undefined && namesKeptOut(rule, owner[entry.namedBy]));
    for (const path of entry.paths) out = maskAt(out, path.split('.'), keptOut);
  }
  return out;
}

/** How deep `keysAt` reads an object's keys — a call's arguments, never a deep tree. */
const MAX_NAME_DEPTH = 16;

/** Every key, at any depth, of the object at the dotted `path` in `node` (none when it is not one). */
function keysAt(node: unknown, path: string): string[] {
  let at: unknown = node;
  for (const segment of path.split('.')) {
    if (!isPlainRecord(at)) return [];
    at = at[segment];
  }
  const names: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_NAME_DEPTH || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      names.push(key);
      walk(child, depth + 1);
    }
  };
  walk(at, 0);
  return names;
}

/** Whether a field that names a value (`'customer.ssn'`, `'items[0].pin'`) names one the rule keeps out. */
function namesKeptOut(rule: RedactionRule, named: unknown): boolean {
  if (typeof named !== 'string') return false;
  return named
    .split(/[.[\]]/)
    .filter((name) => name.length > 0)
    .some((name) => rule.isKeyRedacted(name));
}

/**
 * `node` with the value at `segments` served as the placeholder when
 * `keptOut(owner)` says so — copied on write along the path, the SAME object
 * when nothing changed. `name[]` walks each element of a list.
 */
function maskAt(
  node: unknown,
  segments: readonly string[],
  keptOut: (owner: Readonly<Record<string, unknown>>) => boolean,
): unknown {
  if (!isPlainRecord(node) || segments.length === 0) return node;
  const [head, ...rest] = segments as [string, ...string[]];
  const list = head.endsWith('[]');
  const key = list ? head.slice(0, -2) : head;
  const child = node[key];
  if (child === undefined) return node;
  let next: unknown = child;
  if (list) {
    if (!Array.isArray(child) || rest.length === 0) return node;
    const items = child.map((item) => maskAt(item, rest, keptOut));
    if (items.some((item, i) => item !== child[i])) next = items;
  } else if (rest.length === 0) {
    if (keptOut(node) && child !== SERVED_PLACEHOLDER) next = SERVED_PLACEHOLDER;
  } else {
    next = maskAt(child, rest, keptOut);
  }
  return next === child ? node : { ...node, [key]: next };
}

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The meta with its identity served by name; the address untouched. */
function servedMeta<M extends EventMeta>(rule: RedactionRule, meta: M): M {
  const identity: { principal?: string; tenant?: string } = {
    ...(meta.principal !== undefined && { principal: meta.principal }),
    ...(meta.tenant !== undefined && { tenant: meta.tenant }),
  };
  let kept: { principal?: unknown; tenant?: unknown };
  try {
    kept = rule.retainBoundary(identity);
  } catch {
    kept = Object.fromEntries(Object.keys(identity).map((key) => [key, SERVED_PLACEHOLDER]));
  }
  if (kept === identity) return meta;
  return { ...meta, ...kept } as M;
}
