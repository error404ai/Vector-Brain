import { Link } from 'react-router-dom';
import { crumbsFor, FOOTER_GROUPS, pageFor, SITE } from '@/seo/site';
import './site.css';

/** Plain <a> for files the router does not own (llms.txt). */
function SiteLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return /\.\w+$/.test(to) ? (
    <a href={to} className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

export function SiteHeader({ section }: { section?: string }) {
  return (
    <header className="st-top">
      <Link to="/" className="st-brand" aria-label={`${SITE.fullName}, home`}>
        <b>{SITE.name}</b>
        <span>{section ?? 'by Vector Brain'}</span>
      </Link>
      <nav aria-label="Site">
        <Link to="/how-it-works" className="st-hide-sm">
          How it works
        </Link>
        <Link to="/docs" className="st-hide-sm">
          Docs
        </Link>
        <Link to="/login">Sign in</Link>
        <Link className="st-cta" to="/signup">
          Get started
        </Link>
      </nav>
    </header>
  );
}

export function Breadcrumbs({ path }: { path: string }) {
  const page = pageFor(path);
  const trail = page ? crumbsFor(page) : [];
  if (trail.length < 2) return null;
  return (
    <nav className="st-crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => (
          <li key={c.path + i}>{i < trail.length - 1 ? <Link to={c.path}>{c.name}</Link> : <span aria-current="page">{c.name}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="st-foot">
      <div className="st-foot-in">
        <div className="st-foot-id">
          <Link to="/" className="st-brand">
            <b>{SITE.name}</b>
            <span>by Vector Brain</span>
          </Link>
          <p>{SITE.definition}</p>
          <p>
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          </p>
        </div>
        <nav className="st-foot-map" aria-label="Footer">
          {FOOTER_GROUPS.map((g) => (
            <div key={g.title}>
              <h2>{g.title}</h2>
              <ul>
                {g.links.map((l) => (
                  <li key={l.path}>
                    <SiteLink to={l.path}>{l.name}</SiteLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className="st-foot-legal">
        © {new Date().getFullYear()} {SITE.org}. {SITE.fullName}.
      </p>
    </footer>
  );
}
