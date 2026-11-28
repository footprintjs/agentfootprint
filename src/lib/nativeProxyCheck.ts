function nodeProxyCheck(): ((value: unknown) => boolean) | undefined {
  try {
    const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
      .process;
    return (host?.getBuiltinModule?.('node:util') as typeof import('node:util') | undefined)?.types
      .isProxy;
  } catch {
    return undefined;
  }
}

export const nativeIsProxy = nodeProxyCheck();
