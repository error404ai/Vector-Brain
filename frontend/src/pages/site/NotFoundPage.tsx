import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import '@/seo/fonts';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';

/** Unknown URL. The server answers it with HTTP 404 and this page. */
export default function NotFoundPage() {
  return (
    <div className="st">
      <Helmet>
        <title>Page not found | FLEET</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <SiteHeader />
      <main className="st-page" id="content">
        <div className="st-hero">
          <h1>Page not found</h1>
          <div className="st-lede">
            <p>This address does not exist, or it has moved. These pages might be what you were looking for:</p>
          </div>
          <div className="st-actions">
            <Link className="st-btn" to="/">
              Home
            </Link>
            <Link className="st-btn ghost" to="/docs">
              Docs
            </Link>
            <Link className="st-btn ghost" to="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
