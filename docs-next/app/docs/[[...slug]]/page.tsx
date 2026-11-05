import { navTrees, source } from '@/lib/source';
import { DocsShell } from '@/components/DocsShell';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/notebook/page';
import { notFound, permanentRedirect } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import aliases from '@/lib/generated-api-aliases.json';
import { resolveApiAlias } from '@/lib/api-groups.mjs';

function pageFor(slug: string[] | undefined) {
  const requested = `/docs/${(slug ?? []).join('/')}`.replace(/\/$/, '');
  const canonical = resolveApiAlias(requested, aliases);
  if (canonical !== requested) permanentRedirect(canonical);
  const page = source.getPage(slug);
  if (!page) notFound();
  return page;
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = pageFor(params.slug);

  const MDX = page.data.body;
  const tree =
    params.slug?.[0] === 'api' && navTrees.apiTree ? navTrees.apiTree : navTrees.guideTree;
  // Topic pages navigate by interface; all property anchors remain available in the body.
  const toc = aliases.some((alias) => alias.to === page.url)
    ? page.data.toc.filter((item) => item.depth <= 2)
    : page.data.toc;

  return (
    <DocsShell tree={tree}>
      <DocsPage toc={toc} full={page.data.full} tableOfContent={{ style: 'clerk' }}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
        </DocsBody>
      </DocsPage>
    </DocsShell>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

const API_KINDS: Readonly<Record<string, string>> = {
  classes: 'class',
  functions: 'function',
  interfaces: 'interface',
  'type-aliases': 'type',
  variables: 'constant',
};

/** About 800 generated API pages have no description of their own. Giving each one keeps them from all repeating the site's. */
function fallbackDescription(url: string, title: string): string {
  const kind = API_KINDS[url.split('/')[3] ?? ''];
  return kind ? `${title}: a ${kind} in the agentfootprint TypeScript API.` : SITE.description;
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = pageFor(params.slug);

  const url = `${SITE.url}${page.url}`;
  const description = page.data.description ?? fallbackDescription(page.url, page.data.title);
  return {
    title: page.data.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      siteName: SITE.name,
      title: page.data.title,
      description,
      images: [SITE.ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      site: SITE.twitter,
      creator: SITE.twitter,
      title: page.data.title,
      description,
      images: [SITE.ogImage],
    },
  };
}
