/**
 * unsupported-argument — the model ACTED on a value nothing served, at the
 * CHOICE seam.
 *
 * Pattern: pure function over (the calls, the frame they were chosen from);
 *          the domain check.
 * Role:    the decidable fragment of "did the model bind this reference to
 *          something the run actually served?". The measured failure: on the
 *          second turn of a triage conversation the window had dropped the
 *          user message carrying the true entity id and kept the assistant's
 *          own rendered answer. Asked for the status of "that machine", the
 *          model resolved the reference out of its OWN prior prose, took a
 *          truncated job-name fragment for a machine name, called the lookup
 *          tool with it, got an honest "nothing found", and told the person
 *          their protected machine had no backup record. Every shipped rail
 *          passed honestly — the coverage envelope, the absence envelope and
 *          the evidence gate all held, because every value in the answer
 *          really WAS grounded. The defect was the REFERENT, bound wrong at
 *          the argument, and the argument was the one seam with no check.
 *
 * DECLARED, NEVER INFERRED — the `argumentsFrom` precedent, second use. A
 * tool is this check's subject only because its author said its arguments
 * come from another tool's results; a tool that declares nothing is never
 * examined, which is the whole zero-delta story. One declaration now arms two
 * seams: `dangling-reference` asks whether the ground is still in reach when
 * the tool is OFFERED, this asks whether the value the model chose came from
 * that ground when the tool is CALLED.
 *
 * ASSISTANT TEXT IS NOT GROUND, and that is the entire idea. The system
 * prompt, the user's messages and every tool result are things the RUN put in
 * front of the model. Its own earlier turns are things it wrote. A value whose
 * only source is the model's own rendered prose has been re-derived from a
 * rendering rather than read from evidence, and re-deriving is exactly how a
 * truncated job name becomes a machine name.
 *
 * THE FENCES, stated because they are the check's honesty:
 * - NON-STRINGS ARE NEVER CHECKED. Numbers, booleans and null are not
 *   identifier-shaped, and substring-grounding them would accuse every
 *   literal the model legitimately computed.
 * - VALUES UNDER FOUR CHARACTERS ARE NEVER CHECKED. Below that, substring
 *   matching is noise in both directions — 'up' and 'a1' land inside
 *   unrelated words in any corpus.
 * - SERVED ANYWHERE PASSES, case-insensitively. The value need only appear
 *   inside SOME served string; see the README's stated leniency.
 * - DECLARED VOCABULARY PASSES. A value the tool's own `inputSchema` lists in
 *   an `enum` was served BY THE SCHEMA — the model read it off the tool
 *   definition, not out of its own prose.
 * - EXTERNAL GROUNDS PASS, and file the source that excused them (9.72.0).
 *   An app may hand the corpus values the RUN never served but the APP
 *   verified itself — the driving case: a person clicked a row in a data
 *   panel, the app checked the clicked cells against the artifact the panel
 *   renders, and an identifier the model takes from that verified selection
 *   is not fabricated. HONESTY NOTE, because this is an assertion door: the
 *   library records what the app asserts — verifying the assertion (against
 *   the artifact, the click, whatever the app's ground truth is) is the
 *   app's duty, and the `source` label travels with every excusal so a
 *   reader can audit the chain instead of trusting it.
 * Two states remain, and they file DIFFERENT messages because they call for
 * different fixes: grounded only in the model's own prose (re-fetch the real
 * ground), and grounded nowhere in the window at all (nothing served it).
 *
 * Detection only. Nothing here blocks, rewrites or delays a call.
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import type { ContextError } from '../finding/types.js';

/** One tool call the model chose to make, with the arming that makes it checkable. */
export interface ArgumentChoice {
  readonly toolName: string;
  /** The provider's id for this call — what the witness points a reader at. */
  readonly toolCallId: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** `Tool.argumentsFrom` — the tools whose results were meant to ground these arguments. */
  readonly argumentsFrom: readonly string[];
  /**
   * Values the tool's own `inputSchema` declares in an `enum`. Best-effort and
   * FLAT (see {@link declaredEnumValuesOf}): a value declared for one field
   * excuses that value at any field of the same tool. Deliberately lenient on
   * an accusation boundary.
   */
  readonly declaredEnums?: ReadonlySet<string>;
}

