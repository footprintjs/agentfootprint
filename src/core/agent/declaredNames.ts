/**
 * declaredNames — the names an agent DECLARED when it was built, for the
 * redaction's `declaredName` kind (`redaction/names.ts`,
 * `events/content.ts`).
 *
 * Pattern: a pure projection of the agent's own configuration — the same
 *          sources its run manifest reads (`buildRunManifest`), its tool
 *          registry and skills, its middleware — into the four name spaces.
 * Role:    what `Agent · redactionNames` hands every run of the agent. A name
 *          an event carries in a structure field is served as structure only
 *          when it is one of these (or one the run registered as it composed:
 *          a provider's tools, `slots/buildToolsSlot.ts`); a name the agent
 *          cannot vouch for — a tool the model made up, an argument key it
 *          invented — is content.
 *
 * Names only. Nothing a run wrote reaches this list.
 */

import type { NameDeclarations } from '../../redaction/names.js';
import { schemaPropertyNames, unionNames } from '../../redaction/names.js';

/** Anything shaped like a tool: a schema with a name and an input schema. */
export interface NamedTool {
  readonly schema?: { readonly name?: unknown; readonly inputSchema?: unknown };
}

/** What the agent hands over: its configuration, as the manifest and the registries hold it. */
export interface AgentNameSources {
  readonly id: string;
  readonly name: string;
  /** The run manifest's payload (`buildRunManifest`) — every name it states is declared. */
  readonly manifest: unknown;
  readonly tools: readonly (NamedTool | undefined)[];
  /** Every injection: its id is configuration; a skill's is a skill id, its tools are tools. */
  readonly injections: readonly {
    readonly id: string;
    readonly flavor?: unknown;
    readonly inject?: { readonly tools?: readonly (NamedTool | undefined)[] };
  }[];
  readonly skillIds: Iterable<string>;
  /** Provider names and model ids from every other place the agent was configured with one. */
  readonly configNames: Iterable<unknown>;
  /** Tool names declared elsewhere (a mounted map's members). */
  readonly toolNames?: Iterable<unknown>;
}

/** The names an agent declared, by space. */
export function agentDeclaredNames(sources: AgentNameSources): NameDeclarations {
  const skills = sources.injections.filter((i) => i.flavor === 'skill');
  return unionNames(
    toolDeclarations(sources.tools),
    ...skills.map((skill) => toolDeclarations(skill.inject?.tools ?? [])),
    {
      tool: strings(...(sources.toolNames ?? [])),
      skill: strings(...skills.map((s) => s.id), ...sources.skillIds),
      config: strings(
        sources.id,
        sources.name,
        ...sources.injections.map((i) => i.id),
        ...manifestNames(sources.manifest),
        ...sources.configNames,
      ),
    },
  );
}

/** Tool names and every argument name their input schemas declare. */
export function toolDeclarations(tools: readonly (NamedTool | undefined)[]): NameDeclarations {
  const tool: string[] = [];
  const argument: string[] = [];
  for (const candidate of tools) {
    const name = candidate?.schema?.name;
    if (typeof name !== 'string') continue;
    tool.push(name);
    argument.push(...schemaPropertyNames(candidate?.schema?.inputSchema));
  }
  return { tool, argument };
}

/** The names a run manifest states: the agent, its model, memories, window, scorer, recipes. */
function manifestNames(manifest: unknown): readonly unknown[] {
  if (manifest === null || typeof manifest !== 'object') return [];
  const m = manifest as {
    readonly agentId?: unknown;
    readonly llm?: { readonly provider?: unknown; readonly model?: unknown };
    readonly memories?: readonly {
      readonly id?: unknown;
      readonly retrieval?: unknown;
      readonly embedderId?: unknown;
    }[];
    readonly window?: unknown;
    readonly skillGraph?: { readonly scorer?: unknown };
    readonly recipes?: readonly { readonly id?: unknown; readonly version?: unknown }[];
  };
  return [
    m.agentId,
    m.llm?.provider,
    m.llm?.model,
    ...(m.memories ?? []).flatMap((memory) => [memory.id, memory.retrieval, memory.embedderId]),
    m.window,
    m.skillGraph?.scorer,
    ...(m.recipes ?? []).flatMap((recipe) => [recipe.id, recipe.version]),
  ];
}

/** The non-empty strings among `values`. */
function strings(...values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
