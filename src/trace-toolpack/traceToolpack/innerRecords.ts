import type { TraceToolpackArtifacts } from '../types.js';
import { openSubflow } from '../subflowRecords.js';
import { RAW_CONTROL_DEPS } from './artifactFacts.js';
import type { ToolCallReader } from './toolCallJournal.js';
import { INNER_RUN_SUGGESTION_CAP } from './structuralLimits.js';

/** The mount's record as an artifact bag, or why there is none. */
function openSubflowArtifacts(
  artifacts: TraceToolpackArtifacts,
  mount: string,
): TraceToolpackArtifacts | string {
  const opened = openSubflow(artifacts.snapshot, mount);
  if (typeof opened === 'string') return `inspect_subflow: ${opened}`;
  // Step ids are unique across a run, so the RUN's lookup answers inner ids —
  // but a decider OUTSIDE this log is not an inner step: keep only edges from
  // a decider in the mount's own log, so no outer id is served as an inner one.
  // Always filter the run's RAW lookup, never this level's filtered one: a
  // nested mount's deciders are not in its parent's log, so filtering the
  // parent's view would drop every edge one level further down.
  const raw = RAW_CONTROL_DEPS.get(artifacts) ?? artifacts.controlDeps;
  const innerIds = new Set(opened.commitLog.map((bundle) => bundle.runtimeStageId));
  const bag: TraceToolpackArtifacts = {
    snapshot: opened,
    ...(raw !== undefined && {
      controlDeps: (id: string) => {
        const dep = raw(id);
        return dep !== undefined && innerIds.has(dep.deciderId) ? dep : undefined;
      },
    }),
  };
  if (raw !== undefined) RAW_CONTROL_DEPS.set(bag, raw);
  return bag;
}

/** The question's params that were actually given (strict schemas refuse `undefined`). */
function definedOf(question: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(question).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** No tool in this run keeps a record — name the switch, not the emptiness. */
function noInnerRecordsMessage(toolCallId: string): string {
  return (
    `inspect_tool_run: nothing in this run kept a record below the tool boundary, so there is ` +
    `no inner run for '${toolCallId}' — or for any other call. A tool keeps one only when it ` +
    `was built to: flowchartAsTool({ name, flowchart, keepRecord: true }). That switch is OFF ` +
    `by default because retaining a run's snapshot per invocation is memory the caller has to ` +
    `agree to. Without it the trace holds the envelope — arguments in, result out — which is ` +
    `what inspect_tool_call('${toolCallId}') serves.`
  );
}

/** A record was expected and is not here: evicted, or never kept for THIS tool. */
function unknownInnerRunMessage(
  toolCallId: string,
  lookup: NonNullable<TraceToolpackArtifacts['innerRuns']>,
  reader: ToolCallReader,
): string {
  const kept = lookup.list();
  const lines: string[] = [
    `inspect_tool_run: no retained inner run for tool call '${toolCallId}'.`,
  ];

  // Did the OUTER run make this call at all? Three different situations
  // wear the same "not found", and only one of them is the consumer's to fix.
  const outer = reader.knownCalls().find((call) => call.id === toolCallId);
  if (outer === undefined) {
    lines.push(
      `⚠ the outer run does not record a call with that id either — check ` +
        `inspect_tool_call('${toolCallId}') first; it names every id the outer run recorded.`,
    );
  } else {
    lines.push(
      `That call ran '${outer.name}', which either does not keep records (only ` +
        `flowchartAsTool({ keepRecord: true }) does) or had this one dropped.`,
    );
  }

  if (kept.length === 0) {
    // Past tense, anchored to the lookup that was answered (9.86.0). "Right
    // now" pointed at the moment of READING, and this string is a tool result
    // the model re-reads on every later call of the debugging turn.
    lines.push(
      `No inner run was held when inspect_tool_run('${toolCallId}') was answered. A tool that ` +
        `keeps records had not been called in the turn this trace covers.`,
    );
  } else {
    const sample = kept
      .slice(0, INNER_RUN_SUGGESTION_CAP)
      .map((row) => `${row.toolCallId} (${row.toolName}, ${row.steps} step(s), ${row.outcome})`)
      .join(', ');
    lines.push(
      `Inner runs you CAN open (${kept.length}): ${sample}` +
        (kept.length > INNER_RUN_SUGGESTION_CAP ? ', …' : '') +
        '.',
    );
  }
  if (lookup.dropped > 0) {
    lines.push(
      // Named by id, not "this call" (9.86.1): the same repair the
      // schema-validation line above got in 9.86.0, on the arm the checker
      // could not see because its rule only knew `on this call`.
      `⚠ ${lookup.dropped} older record(s) were dropped to stay under the retention cap of ` +
        `${lookup.limit} — call '${toolCallId}' may be one of them. Raise it with ` +
        `keepRecordLimit, or ask sooner after the call.`,
    );
  }
  return lines.join('\n');
}

export { openSubflowArtifacts, definedOf, noInnerRecordsMessage, unknownInnerRunMessage };
