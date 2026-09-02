import { SITE } from './site';
import {
  CREATOR_ID,
  ECOSYSTEM_ID,
  ECOSYSTEM_PROJECTS,
  ORGANIZATION_ID,
  projectSoftwareId,
} from './ecosystem';

/**
 * Site-wide JSON-LD @graph — rendered on the home page AND every docs page so the
 * "Sanjay Krishna Anbalagan = creator of agentfootprint" claim is asserted on every indexed
 * URL, not just the home page. The Person points at the REAL personal profile (SITE.authorUrl)
 * with `sameAs`, which is the property Google uses to reconcile the person entity — previously
 * the Person pointed at the org and had no sameAs, so it was a no-op for author discoverability.
 *
 * Single source of truth: edit author identity in lib/site.ts (authorName/authorUrl), not here.
 */
export function siteJsonLd() {
  const software = ECOSYSTEM_PROJECTS.map((project) => ({
    '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
    '@id': projectSoftwareId(project),
    name: project.name,
    alternateName: [...project.aliases],
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Node.js, browser',
    programmingLanguage: 'TypeScript',
    description: project.description,
    url: project.url,
    codeRepository: project.repo,
    author: { '@id': CREATOR_ID },
    creator: { '@id': CREATOR_ID },
    publisher: { '@id': ORGANIZATION_ID },
    isPartOf: { '@id': ECOSYSTEM_ID },
    sameAs: [project.repo, ...('npm' in project ? [project.npm] : [])],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(project.id === 'agentfootprint'
      ? { license: 'https://opensource.org/licenses/MIT' }
      : {}),
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE.url}/#website`,
        url: `${SITE.url}/`,
        name: SITE.name,
        alternateName: ['AgentFootprint', 'Agent Footprint', 'agentfootprint.dev'],
        description: SITE.description,
        inLanguage: 'en',
        publisher: { '@id': ORGANIZATION_ID },
        about: { '@id': `${SITE.url}/#software` },
        mentions: ECOSYSTEM_PROJECTS.map((project) => ({
          '@id': projectSoftwareId(project),
        })),
      },
      {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: SITE.publisher,
        url: 'https://footprintjs.github.io/',
        sameAs: [SITE.org],
        founder: { '@id': CREATOR_ID },
      },
      {
        '@type': 'Person',
        '@id': CREATOR_ID,
        name: SITE.authorName,
        // the real person — primary profile + every profile that corroborates the same identity
        url: SITE.authorUrl,
        sameAs: [...SITE.authorSameAs],
      },
      {
        '@type': 'ItemList',
        '@id': ECOSYSTEM_ID,
        name: 'footprintjs ecosystem',
        description:
          'Seven connected open-source projects for execution provenance, agent debugging, agent-operable applications, visual analysis, and evidence interfaces.',
        numberOfItems: ECOSYSTEM_PROJECTS.length,
        itemListElement: ECOSYSTEM_PROJECTS.map((project, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: { '@id': projectSoftwareId(project) },
        })),
      },
      ...software,
    ],
  };
}
