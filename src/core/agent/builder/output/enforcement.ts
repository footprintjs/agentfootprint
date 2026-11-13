import type { ResolvedAnswerValidation } from '../../../../answer-validation/index.js';
import type {
  OutputSchemaParser,
  OutputSchemaStrategy,
} from '../../../../answer-validation/outputSchema.js';
import type { Injection } from '../../../../injection-engine/types.js';
import type { ToolRegistryEntry } from '../../../../tools/tools.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import type { ResolvedOutputFallback } from '../../../outputFallback.js';
import {
  buildSchemaTool,
  resolveJsonSchema,
  SCHEMA_TOOL_NAME,
  type ResolvedOutputEnforcement,
} from '../../outputEnforcement.js';
import { nativeOutputFormat, NativeOutputSchemaError } from '../../nativeOutputFormat.js';
import type { ResolvedNegativeClaims } from '../../negativeClaims/config.js';
import type { SelfExplainExtension } from '../../selfExplainPort.js';
import type { AgentOptions } from '../../types.js';

type SelfExplainConfiguration = Parameters<SelfExplainExtension['binding']>[0];

export interface OutputEnforcementPort {
  outputSchemaParser?: OutputSchemaParser<unknown>;
  outputSchemaStrategy: OutputSchemaStrategy;
  outputSchemaRetries: number;
  outputSchemaJson?: Readonly<Record<string, unknown>>;
  readonly registry: ToolRegistryEntry[];
  readonly injectionList: Injection[];
  toolProviderRef?: ToolProvider;
  selfExplainConfig?: SelfExplainConfiguration;
  findingsValue?: NonNullable<AgentOptions['findings']>;
  readonly opts: Pick<AgentOptions, 'findings'>;
  negativeClaimsConfig?: ResolvedNegativeClaims;
  outputFallbackCfg?: ResolvedOutputFallback<unknown>;
  answerValidationConfig?: ResolvedAnswerValidation;
}

