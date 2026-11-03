import { isDevMode } from 'footprintjs';

/** Tools already told that their declared period has no judge — once per tool per process. */
const periodUnjudgedWarned = new Set<string>();

/**
 * A result declared a `period` on an agent whose results layer is NOT mounted
 * (honesty step 7b): the period is recorded — it is the tool's declaration —
 * but no verdict is filed, so the answer's standing cannot read it. Configured
 * and inert must never look like configured and working, so dev mode says so,
 * once per tool per process, naming the two arms.
 */
export function warnPeriodUnjudged(toolName: string): void {
  if (periodUnjudgedWarned.has(toolName) || !isDevMode()) return;
  if (periodUnjudgedWarned.size < 500) periodUnjudgedWarned.add(toolName);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint results: tool '${toolName}' declared the period its read covered, and this ` +
      `agent does not mount the results layer, so no period verdict is filed and the answer's ` +
      `standing cannot read it (the period itself is recorded). Arm it with .resultsLayer() on ` +
      `the builder, or declare a ToolPeriod on the tool. This warning fires once per tool per ` +
      `process.`,
  );
}

/** Tools already told that their `ToolPeriod` has no judge — once per tool per process. */
const toolPeriodUnjudgedWarned = new Set<string>();

/**
 * A tool that declares a `ToolPeriod` was dispatched on an agent whose results
 * layer is NOT mounted (honesty step 7b). Only a ToolProvider-served tool gets
 * here — a registered one arms the layer at build — and its calls run, but no
 * period verdict is filed for them, not even `undeclared`. The twin of
 * {@link warnPeriodUnjudged} for the tool's declaration: dev mode says so,
 * once per tool per process, naming the arm.
 */
export function warnToolPeriodUnjudged(toolName: string): void {
  if (toolPeriodUnjudgedWarned.has(toolName) || !isDevMode()) return;
  if (toolPeriodUnjudgedWarned.size < 500) toolPeriodUnjudgedWarned.add(toolName);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint results: tool '${toolName}' declares which argument sets its period (a ` +
      `ToolPeriod), and this agent does not mount the results layer, so no period verdict — not ` +
      `even 'undeclared' — is filed for its calls and the answer's standing cannot read them. A ` +
      `ToolProvider served the tool, so the build could not see it: arm the layer with ` +
      `.resultsLayer() on the builder. This warning fires once per tool per process.`,
  );
}

/**
 * Forget every "no judge for this period" warning issued so far — for a
 * declared period and for a declared `ToolPeriod`.
 * @internal test seam — the ledger is process-wide and warn-once.
 */
export function _resetPeriodUnjudgedWarnings(): void {
  periodUnjudgedWarned.clear();
  toolPeriodUnjudgedWarned.clear();
}
