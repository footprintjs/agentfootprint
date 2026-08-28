/**
 * runbook/dispatch — the bridge's wrapper over `ctx.tools`.
 *
 * Pattern: decorator over {@link ToolDispatch}. The RAW dispatch (delivered
 *          by the agent) returns every result untouched; POLICY about what a
 *          result means belongs to the consumer — and this is the runbook's
 *          policy: every inner outcome is RECORDED (for the coverage fold and
 *          the provenance carry), and an inner ABSENCE short-circuits the
 *          procedure unless the call site declared it survivable.
 * Role:    core/runbook, pure.
 * Emits:   N/A.
 *
 * WHY an absence short-circuits: "the inventory found nothing" IS the
 * runbook's answer, and it must go back EXACTLY as it arrived so the
 * framework still reads it as an absence — a verdict reached over a source
 * that answered "nothing here" would be the confident-partial-answer failure
 * this whole envelope exists to prevent. A stage that can genuinely carry on
 * without the source says so at the call site (`{ allowAbsent: true }`) and
 * owns stating the gap (usually as a coverage entry).
 */

import { readAbsence } from '../agent/coverage/absent.js';
import type { ToolAbsence } from '../agent/coverage/types.js';
import type { ToolDispatch, ToolDispatchCallOptions } from '../tools.js';

/** One inner call, as the bridge recorded it. */
export interface InnerCallRecord {
  readonly tool: string;
  readonly outcome: 'ok' | 'absent' | 'error';
  /** The raw returned value (`'ok'` and `'absent'` outcomes). */
  readonly result?: unknown;
}

/** The marker property that survives any error wrapping between a stage and
 *  the bridge's catch. */
const ABSENCE_SIGNAL = 'af_runbook_absence' as const;

/**
 * The control signal an un-survivable inner absence throws through the
 * chart. The engine commits staged state and rethrows (commit-on-error is
 * the law upstream), so the bridge catches this at `executor.run` and
 * returns the absence verbatim.
 */
export class RunbookAbsenceSignal extends Error {
  readonly [ABSENCE_SIGNAL] = true;
  constructor(readonly absence: ToolAbsence, innerTool: string) {
    super(
      `runbook inner tool '${innerTool}' answered with an absence — the runbook's answer ` +
        `IS that absence, passed through verbatim. (Declare the call survivable with ` +
        `{ allowAbsent: true } if the procedure can carry on without this source.)`,
    );
    this.name = 'RunbookAbsenceSignal';
  }
}

/** Recognize the signal on an error OR anywhere down its `cause` chain — an
 *  engine layer that wraps the stage's throw must not defeat the pass-through. */
export function absenceSignalOf(err: unknown): RunbookAbsenceSignal | undefined {
  let current: unknown = err;
  for (let hops = 0; hops < 8 && current !== null && typeof current === 'object'; hops += 1) {
    if ((current as Record<string, unknown>)[ABSENCE_SIGNAL] === true) {
      return current as RunbookAbsenceSignal;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** What `recordingDispatch` hands back: the dispatch the procedure closes
 *  over, and the record the envelope folds. */
export interface RecordedDispatch {
  readonly tools: ToolDispatch;
  readonly records: readonly InnerCallRecord[];
}

/**
 * Wrap the delivered dispatch (or its absence) for one runbook invocation.
 *
 * With NO dispatch delivered (`ctx.tools` absent — a hand-built context, a
 * door with no dispatch map) the wrapper is the fail-closed teacher: `has`
 * answers false and `call` refuses naming the fix, so a procedure that needs
 * inner tools fails loudly at its first call instead of half-running.
 */
export function recordingDispatch(
  delivered: ToolDispatch | undefined,
  runbookName: string,
): RecordedDispatch {
  const records: InnerCallRecord[] = [];
  const tools: ToolDispatch = {
    has(name: string): boolean {
      return delivered?.has(name) ?? false;
    },
    async call(name: string, args: unknown, opts?: ToolDispatchCallOptions): Promise<unknown> {
      if (delivered === undefined) {
        throw new Error(
          `runbookAsTool('${runbookName}'): the procedure called tools.call('${name}') but ` +
            `no dispatch was delivered on ctx.tools. Register this runbook on an Agent ` +
            `(agent dispatch delivers ctx.tools at execute time), or supply a ToolDispatch ` +
            `on the execution context when invoking the tool directly.`,
        );
      }
      let raw: unknown;
      try {
        raw = await delivered.call(name, args, opts);
      } catch (err) {
        records.push({ tool: name, outcome: 'error' });
        throw err;
      }
      const absence = readAbsence(raw);
      if (absence !== undefined) {
        records.push({ tool: name, outcome: 'absent', result: raw });
        if (opts?.allowAbsent === true) return raw;
        throw new RunbookAbsenceSignal(absence, name);
      }
      records.push({ tool: name, outcome: 'ok', result: raw });
      return raw;
    },
  };
  return { tools, records };
}

/**
 * The definition-time probe dispatch — handed to the procedure factory ONCE
 * at `runbookAsTool(...)` so the bridge can read the chart's declared
 * contract. Stage bodies do not run at build; a factory that calls tools at
 * build time hears exactly why that cannot work.
 */
export function probeDispatch(runbookName: string): ToolDispatch {
  return {
    has: () => false,
    call: (name: string) => {
      throw new Error(
        `runbookAsTool('${runbookName}'): tools.call('${name}') was invoked while BUILDING ` +
          `the chart. The dispatch only exists at execute time — call tools from inside ` +
          `stage functions (which close over it), never from the factory body.`,
      );
    },
  };
}