/**
 * One value the APP verified against ground the run itself never observed
 * (9.72.0). `value` is the verified text; `source` is the app's short label
 * for where it came from (e.g. `'viewer-selection'`) — the audit handle that
 * travels onto the record whenever this entry excuses an argument.
 */
export interface ExternalGround {
  readonly value: string;
  readonly source: string;
}

/**
 * One argument value an external ground excused — the audit trail of an app
 * assertion. Filed alongside the findings so the record can say WHICH source
 * grounded a value, not merely that no finding was raised.
 */
export interface ExternalGrounding {
  readonly toolName: string;
  readonly toolCallId: string;
  /** Dot-path of the argument leaf the ground excused. */
  readonly path: string;
  readonly value: string;
  /** The app's label from the {@link ExternalGround} entry that matched. */
  readonly source: string;
}

/** The frame the model chose from, split by whether it can GROUND anything. */
export interface ChoiceCorpus {
  /** System prompt, user messages, tool results — everything the RUN served. */
  readonly grounded: readonly string[];
  /** The model's own earlier turns. Never ground: this is what the defect is made of. */
  readonly assistant: readonly string[];
  /**
   * App-asserted grounds the run did not serve (9.72.0). DECLARED, never
   * ambient — the caller composes this from a provider the app registered;
   * absent or empty, the check is byte-identical to what it always was. The
   * library records what the app asserts here; verifying the assertion is
   * the app's duty, and each entry's `source` label is kept on the excusal
   * record so the chain stays auditable.
   */
  readonly external?: readonly ExternalGround[];
}

/** What the choice-seam check found — the findings AND the excusals. */
export interface UnsupportedArguments {
  readonly findings: readonly ContextError[];
  /** Values an app-asserted external ground excused, with their sources. */
  readonly externalGroundings: readonly ExternalGrounding[];
}

/** Below this, substring matching says nothing. */
const MIN_CHECKED_LENGTH = 4;

/** Longest a single value is quoted at inside a message. */
const MAX_QUOTED_CHARS = 80;

/** Deepest a schema is walked for `enum` declarations. */
const MAX_SCHEMA_DEPTH = 8;

function clip(value: string): string {
  return value.length <= MAX_QUOTED_CHARS ? value : `${value.slice(0, MAX_QUOTED_CHARS - 1)}…`;
}

/** Every string leaf of an arguments object, with its dot-path. */
function* stringLeaves(node: unknown, path: string): Generator<{ path: string; value: string }> {
  if (typeof node === 'string') {
    yield { path, value: node };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      yield* stringLeaves(node[i], path === '' ? String(i) : `${path}.${String(i)}`);
    }
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      yield* stringLeaves(value, path === '' ? key : `${path}.${key}`);
    }
  }
}

/**
 * Best-effort: every string an `enum` array declares anywhere in a tool's
 * `inputSchema`. Flat by design — a per-path map would be more precise, and on
 * an accusation boundary the lenient direction is the safe one. An absent or
 * non-object schema yields an empty set, which simply means no enum fence.
 */
export function declaredEnumValuesOf(schema: unknown): ReadonlySet<string> {
  const values = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_SCHEMA_DEPTH || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.enum)) {
      for (const declared of obj.enum) if (typeof declared === 'string') values.add(declared);
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(schema, 0);
  return values;
}

/**
 * Check every armed call's identifier-like string arguments against the frame
 * the model chose from.
 *
 * @param calls the ARMED tool calls of one response — a caller filters by
 *   `argumentsFrom` before calling; nothing here re-decides who is a subject.
 * @param corpus the exact request this response was assembled from, split into
 *   what the run served and what the model itself wrote.
 * @param epoch the run iteration, stamped on every witness.
 */
