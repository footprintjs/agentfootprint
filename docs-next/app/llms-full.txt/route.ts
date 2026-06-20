import { source } from '@/lib/source';
import { getLLMText } from '@/lib/get-llm-text';

// llms-full.txt: the ENTIRE documentation corpus as one Markdown file (incl. the
// auto-generated API reference), built from the same source — so it can't drift.
export const revalidate = false;

export async function GET() {
  const scanned = await Promise.all(source.getPages().map(getLLMText));
  return new Response(scanned.join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
