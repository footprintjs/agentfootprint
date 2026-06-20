import { source } from '@/lib/source';

/**
 * Render one doc page to LLM-friendly Markdown (title + URL + processed body).
 * Used by the llms.txt / llms-full.txt / per-page raw-markdown routes.
 */
export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
