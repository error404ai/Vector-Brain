import { loaderVisible } from '@/_helpers/clientDiagnostics';
import { useEffect, useState } from 'react';

const SLOW_AFTER_MS = 15_000;

const KEYFRAMES = `@keyframes vb-loader-dot{0%,80%,100%{transform:scale(.6);opacity:.35}40%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.vb-loader-dot{animation:none!important;opacity:.7}}`;

/**
 * Full-screen loader for a cold load. Plain CSS, no MUI: it shows on every
 * route, public pages included, and must not pull the MUI bundle in with it.
 */
export function GlobalLoader() {
  const [slow, setSlow] = useState(false);

  // Tells the browser diagnostics how long the full-screen loader stays up;
  // over 10 s it is reported as stuck_loader with a snapshot of the page.
  useEffect(() => {
    loaderVisible(true);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      loaderVisible(false);
    };
  }, []);

  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}
    >
      <style>{KEYFRAMES}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="vb-loader-dot"
              style={{ width: 12, height: 12, borderRadius: '50%', background: '#2563eb', animation: `vb-loader-dot 1.2s ${i * 0.16}s infinite ease-in-out` }}
            />
          ))}
        </div>
        {slow ? (
          <>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>Taking longer than usual. This has been reported.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: '6px 14px', border: 0, borderRadius: 8, background: 'rgba(37,99,235,.1)', color: '#1d4ed8', font: '700 13px "Inter", system-ui, sans-serif', cursor: 'pointer' }}
            >
              Reload
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default GlobalLoader;
