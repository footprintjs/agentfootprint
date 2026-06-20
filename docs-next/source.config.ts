import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';

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
