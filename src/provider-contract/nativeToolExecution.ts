import type { LLMProvider } from './types.js';

type EntryPoints = Pick<LLMProvider, 'complete' | 'stream'>;

const providers = new WeakMap<LLMProvider, EntryPoints>();

/** Only the adapter that constructs the native client-tool request can attest this scope. */
export function markNativeToolExecution(provider: LLMProvider): void {
  providers.set(provider, {
    complete: provider.complete,
    ...(provider.stream !== undefined && { stream: provider.stream }),
  });
}

/** A replacement or wrapper cannot inherit the original transport's receipt authority. */
export function hasNativeToolExecution(provider: LLMProvider): boolean {
  const registered = providers.get(provider);
  return (
    registered !== undefined &&
    registered.complete === provider.complete &&
    registered.stream === provider.stream
  );
}
