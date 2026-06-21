import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';

// Per-page raw Markdown: any doc page is fetchable as text/markdown for AI agents
// (the "copy as Markdown / open in ChatGPT" foundation) — e.g. /llms.mdx/docs/getting-started
export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

export function generateStaticParams() {
  const params = source.generateParams();
  // Static export writes each route handler to a FILE at out/<path>. A page whose path is
  // also the parent of other pages (a folder-index, e.g. /docs or /docs/api) would need to
  // be both a file and a directory → EISDIR. Skip those here; their content is still served
  // whole by /llms.txt + /llms-full.txt. Leaf pages (the vast majority) keep per-page .mdx.
  const keys = params.map((p) => (p.slug ?? []).join('/'));
  return params.filter((p) => {
    const k = (p.slug ?? []).join('/');
    const prefix = k === '' ? '' : `${k}/`;
    return !keys.some((other) => other !== k && other.startsWith(prefix));
  });
}
