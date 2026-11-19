import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { remarkDocLinks } from './lib/remark-doc-links.mjs';
import { extractRegion } from './lib/regionExtractor';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // expose processed Markdown per page → powers llms.txt / llms-full.txt / raw .md
    postprocess: {
      includeProcessedMarkdown: {
        stringify(node) {
          if (node.type !== 'mdxJsxFlowElement' || node.name !== 'CodeFile') return;
          const file = node.attributes.find(
            (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'path',
          )?.value;
          if (typeof file !== 'string' || !/^docs-demo\/src\/samples\/replay-(why|flow|trace)\.tsx$/.test(file)) return;

          // These adapters used to be fenced code in the machine-readable guide.
          const region = node.attributes.find(
            (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'region',
          )?.value;
          const source = readFileSync(resolve(process.cwd(), '..', file), 'utf8');
          const code = typeof region === 'string' ? extractRegion(source, region, file).code : source;
          return `\`\`\`tsx\n${code}\n\`\`\``;
        },
      },
    },
  },
});

export default defineConfig({
  mdxOptions: {
    // Resolve stable `doc:<id>` cross-references to real routes at build time (throws on
    // an unknown id). Keeps internal links immune to taxonomy/folder moves. See
    // lib/remark-doc-links.mjs + lib/doc-ids.mjs.
    remarkPlugins: [remarkDocLinks],
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      // Twoslash compile-checks any ```ts twoslash block at build time, against the
      // real agentfootprint types (resolved via the local file:.. dep). A guide snippet
      // that uses a renamed/removed API fails the build — anti-drift for hand-written code.
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash(),
      ],
    },
  },
});
