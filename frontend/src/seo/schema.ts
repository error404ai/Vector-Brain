import { absolute, crumbsFor, SITE, type PublicPage } from './site';

/**
 * JSON-LD for the public pages. Only facts the product backs: no ratings,
 * review counts, user numbers or awards. The price is 0 because FLEET is free
 * to use today (owner-confirmed); change it here when that changes.
 */

type Json = Record<string, unknown>;

const ORG_ID = `${SITE.origin}/#organization`;
const SITE_ID = `${SITE.origin}/#website`;
const APP_ID = `${SITE.origin}/#software`;

export const organization = (): Json => ({
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE.org,
  url: SITE.origin,
  email: SITE.email,
  logo: `${SITE.origin}/favicon.svg`,
  brand: { '@type': 'Brand', name: SITE.name },
  contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: SITE.email },
});

export const website = (): Json => ({
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: SITE.fullName,
  alternateName: [SITE.name, 'Vector Brain'],
  url: SITE.origin,
  publisher: { '@id': ORG_ID },
});

export const software = (): Json => ({
  '@type': 'SoftwareApplication',
  '@id': APP_ID,
  name: SITE.name,
  alternateName: [SITE.fullName, 'Vector Brain'],
  description: SITE.definition,
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'AI Android automation',
  operatingSystem: 'Web, Android 10 or newer',
  url: SITE.origin,
  image: absolute(SITE.shareImage),
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Natural-language tasks run by an AI agent on real Android phones',
    'Up to 1,000 phones in one fleet, up to 50 per mission',
    'Live view of every phone screen',
    'No root, ADB or USB cable; works through Android accessibility',
    'Bring your own AI model key',
    'Proxy lanes with IP rotation and per-phone network checks',
    'Saved flows that replay without AI calls',
  ],
  publisher: { '@id': ORG_ID },
});

export const breadcrumbs = (page: PublicPage): Json | null => {
  const trail = crumbsFor(page);
  if (trail.length < 2) return null;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(c.path) })),
  };
};

export const faqPage = (faq: { q: string; a: string }[]): Json => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const webPage = (page: PublicPage): Json => ({
  '@type': page.kind === 'article' ? 'TechArticle' : 'WebPage',
  '@id': `${absolute(page.path)}#page`,
  url: absolute(page.path),
  name: page.title,
  headline: page.label,
  description: page.description,
  isPartOf: { '@id': SITE_ID },
  about: { '@id': APP_ID },
  publisher: { '@id': ORG_ID },
  inLanguage: 'en',
});

/** The full graph for a page. */
export function graphFor(page: PublicPage, faq?: { q: string; a: string }[]): Json {
  const nodes: Json[] = [];
  if (page.kind === 'home') nodes.push(organization(), website(), software());
  else nodes.push(webPage(page));
  const crumbs = breadcrumbs(page);
  if (crumbs) nodes.push(crumbs);
  if (faq?.length) nodes.push(faqPage(faq));
  return { '@context': 'https://schema.org', '@graph': nodes };
}
