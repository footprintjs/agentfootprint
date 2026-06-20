import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

// The llms.txt INDEX: a machine-readable map of the docs for AI agents to discover.
export const revalidate = false;

export function GET() {
  return new Response(llms(source).index(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
