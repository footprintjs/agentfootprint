import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { declarePrivateFields } from '../../../../redaction/declared.js';
import { isDevMode } from 'footprintjs';
import type { Tool } from '../../../../tools/tools.js';
import { honestyLayersOf, type HonestyLayers } from '../../honesty/armed.js';
import { carriesArgumentView } from '../../../toolShownArgs.js';
import { buildToolRegistry } from '../../buildToolRegistry.js';
import type { AgentContext } from '../contracts.js';

import type { AgentConfiguration } from '../configuration/types.js';

export interface CatalogEnvironment {
  readonly registry: AgentConfiguration['registry'];
  readonly artifactStore: AgentConfiguration['artifactStore'];
  toolSchemasResolved: readonly LLMToolSchema[];
  seededRuledTools: ReadonlyMap<string, Tool> | undefined;
  seededHonestyLayers: HonestyLayers | undefined;
  ledgerRestoreArmed: boolean;
}

export function buildCatalog(
  this: Pick<
    AgentContext,
    'configuration' | 'inputsLayerArmed' | 'ontologyTools' | 'resultsLayerArmed' | 'runner'
  >,
  environment: CatalogEnvironment,
) {
  // Tool registry composition extracted to ./agent/buildToolRegistry.ts.
  // Composes static .tool() registry + auto-attached read_skill (+ the
  // auto-attached `present` tool when a store is attached, 9.22.0) +
  // skill-supplied tools (with autoActivate scoping); validates
  // name uniqueness; produces the dispatch map.
  const { registryByName, toolSchemas, toolDeclaringSkills, toolClaimants } = buildToolRegistry(
    environment.registry,
    this.configuration.injections,
    {
      hasArtifactStore: environment.artifactStore !== undefined,
      // The reserved-argument refusal (9.101.0) — only when the ledger is
      // armed may a registry tool's own `_findings` be refused.
      ...(this.configuration.findingsOptions !== undefined && { findings: true as const }),
      // …and, under declared sources (either door), a RULED tool's: the arm
      // plants `_findings.from` on it and its sentences name that argument.
      ...(this.configuration.argumentSourcesArmed === true && { argumentSources: true as const }),
    },
  );
  if ([...registryByName.values()].some(carriesArgumentView)) declarePrivateFields(this.runner);
  // The declared ontology's tool edges (9.106.0): every name a node's `via`
  // names must be a tool this registry can dispatch — the static registry,
  // the framework's doors and every skill's tools, `registryByName` being
  // the ONE map that holds all of them. Refused at BUILD, naming the
  // ontology and the tool: a map that points a need at a tool nobody can
  // call is a map that lies, and only the operator can fix it. Provider-
  // served tools are only met at dispatch and cannot be named here.
  if (this.configuration.ontology !== undefined) {
    // The join (9.108.0): the same walk, collecting which skills declare
    // each `via` name — `toolDeclaringSkills` is the registry's own fact,
    // in declaration order; a name no skill declares is not in it.
    const tools: Record<string, readonly string[]> = {};
    for (const [nodeId, node] of Object.entries(this.configuration.ontology.nodes)) {
      for (const held of node.sources ?? []) {
        for (const toolName of held.via ?? []) {
          if (!registryByName.has(toolName)) {
            throw new Error(
              `Agent: ontology '${this.configuration.ontology.id}' names tool '${toolName}' that is not ` +
                `registered (node '${nodeId}', source '${held.source}'). Register the tool ` +
                `with .tool() or on a skill, or drop it from the node's \`via\`.`,
            );
          }
          const owners = toolDeclaringSkills.get(toolName);
          if (owners !== undefined && owners.length > 0) tools[toolName] = [...owners];
        }
      }
    }
    this.ontologyTools = Object.keys(tools).length > 0 ? Object.freeze(tools) : undefined;
  }
  // A statically registered tool that declares `wants` on an agent with no
  // store is configuration that lies: every call would be refused at
  // dispatch for a gap only the operator can close. Refused at BUILD,
  // naming the tool (provider-served tools are only met at dispatch — the
  // dispatch-time refusal covers those).
  if (environment.artifactStore === undefined) {
    for (const [toolName, registered] of registryByName) {
      if (registered.wants !== undefined) {
        throw new Error(
          `Agent: tool '${toolName}' declares artifact arguments (wants: ` +
            `{ ${Object.entries(registered.wants)
              .map(([arg, kind]) => `${arg}: '${kind}'`)
              .join(', ')} }) but no artifact store is attached, so its refs could never ` +
            `resolve and every call would be refused. Pass \`artifacts\` to Agent.create ` +
            `(inMemoryArtifacts(), fileArtifacts({ directory }), sqliteArtifacts({ file }), ` +
            `or any ArtifactStore), or drop the tool's \`wants\`.`,
        );
      }
      // The same law for the typed-HITL half (9.24.0): a statically
      // registered `checkInComponent.propsRef` on a storeless agent is a
      // ref the screen could never redeem — every tripped gate would be
      // refused at raise for a gap only the operator can close.
      if (registered.checkInComponent?.propsRef !== undefined) {
        throw new Error(
          `Agent: tool '${toolName}' declares checkInComponent.propsRef ` +
            `('${registered.checkInComponent.propsRef}') but no artifact store is attached, ` +
            `so the answering screen could never redeem it and every tripped check-in would ` +
            `be refused at raise. Pass \`artifacts\` to Agent.create (inMemoryArtifacts(), ` +
            `fileArtifacts({ directory }), sqliteArtifacts({ file }), or any ArtifactStore), ` +
            `or carry the payload inline as checkInComponent.props.`,
        );
      }
    }
  }
  // The composedOf drift gate (9.76.0), judged HERE and not at defineTool —
  // the one moment the catalog is complete. A tool that declares its
  // ingredients (`composedOf`, the runbookAsTool law) whose ingredient was
  // renamed or never registered fails the BUILD by name, instead of failing
  // its first run inside a stage. Tools delivered by a ToolProvider are
  // invisible to this check (no build-time list — the 9.72.0 caveat), so
  // with a provider configured an unmatched name is a dev-mode heads-up
  // rather than a refusal: the ingredient may genuinely arrive at dispatch.
  for (const [composedName, registered] of registryByName) {
    for (const ingredient of registered.composedOf ?? []) {
      if (registryByName.has(ingredient)) continue;
      if (this.configuration.externalToolProvider !== undefined) {
        if (isDevMode()) {
          // eslint-disable-next-line no-console
          console.warn(
            `[agentfootprint] tool '${composedName}' declares composedOf ingredient ` +
              `'${ingredient}', which is not in the static catalog. A ToolProvider is ` +
              `configured, so it may arrive at dispatch — but provider-delivered tools ` +
              `cannot be drift-checked at build. If '${ingredient}' is static, this is ` +
              `the rename the check exists to catch.`,
          );
        }
        continue;
      }
      throw new Error(
        `Agent: tool '${composedName}' declares composedOf ingredient '${ingredient}', ` +
          `but no tool of that name is registered on this agent. The declaration names ` +
          `the tools its procedure calls through ctx.tools, and an ingredient that is ` +
          `not in the dispatch map fails at its first inner call — refused at build ` +
          `instead. Register '${ingredient}' (or fix the name in composedOf).`,
      );
    }
  }
  // Late-bind toolSchemas into the seed stage's deps (the factory was
  // built earlier with a getter; this resolves the actual value).
  environment.toolSchemasResolved = toolSchemas;

  // ── The inputs layer (honesty layer 2) — armed ONCE, here ──────────
  // A registered tool (static, skill-carried, or an MCP tool registered on
  // the builder) that declares argument rules (`askOrAssume`) or a period
  // (`period`, which `tools/declare.ts` · `rulesOf` also counts as a rule
  // declaration) arms the mount — so a tool whose only declaration is a
  // period arms it too, though `carriesRules` is false for it. The
  // `toolGrounding` harvest precedent, over the same catalog. Tools a
  // ToolProvider serves are invisible here, so `.inputsLayer()` arms the
  // mount for them; without it their calls are refused at dispatch (fail
  // closed). Unarmed: nothing below is mounted, decorated, read or written.
  const ruledTools = new Map(
    [...registryByName.entries()].filter(
      ([, tool]) => tool.askOrAssume !== undefined || tool.period !== undefined,
    ),
  );
  const inputsArmed = ruledTools.size > 0 || this.configuration.inputsLayerOption === true;
  this.inputsLayerArmed = inputsArmed;
  // DECLARED SOURCES (honesty layer 2, `.findings({ argumentSources: true })`
  // or `.inputsLayer({ argumentSources: true })`) — the model's
  // `_findings.from`, checked by the inputs layer. It has nothing to act on
  // without the layer, and configured-and-inert looks exactly like
  // configured-and-working: refused here, at build. (The `.inputsLayer()`
  // door arms the layer itself, so only the findings door can reach this.)
  const argumentSources = this.configuration.argumentSourcesArmed === true;
  if (argumentSources && !inputsArmed) {
    throw new Error(
      'Agent: .findings({ argumentSources: true }) needs the inputs layer — the declared ' +
        'sources are read and checked on the calls of a tool that declares argument rules ' +
        '(askOrAssume), and this agent registers none. Register such a tool, or arm the ' +
        'layer for ToolProvider tools with .inputsLayer() (which can arm the sources itself: ' +
        '.inputsLayer({ argumentSources: true })).',
    );
  }
  // ── The results layer (honesty layer 3, step 7b) — armed ONCE, here ──
  // A registered tool that declares a `ToolPeriod` (the inputs layer's
  // declaration: which argument sets the period) arms the mount, over the
  // same catalog: its results owe a period, and a result that declares none
  // is recorded as silence. `.resultsLayer()` arms it for tools the build
  // cannot see and for tools that declare a period only on their results.
  // Unarmed: nothing below is mounted, read or written.
  const resultsArmed =
    [...registryByName.values()].some((tool) => tool.period !== undefined) ||
    this.configuration.resultsLayerOption === true;
  this.resultsLayerArmed = resultsArmed;
  if (inputsArmed && ruledTools.size > 0) environment.seededRuledTools = ruledTools;
  // ── The answer layer (honesty layer 4) — armed by its option alone ─────
  const answerArmed = this.configuration.answerLayerOption !== undefined;
  // The run constant names every armed layer; the restore is wired whenever
  // one is (adopted Q6) — still value-conditional inside seed.
  if (inputsArmed || resultsArmed || answerArmed) {
    environment.seededHonestyLayers = honestyLayersOf({
      inputs: inputsArmed,
      argumentSources,
      results: resultsArmed,
      answer: answerArmed,
    });
    environment.ledgerRestoreArmed = true;
  }
  // The time layer's rows ride the same ledger: a continued conversation
  // keeps its earlier turns' clocks (each turn files its own).
  if (this.configuration.timeOptions !== undefined) environment.ledgerRestoreArmed = true;
  // The script record's rows too: a continued conversation keeps each
  // earlier call's facts — seed drops their text (`scripts/rows.ts`).
  const scriptRecordArmed =
    this.configuration.evidenceGate?.code === 'match' ||
    this.configuration.scriptTravel !== undefined;
  if (scriptRecordArmed) environment.ledgerRestoreArmed = true;
  return {
    registryByName,
    toolSchemas,
    toolDeclaringSkills,
    toolClaimants,
    inputsArmed,
    argumentSources,
    resultsArmed,
    answerArmed,
    scriptRecordArmed,
  };
}
