import type { AgentConfiguration } from '../runtime/configuration/types.js';
import type { Tool } from '../../../tools/tools.js';
import type { SourceEvidencePreparationContext } from '../../../tools/sourceEvidence.js';
import { untilAborted } from '../../../lib/abort.js';

/** Current declared implementations, with one fresh provider listing per preparation lease. */
export function preparationCatalog(configuration: AgentConfiguration) {
  const declared = new Map<string, Tool>();
  for (const entry of configuration.registry) declared.set(entry.name, entry.tool);
  for (const injection of configuration.injections)
    if (injection.flavor === 'skill')
      for (const tool of injection.inject.tools ?? [])
        if (!declared.has(tool.schema.name)) declared.set(tool.schema.name, tool);
  let listed: Promise<ReadonlyMap<string, Tool>> | undefined;
  return async (context: SourceEvidencePreparationContext) => {
    listed ??= Promise.resolve().then(async () => {
      const tools = await untilAborted(
        Promise.resolve(
          configuration.externalToolProvider?.list({
            iteration: 0,
            ...(context.identity !== undefined && {
              identity: context.identity,
              callerIdentity: context.identity,
            }),
            ...(context.signal !== undefined && { signal: context.signal }),
          }) ?? [],
        ),
        context.signal,
      );
      const current = new Map<string, Tool>();
      for (const tool of tools)
        if (!current.has(tool.schema.name)) current.set(tool.schema.name, tool);
      for (const [name, tool] of declared) {
        if (!current.has(name)) current.set(name, tool);
        else if (current.get(name) !== tool) current.delete(name);
      }
      return current;
    });
    return untilAborted(listed, context.signal);
  };
}
