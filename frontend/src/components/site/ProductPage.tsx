import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Seo from '@/seo/Seo';
import '@/seo/fonts';
import { Breadcrumbs, SiteFooter, SiteHeader } from './SiteChrome';

export interface Faq {
  q: string;
  a: string;
}

/**
 * Layout for a public product, use-case or legal page: header, breadcrumb,
 * a hero that states what the page is about, the page's own sections, an
 * optional FAQ (also emitted as FAQPage schema), related links and a CTA.
 */
export default function ProductPage({
  path,
  h1,
  lede,
  spec,
  faq,
  related,
  cta = true,
  children,
}: {
  path: string;
  h1: string;
  lede: ReactNode;
  spec?: [string, string][];
  faq?: Faq[];
  related?: { to: string; label: string; note?: string }[];
  cta?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="st">
      <Seo path={path} faq={faq} />
      <SiteHeader />
      <main className="st-page" id="content">
        <Breadcrumbs path={path} />
        <div className="st-hero">
          <h1>{h1}</h1>
          <div className="st-lede">{lede}</div>
          {cta && (
            <div className="st-actions">
              <Link className="st-btn" to="/signup">
                Start free
              </Link>
              <Link className="st-btn ghost" to="/docs">
                Read the docs
              </Link>
            </div>
          )}
          {spec && (
            <dl className="st-spec">
              {spec.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="st-body">
          {children}

          {faq && faq.length > 0 && (
            <section className="st-faq" aria-labelledby="faq-h">
              <h2 id="faq-h">Questions</h2>
              {faq.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </section>
          )}
        </div>

        {related && related.length > 0 && (
          <aside className="st-related" aria-labelledby="related-h">
            <h2 id="related-h">Related</h2>
            <ul>
              {related.map((r) => (
                <li key={r.to}>
                  <Link to={r.to}>{r.label}</Link>
                  {r.note ? ` — ${r.note}` : null}
                </li>
              ))}
            </ul>
          </aside>
        )}

        {cta && (
          <section className="st-cta-band" aria-labelledby="cta-h">
            <h2 id="cta-h">Connect your first phone</h2>
            <p>Install the Vector app, pair it with a code, add your AI key and send one task. When it works on one phone, send it to all of them.</p>
            <Link className="st-btn" to="/signup">
              Start free
            </Link>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
