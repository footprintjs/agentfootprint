import { SITE } from './site';

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
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE.url}/#website`,
        url: `${SITE.url}/`,
        name: SITE.name,
        description: SITE.description,
        publisher: { '@id': `${SITE.url}/#org` },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE.url}/#org`,
        name: SITE.publisher,
        url: SITE.org,
        sameAs: [SITE.org, SITE.repo, SITE.core, SITE.npm],
      },
      {
        '@type': 'Person',
        '@id': `${SITE.url}/#author`,
        name: SITE.authorName,
        // the real person — primary profile + every profile that corroborates the same identity
        url: SITE.authorUrl,
        sameAs: [...SITE.authorSameAs],
      },
      {
        '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
        '@id': `${SITE.url}/#software`,
        name: SITE.name,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js, browser',
        programmingLanguage: 'TypeScript',
        description: SITE.description,
        url: `${SITE.url}/`,
        codeRepository: SITE.repo,
        author: { '@id': `${SITE.url}/#author` },
        creator: { '@id': `${SITE.url}/#author` }, // explicit "inventor" semantics
        publisher: { '@id': `${SITE.url}/#org` },
        sameAs: [SITE.repo, SITE.npm],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/licenses/MIT',
      },
    ],
  };
}
