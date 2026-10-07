import { Helmet } from 'react-helmet-async';
import { graphFor } from './schema';
import { absolute, pageFor, SITE } from './site';

/**
 * The <head> of a public page, from its entry in site.ts. Rendered into the
 * HTML at build time (prerender) and kept in sync on the client by Helmet.
 */
export default function Seo({ path, faq }: { path: string; faq?: { q: string; a: string }[] }) {
  const page = pageFor(path);
  if (!page) return null;
  const url = absolute(page.path);
  const image = absolute(SITE.shareImage);
  return (
    <Helmet prioritizeSeoTags>
      <html lang="en" />
      <title>{page.title}</title>
      <meta name="description" content={page.description} />
      <link rel="canonical" href={url} />
      <meta name="robots" content="index, follow, max-image-preview:large" />
      <meta property="og:type" content={page.kind === 'home' ? 'website' : 'article'} />
      <meta property="og:site_name" content={SITE.fullName} />
      <meta property="og:title" content={page.title} />
      <meta property="og:description" content={page.description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="FLEET — AI that operates real Android phones" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.title} />
      <meta name="twitter:description" content={page.description} />
      <meta name="twitter:image" content={image} />
      <link rel="alternate" type="text/plain" href="/llms.txt" title="FLEET summary for AI tools" />
      <script type="application/ld+json">{JSON.stringify(graphFor(page, faq))}</script>
    </Helmet>
  );
}
