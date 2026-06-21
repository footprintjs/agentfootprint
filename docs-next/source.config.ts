import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { remarkDocLinks } from './lib/remark-doc-links.mjs';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // expose processed Markdown per page → powers llms.txt / llms-full.txt / raw .md
    postprocess: {
      includeProcessedMarkdown: true,
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
