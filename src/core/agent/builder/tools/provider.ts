import type { ToolProvider } from '../../../../tools/toolProvider.js';

export interface ToolProviderPort {
  toolProviderRef?: ToolProvider;
}

export function setToolProvider(
  self: ToolProviderPort,
  provider: ToolProvider,
  original: object,
): object {
  if (self.toolProviderRef) {
    throw new Error(
      'AgentBuilder.toolProvider: already set. Each agent has at most one external ToolProvider.',
    );
  }
  self.toolProviderRef = provider;
  return original;
}
