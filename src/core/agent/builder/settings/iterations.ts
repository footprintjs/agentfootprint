export interface IterationLimitPort {
  maxIterationsOverride?: number;
}

export function setMaxIterations(self: IterationLimitPort, n: number, original: object): object {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`AgentBuilder.maxIterations: expected a positive integer, got ${n}.`);
  }
  self.maxIterationsOverride = n;
  return original;
}
