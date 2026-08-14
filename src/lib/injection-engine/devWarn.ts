/**
 * devWarn — the dev-warning SEAM for the pure skill-graph core (9.34.0).
 *
 * THE PROBLEM IT SOLVES. `skillGraph.ts` and `skillIntent.ts` print dev-mode
 * warnings (a throwing matcher, a check-up with problems, a leaf set that did
 * not fire exactly once). Those warnings were gated on `isDevMode()` imported
 * from `footprintjs` — a real dependency on the flowchart engine, inside the
 * two files whose whole point is that they do not depend on one. footprintjs's
 * dev flag is a module-private boolean toggled by `enableDevMode()`, so the
 * pure core cannot read it without importing the engine.
 *
 * THE SEAM. The pure core asks a READER it was handed. The default reader
 * says "not dev mode", so a pure-core-only host is silent until it opts in.
 * agentfootprint's own host binds the reader to footprintjs's `isDevMode`
 * (see `devWarnHost.ts`, side-effect-imported by the injection-engine
 * barrel), so every warning in this package behaves exactly as it did — same
 * text, same gate, same `enableDevMode()` switch.
 *
 * (Precedent: footprintjs's own `capture/envelope.ts` dev-warn seam — the
 * pure module stays pure, the tier that owns the flag binds the warner.)
 *
 * Zone: PURE CORE. Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

/** Answers "should dev-time warnings print?". */
export type DevModeReader = () => boolean;

const OFF: DevModeReader = () => false;

let readDevMode: DevModeReader = OFF;

/**
 * Bind the dev-mode reader the pure core consults.
 *
 * agentfootprint calls this for you — importing anything from
 * `agentfootprint/context` (or the main entry) binds it to footprintjs's
 * `isDevMode`, so `enableDevMode()` keeps switching skill-graph warnings on
 * exactly as before.
 *
 * A host running the graph through `agentfootprint/skill-graph` alone gets
 * NO warnings until it calls this — that door deliberately loads no engine,
 * and a warning gate is not worth an import of one.
 *
 * @example turn skill-graph dev warnings on in a foreign host
 *   import { useSkillGraphDevMode } from 'agentfootprint/skill-graph';
 *   useSkillGraphDevMode(() => process.env.NODE_ENV !== 'production');
 */
export function useSkillGraphDevMode(read: DevModeReader | undefined): void {
  readDevMode = read ?? OFF;
}

/** Is dev mode on, per the bound reader? The gate the hot paths check. */
export function devMode(): boolean {
  return readDevMode();
}

/** Print `message` to the console when dev mode is on. Never throws. */
export function devWarn(message: string): void {
  if (!readDevMode()) return;
  // eslint-disable-next-line no-console
  console.warn(message);
}
