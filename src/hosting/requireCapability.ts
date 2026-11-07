import type { AgentHost, ConversationHost, HostCapability } from './types.js';

/**
 * Refuse a host that lacks a capability. The one refusal that is a programming
 * mistake rather than a runtime condition, so it throws a plain `Error`: nothing
 * branches on "I forgot to feature-detect", it just needs to say so loudly and
 * name the adapter it is talking about.
 */
export function requireCapability(
  host: AgentHost | ConversationHost,
  capability: HostCapability,
): void {
  if (host.capabilities.includes(capability)) return;
  const has = host.capabilities.length > 0 ? host.capabilities.join(', ') : 'none';
  throw new Error(
    `[hosting] the '${host.name}' host does not support '${capability}'. ` +
      `It reports: ${has}. Feature-detect with ` +
      `host.capabilities.includes('${capability}') and fall back, or serve on a host ` +
      `that has it — capabilities are read from the adapter, never assumed from its name.`,
  );
}
