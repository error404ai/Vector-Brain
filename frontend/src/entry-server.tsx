/* eslint-disable react-refresh/only-export-components -- build-time entry, never hot-reloaded */
/**
 * Build-time rendering of the public pages (scripts/prerender.mjs). Each page
 * is rendered to HTML with its <head> tags, so crawlers, link previews and AI
 * tools read the real content without running JavaScript. The browser then
 * renders the same page over it (see main.tsx).
 */
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { HelmetProvider, type HelmetServerState } from 'react-helmet-async';
import { StaticRouter } from 'react-router-dom';
import DocsPage from './pages/DocsPage';
import HomePage from './pages/HomePage';
import CompareAppiumPage from './pages/site/CompareAppiumPage';
import FleetAutomationPage from './pages/site/FleetAutomationPage';
import HowItWorksPage from './pages/site/HowItWorksPage';
import { ContactPage, PrivacyPage, TermsPage } from './pages/site/LegalPages';
import MobileTestingPage from './pages/site/MobileTestingPage';
import NotFoundPage from './pages/site/NotFoundPage';
import PhoneFarmPage from './pages/site/PhoneFarmPage';

export { PUBLIC_PAGES, SITE } from './seo/site';

/** The not-found page is rendered under this key and served with HTTP 404. */
export const NOT_FOUND = '/404';

const PAGES: Record<string, ComponentType> = {
  '/': HomePage,
  '/docs': DocsPage,
  '/how-it-works': HowItWorksPage,
  '/android-fleet-automation': FleetAutomationPage,
  '/phone-farm-automation': PhoneFarmPage,
  '/use-cases/mobile-app-testing': MobileTestingPage,
  '/compare/appium': CompareAppiumPage,
  '/contact': ContactPage,
  '/privacy': PrivacyPage,
  '/terms': TermsPage,
  [NOT_FOUND]: NotFoundPage,
};

export const renderedPaths = Object.keys(PAGES);

export function render(path: string): { html: string; head: string; htmlAttrs: string } {
  const Page = PAGES[path];
  if (!Page) throw new Error(`No public page for ${path}`);
  const context: { helmet?: HelmetServerState } = {};
  const html = renderToString(
    <HelmetProvider context={context}>
      <StaticRouter location={path === NOT_FOUND ? '/not-found' : path}>
        <Page />
      </StaticRouter>
    </HelmetProvider>,
  );
  const h = context.helmet;
  const head = h
    ? [h.title.toString(), h.priority.toString(), h.meta.toString(), h.link.toString(), h.script.toString()].filter(Boolean).join('\n')
    : '';
  return { html, head, htmlAttrs: h ? h.htmlAttributes.toString() : '' };
}
