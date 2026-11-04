import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolProvider } from '../../../../../tools/toolProvider.js';
import type { ProviderToolCache, ServedToolParties } from '../../../../slots/buildToolsSlot.js';
import type { ToolClaim } from '../../../buildToolRegistry.js';

/** The catalog dependencies of the existing tool-call stage. */
export interface ToolCatalogPort {
  /** Current executable catalog for both pausable resume and interrupt replay. */
  readonly prepareProviderTools?: (scope: TypedScope<AgentState>) => Promise<void> | undefined;
  /** Map from tool name → Tool instance, built from the augmented
   *  registry (static .tool() entries + read_skill if any skills +
   *  shared skill tools). The dispatch primary lookup. */
  readonly registryByName: ReadonlyMap<string, Tool>;
  /** Optional external `.toolProvider()` for per-iteration dynamic
   *  tools (skill-scoped, multi-tenant, etc.). Consulted only when
   *  the static registry doesn't have the tool. */
  readonly externalToolProvider?: ToolProvider;
  /**
   * Cache populated by `buildToolsSlot` after each `provider.list(ctx)`
   * call this iteration. Read here to avoid a second `list()` call
   * (vital for async / network-backed providers). Same closure shared
   * within one chart build.
   */
  readonly providerToolCache?: ProviderToolCache;
  /**
   * Who put each name on this epoch's wire (9.92.0) — the tools slot's own
   * record of its merge, shared by reference like `providerToolCache`. The
   * first thing `lookupTool` consults, so the party whose contract the model
   * read is the party that answers. Absent (a chart without the slot's
   * record) → resolution order 1 alone, exactly as before 9.92.0.
   */
  readonly servedTools?: ServedToolParties;
  /**
   * Every build-time claimant per tool name (9.92.0) — `buildToolRegistry`'s
   * `toolClaimants`. Read for one thing: which party a registry-routed tool
   * belongs to, so an off-wire dispatch can be REPORTED with its answering
   * party (`tools.answered_off_wire`). Absent → `'registry'`.
   */
  readonly toolClaimants?: ReadonlyMap<string, readonly ToolClaim[]>;
  /**
   * WHICH SKILLS DECLARE EACH TOOL NAME (9.86.0) — tool name → the ids of the
   * skills whose `inject.tools` carry it, from `buildToolRegistry`, the one
   * place that already walks every skill's tool array.
   *
   * Read by `dispatchRoster` and by nothing else: a role that may not see a
   * skill may not be told the names of the tools that skill brought. A name is
   * unnameable only when EVERY declaring skill is hidden, so a tool two skills
   * share survives one of them being hidden.
   *
   * Absent for an agent with no skill-carried tools — the map is built only
   * when at least one skill declares one — and then the roster is the raw
   * dispatch set, exactly as it was.
   */
  readonly toolDeclaringSkills?: ReadonlyMap<string, readonly string[]>;
}