export function unsupportedArgumentsOf(
  calls: readonly ArgumentChoice[],
  corpus: ChoiceCorpus,
  epoch: number,
): UnsupportedArguments {
  const findings: ContextError[] = [];
  const externalGroundings: ExternalGrounding[] = [];
  if (calls.length === 0) return { findings, externalGroundings };
  const served = corpus.grounded.map((text) => text.toLowerCase());
  const written = corpus.assistant.map((text) => text.toLowerCase());
  // The external entries, lowered once and kept only when both halves are
  // usable: a non-empty value (nothing could match a blank) and a non-empty
  // source (the audit handle this door exists to carry). Garbage never
  // throws — an unusable entry simply grounds nothing.
  const external = (Array.isArray(corpus.external) ? corpus.external : [])
    .filter(
      (e): e is ExternalGround =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as { value?: unknown }).value === 'string' &&
        (e as { value: string }).value.trim().length > 0 &&
        typeof (e as { source?: unknown }).source === 'string' &&
        (e as { source: string }).source.trim().length > 0,
    )
    .map((e) => ({ lowered: e.value.toLowerCase(), source: e.source }));
  const frame =
    `frame this call was assembled from: ${String(served.length)} served string(s) ` +
    `(system prompt, user messages, tool results) and ${String(written.length)} assistant turn(s)`;

  for (const call of calls) {
    const subject: SubjectRef = { kind: 'tool', id: call.toolName };
    const declared = new Set([...(call.declaredEnums ?? [])].map((v) => v.toLowerCase()));
    const grounds = call.argumentsFrom.join(' or ');
    const refetch =
      grounds.length > 0
        ? `call ${grounds} again and use a value it returns`
        : 're-read the value from the tool that serves it';

    for (const leaf of stringLeaves(call.args, '')) {
      const value = leaf.value.trim();
      if (value.length < MIN_CHECKED_LENGTH) continue;
      const needle = value.toLowerCase();
      if (declared.has(needle)) continue;
      if (served.some((text) => text.includes(needle))) continue;
      // The external-ground fence (9.72.0), consulted only after the run's own
      // corpus failed to ground the value — a value the run served needs no
      // excuse, so an excusal on the record always means "the app's assertion
      // is the ONLY thing standing between this value and a finding". Same
      // substring leniency as the served fence, same direction of safety.
      const excusedBy = external.find((e) => e.lowered.includes(needle));
      if (excusedBy !== undefined) {
        externalGroundings.push({
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          path: leaf.path,
          value: leaf.value,
          source: excusedBy.source,
        });
        continue;
      }
      const selfReferenced = written.some((text) => text.includes(needle));

      const witnesses: Assertion[] = [
        {
          subject,
          predicate: leaf.path,
          value: leaf.value,
          epoch,
          stratum: 'asserted',
          provenance: `tool call ${call.toolCallId}: argument '${leaf.path}' as the model chose it`,
        },
        {
          subject,
          predicate: leaf.path,
          value: selfReferenced
            ? 'served by nothing — present only in the model’s own earlier answer'
            : 'served by nothing in the window the model saw',
          epoch,
          stratum: 'asserted',
          provenance: frame,
        },
      ];

      findings.push({
        kind: 'unsupported-argument',
        seam: 'choice',
        subjects: [subject],
        // The dot-path IS the discriminator: two arguments of one call are two
        // defects, and without it the second collapses into the first (the
        // `unsupported-claim` per-field lesson, same substrate rule).
        predicate: leaf.path,
        witnesses,
        epoch,
        message: selfReferenced
          ? `'${call.toolName}' was called with ${leaf.path} = "${clip(value)}", and the only ` +
            `place that value appears in the frame the model chose from is the model’s own ` +
            `earlier answer. Rendered text is not evidence — a value re-read out of prose can ` +
            `be a fragment of something else entirely. To ground it, ${refetch}. Nothing here ` +
            `blocked the call.`
          : `'${call.toolName}' was called with ${leaf.path} = "${clip(value)}", and that value ` +
            `appears nowhere in the frame the model chose from — not in the instructions, not ` +
            `in any message from the user, not in any tool result. Nothing served it, so ` +
            `nothing in this run can say what it refers to. To ground it, ${refetch}. Nothing ` +
            `here blocked the call.`,
      });
    }
  }
  return { findings, externalGroundings };
}
