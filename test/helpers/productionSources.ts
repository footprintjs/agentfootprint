import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Architecture checks inspect shipped source, excluding adjacent tests and declarations. */
export function productionSources(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return productionSources(path);
      return path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts')
        ? [path]
        : [];
    });
}
