import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // expose processed Markdown per page → powers llms.txt / llms-full.txt / raw .md
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig();