export function resolveOutputEnforcement(
  self: Readonly<OutputEnforcementPort>,
  servedSchema: Readonly<Record<string, unknown>> | undefined,
): ResolvedOutputEnforcement | undefined {
  const parser = self.outputSchemaParser;
  if (!parser) return undefined;

  let schemaTool;
  if (self.outputSchemaStrategy === 'tool-forced') {
    // Refusal 1 — the strategy and the agent's tools cannot both be true.
    // Forcing the choice BY NAME is what makes the shape a guarantee, and
    // it also means no other tool can be called on any turn: a tool-using
    // agent would quietly become single-shot. That is config that lies in
    // the other direction, so it is refused rather than allowed to happen.
    const toolNames = self.registry.map((entry) => entry.name);
    const skillCount = self.injectionList.filter((i) => i.flavor === 'skill').length;
    const reasons: string[] = [];
    if (toolNames.length > 0)
      reasons.push(`registers ${toolNames.length} tool(s) (${toolNames.join(', ')})`);
    if (self.toolProviderRef !== undefined) reasons.push('has a .toolProvider()');
    if (skillCount > 0) reasons.push(`has ${skillCount} skill(s), which reach the model as tools`);
    if (self.selfExplainConfig !== undefined)
      reasons.push('has .selfExplain(), which attaches trace tools');
    if (reasons.length > 0) {
      throw new Error(
        `AgentBuilder.outputSchema: strategy 'tool-forced' forces every answer through ` +
          `the '${SCHEMA_TOOL_NAME}' tool by name, so NO other tool can be called on any ` +
          `turn — and this agent ${reasons.join('; ')}. Rather than let those tools go ` +
          `silently unusable, two honest paths: drop the tools and keep the forced shape, ` +
          `or keep the tools and use { strategy: 'instruct', retries: N } — the corrective ` +
          `loop works on every provider and leaves the agent an agent.`,
      );
    }

    // Refusal 2 — a tool needs its shape, and the library will not invent one.
    const jsonSchema = resolveJsonSchema(parser, servedSchema ?? self.outputSchemaJson);
    if (jsonSchema === undefined) {
      throw new Error(
        `AgentBuilder.outputSchema: strategy 'tool-forced' puts the schema on the wire as ` +
          `a tool, and a tool carries its shape as JSON Schema. This parser does not offer ` +
          `one (no \`toJsonSchema()\` method), and a \`parse()\` function is not something ` +
          `the library gets to guess a shape from. Pass it: .outputSchema(parser, ` +
          `{ strategy: 'tool-forced', jsonSchema: { type: 'object', properties: { … } } }).`,
      );
    }
    schemaTool = buildSchemaTool(jsonSchema, parser.description);
  }

  // `'native'` — the provider's structured output. No tools refusal: the
  // format constrains the TEXT answer only, so the model may still call a
  // tool first and the agent stays an agent. The shape comes from the same
  // place, and is refused the same way when there is none; what the API
  // cannot express is refused by `nativeOutputFormat`, naming the node.
  let outputFormat;
  if (self.outputSchemaStrategy === 'native' || self.outputSchemaStrategy === 'auto') {
    const jsonSchema = resolveJsonSchema(parser, servedSchema ?? self.outputSchemaJson);
    if (jsonSchema === undefined && self.outputSchemaStrategy === 'native') {
      throw new Error(
        `AgentBuilder.outputSchema: strategy 'native' sends the schema to the provider as ` +
          `JSON Schema (Anthropic's output_config.format). This parser does not offer one (no ` +
          `\`toJsonSchema()\` method), and a \`parse()\` function is not something the library ` +
          `gets to guess a shape from. Pass it: .outputSchema(parser, { strategy: 'native', ` +
          `jsonSchema: { type: 'object', properties: { … } } }).`,
      );
    }
    // The answer may carry `_findings` when the ledger is armed — from
    // either door, the same test `Agent` arms it by.
    const findingsArmed =
      self.findingsValue !== undefined ||
      (self.opts as { readonly findings?: unknown }).findings !== undefined;
    if (jsonSchema !== undefined) {
      try {
        outputFormat = nativeOutputFormat(jsonSchema, { findings: findingsArmed });
      } catch (error) {
        // Auto is best available transport, not a stricter schema contract.
        // Known wire-subset refusals retain instruction + local parsing.
        // Explicit native and unexpected lowering failures still fail.
        if (self.outputSchemaStrategy !== 'auto' || !(error instanceof NativeOutputSchemaError))
          throw error;
      }
    }
  }

  // Mounted whenever a parser exists (8.18.0). Until then, `retries: 0` —
  // the DEFAULT, and what `.outputSchema(parser)` means on its own — returned
  // `undefined` here: no judging in the loop, no `outputAttempts` row, no
  // event, a chart byte-identical to an agent with no contract at all. The
  // declaration bought a prompt sentence and a `runTyped()` parse, and a
  // caller on `run()` could not tell from the record that a contract had ever
  // been declared, let alone missed.
  //
  // `0` still mounts no retry BRANCH (see buildAgentChart) and still spends
  // no extra turn. It means judge, do not re-ask.
  return {
    parser,
    retries:
      self.negativeClaimsConfig?.mode !== 'typed'
        ? self.outputSchemaRetries
        : Math.min(self.outputSchemaRetries, 1),
    ...(schemaTool !== undefined && { schemaTool }),
    ...(outputFormat !== undefined && {
      outputFormat,
      ...(self.outputSchemaStrategy === 'auto' && { nativeOutputAuto: true as const }),
    }),
    hasFallback: self.outputFallbackCfg !== undefined,
    ...(self.negativeClaimsConfig?.mode === 'typed' && { negativeClaimsEnforced: true as const }),
    ...((self.answerValidationConfig?.mode === 'enforce' ||
      self.negativeClaimsConfig?.mode === 'typed') && {
      answerValidationEnforced: true,
    }),
  };
}
