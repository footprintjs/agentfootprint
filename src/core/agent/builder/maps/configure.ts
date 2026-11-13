import type { EngagementPlan, MapsOptions } from '../../../../maps/engagement/types.js';
import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import type { CursorMove } from '../../../../injection-engine/skillGraph.js';

export interface MapsPort {
  mapsOptions?: MapsOptions;
}

export interface MapsPlanPort extends MapsPort {
  skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  skillGraphNodeIds?: ReadonlySet<string>;
  skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove;
}

export function configureMaps<TReceiver extends MapsPort>(
  self: TReceiver,
  options: MapsOptions,
  original: object,
): object {
  if (self.mapsOptions !== undefined) {
    throw new Error(
      `Agent.maps(): the kernel is already configured. One kernel per agent — a second ` +
        `call would silently replace the first's policy. Merge the options into one call.`,
    );
  }
  if (options.renewalGrace !== undefined) {
    if (!Number.isInteger(options.renewalGrace) || options.renewalGrace < 1) {
      throw new Error(
        `Agent.maps(): renewalGrace must be an integer >= 1, got ` +
          `${String(options.renewalGrace)}. It is the number of corroboration-free ` +
          `passes a guessed engagement survives before parking.`,
      );
    }
  }
  self.mapsOptions = options;
  return original;
}

export function resolveMapsPlan(
  self: MapsPlanPort,
  injections: readonly Injection[],
): EngagementPlan | undefined {
  if (self.mapsOptions === undefined) return undefined;
  if (self.skillGraphNextSkill === undefined) {
    throw new Error(
      `Agent.maps(): nothing is mounted that the kernel could manage — mount a skill ` +
        `map first (.skillGraph(defineSkillMap(...).build())). The kernel owns ` +
        `ENGAGEMENT (whether a map's prompt and tools ride the next call); with no ` +
        `map mounted there is nothing to engage or park.`,
    );
  }
  if (self.skillGraphNodeIds === undefined || self.skillGraphNodeIds.size === 0) {
    throw new Error(
      `Agent.maps(): the mounted graph carries no node ids (a structurally-typed ` +
        `graph). The kernel needs the member list to know exactly which contributions ` +
        `parking suppresses — mount the full defineSkillMap(...).build() result.`,
    );
  }
  // ── A graph that cannot explain its moves (9.59.0) ─────────────────
  // The kernel judges an engagement by WHY the cursor is where it is. With
  // no `explainNextSkill` no clause ever arrives, so every pass founds
  // `assumed` — nobody said why — and the kernel is reduced to a timer over
  // a fact it never learns. Before the `assumed` rung existed this was
  // worse and silent: an absent clause was written down as `structural`,
  // the strongest NON-DECAYING category, so such a graph could never park
  // anything at all, with no event and no warning.
  //
  // Refused rather than warned. Mounting a kernel whose whole job is to
  // weigh evidence, onto a map that produces none, is decoration — and the
  // refusal is reachable only for a hand-written structurally-typed graph
  // (every `skillGraph().build()` supplies the hook), so nothing that works
  // today starts failing.
  if (self.skillGraphExplainNextSkill === undefined) {
    throw new Error(
      `Agent.maps(): the mounted graph cannot explain its cursor moves — it carries no ` +
        `\`explainNextSkill\`. The kernel decides engagement by WHY the cursor is where ` +
        `it is (a declared route is system evidence; a keyword match is a guess), so ` +
        `without that clause every pass reads "nobody said why" and the kernel is a ` +
        `timer over a fact it never learns. Build the map with this version's ` +
        `skillGraph() (every graph it builds supplies the clause), or drop .maps().`,
    );
  }
  const memberIds = [...self.skillGraphNodeIds];
  const memberSet = new Set(memberIds);
  // The renewal feed's join key: tool NAMES contributed by this map's
  // members. Names, not references — the feed joins against the previous
  // batch's tool results, which carry names.
  const toolNames = [
    ...new Set(
      injections
        .filter((inj) => memberSet.has(inj.id))
        .flatMap((inj) => (inj.inject.tools ?? []).map((t) => t.schema.name)),
    ),
  ];
  return {
    maps: [
      {
        id: 'skill-map',
        memberIds,
        toolNames,
        // MANDATORY mount (9.59.0) — documented as shipped since the kernel
        // landed and, until now, unreachable through the mount path: the
        // kernel's data model carried `nonParkable` per map and no builder
        // option ever set it. Value-conditional, so an agent that does not
        // ask for it hands the kernel the exact object it always did.
        ...(self.mapsOptions.nonParkable === true && { nonParkable: true }),
      },
    ],
    renewalGrace: self.mapsOptions.renewalGrace ?? 3,
  };
}
