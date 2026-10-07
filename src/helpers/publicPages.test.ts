import { createPageRouter, routePattern } from './publicPages';

const route = createPageRouter({
  pages: { '/': 'index.html', '/docs': 'docs.html', '/compare/appium': 'compare--appium.html' },
  notFound: '404.html',
  appRoutes: ['/login', '/dashboard', '/mission-control', '/runs/:id'],
});

describe('public page routing', () => {
  it('serves prerendered public pages', () => {
    expect(route('/')).toEqual({ kind: 'page', file: 'index.html' });
    expect(route('/compare/appium')).toEqual({ kind: 'page', file: 'compare--appium.html' });
  });

  it('redirects trailing slashes and /index.html to the canonical URL', () => {
    expect(route('/docs/')).toEqual({ kind: 'redirect', to: '/docs' });
    expect(route('/index.html')).toEqual({ kind: 'redirect', to: '/' });
  });

  it('keeps app routes on the app shell, including parameters', () => {
    expect(route('/mission-control')).toEqual({ kind: 'app' });
    expect(route('/dashboard/')).toEqual({ kind: 'app' });
    expect(route('/runs/42')).toEqual({ kind: 'app' });
  });

  it('answers unknown paths with a 404', () => {
    expect(route('/nope')).toEqual({ kind: 'notFound', file: '404.html' });
    expect(route('/runs/42/extra')).toEqual({ kind: 'notFound', file: '404.html' });
  });

  it('falls back to the app shell without a manifest', () => {
    expect(createPageRouter(null)('/anything')).toEqual({ kind: 'app' });
  });

  it('escapes route text', () => {
    expect(routePattern('/a.b').test('/aXb')).toBe(false);
  });
});
