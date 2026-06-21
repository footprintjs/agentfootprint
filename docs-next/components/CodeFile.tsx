import fs from 'node:fs';
import path from 'node:path';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { extractRegion, extractWholeFile } from '@/lib/regionExtractor';

interface CodeFileProps {
  /** Path to the source file, RELATIVE TO THE REPO ROOT (one level above docs-next/). */
  readonly path: string;
  /** Optional region marker name. When omitted, the whole file is shown. */
  readonly region?: string;
  /** Display title (kept for source compatibility; not rendered by DynamicCodeBlock). */
  readonly title?: string;
  /** Language hint (defaults to detected from extension). */
  readonly lang?: string;
}

/**
 * <CodeFile> — import a code block from a real file in the repo (examples/ or src/).
 *
 * Anti-drift, preserved from the Starlight site: docs code ALWAYS comes from a file
 * the test suite already runs. Missing file → fs throws → build fails. Missing region
 * → RegionNotFoundError → build fails. Runs at build/SSG time (Node fs).
 */
export function CodeFile({ path: filePath, region, lang }: CodeFileProps) {
  const repoRoot = path.resolve(process.cwd(), '..');
  const absolutePath = path.resolve(repoRoot, filePath);
  const source = fs.readFileSync(absolutePath, 'utf-8');

  const code = region
    ? extractRegion(source, region, filePath).code
    : extractWholeFile(source);

  const detectedLang =
    lang ??
    (filePath.endsWith('.ts')
      ? 'ts'
      : filePath.endsWith('.tsx')
        ? 'tsx'
        : filePath.endsWith('.js')
          ? 'js'
          : filePath.endsWith('.json')
            ? 'json'
            : 'text');

  return <DynamicCodeBlock lang={detectedLang} code={code} />;
}
