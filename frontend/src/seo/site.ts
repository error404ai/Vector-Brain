/**
 * The public site in one place. Every indexable page is listed here with its
 * title, description and breadcrumb, and this list drives the page <head>
 * (Seo.tsx), the build-time prerender, sitemap.xml and the server's routing,
 * so a page cannot exist in one of them and be missing from another.
 */

export const SITE = {
  origin: 'https://app.vectoragent.in',
  /** The product, as named everywhere: titles, schema, llms.txt. */
  name: 'FLEET',
  /** The longer form used where FLEET alone would be ambiguous. */
  fullName: 'FLEET by Vector Brain',
  /** The company behind it (the legal name in the terms and privacy policy). */
  org: 'Vector AI Agent',
  /**
   * FLEET's earlier site; the domain lapsed and is no longer ours. Said once in
   * llms.txt and the schema so search and AI tools can tell old mentions of it
   * apart from whoever holds that domain now.
   */
  formerDomain: 'vectoragent.io',
  email: 'support@vectoragent.in',
  shareImage: '/og/fleet-share.png',
  /** One sentence that defines the product. Reused verbatim. */
  definition:
    'FLEET is an AI Android automation platform: you describe a task in plain words and an AI agent carries it out on real Android phones, from one phone to a fleet of up to 1,000.',
} as const;

export interface Crumb {
  name: string;
  path: string;
}

export interface PublicPage {
  path: string;
  /** <title>, unique per page. */
  title: string;
  description: string;
  /** Shorter title for social cards and breadcrumbs. */
  label: string;
  /** Parent pages, outermost first; the page itself is appended automatically. */
  parents?: Crumb[];
  priority: number;
  changefreq: 'weekly' | 'monthly' | 'yearly';
  kind: 'home' | 'product' | 'article' | 'legal';
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: 'FLEET by Vector Brain — AI Android Automation for Real Phones',
    description:
      'Describe a task in plain words and an AI does it on real Android phones — one phone or up to 1,000. No root, no ADB, no USB. Watch every screen live. Free to use.',
    label: 'FLEET',
    priority: 1,
    changefreq: 'weekly',
    kind: 'home',
  },
  {
    path: '/how-it-works',
    title: 'How FLEET Automates Android Phones with AI | FLEET',
    description:
      'The Vector app reads each screen through Android accessibility, an AI model decides every tap, and the phone is checked after each action. The full picture, including the limits.',
    label: 'How it works',
    priority: 0.9,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/android-fleet-automation',
    title: 'Android Fleet Automation with AI — Control Many Phones at Once | FLEET',
    description:
      'Send one plain-language instruction to dozens of real Android phones. Tags, proxy lanes, retries, pause and resume, and a live view of every screen. Up to 1,000 phones.',
    label: 'Android fleet automation',
    priority: 0.9,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/phone-farm-automation',
    title: 'Phone Farm Automation Software with AI | FLEET',
    description:
      'Run your own Android phone farm from one dashboard: pair phones without ADB, check every phone’s network and IP, rotate proxies and send tasks in plain words.',
    label: 'Phone farm automation',
    priority: 0.8,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/use-cases/mobile-app-testing',
    title: 'AI Mobile App Testing on Real Android Devices | FLEET',
    description:
      'Run the same check on every Android model you own and get a result and final screenshot for each phone. Plain-language test steps, no scripts or selectors.',
    label: 'Mobile app testing',
    parents: [{ name: 'Use cases', path: '/use-cases/mobile-app-testing' }],
    priority: 0.8,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/compare/appium',
    title: 'FLEET vs Appium: AI Phone Automation vs Test Scripts | FLEET',
    description:
      'When a plain-language AI agent on real phones fits better than Appium scripts, and when Appium is still the right tool. A factual comparison.',
    label: 'FLEET vs Appium',
    parents: [{ name: 'Compare', path: '/compare/appium' }],
    priority: 0.7,
    changefreq: 'monthly',
    kind: 'article',
  },
  {
    path: '/android-automation-without-root',
    title: 'Android Automation Without Root or ADB | FLEET',
    description:
      'Automate real Android phones without rooting them, USB debugging or a computer nearby: one app with the accessibility permission, paired with a code, over Wi-Fi or mobile data.',
    label: 'Automation without root',
    priority: 0.8,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/use-cases/install-apps-on-many-phones',
    title: 'Install an App on Many Android Phones at Once | FLEET',
    description:
      'One instruction installs a Play Store app on up to 50 Android phones per mission, and each phone checks the app is really installed. Limits included.',
    label: 'Install apps on many phones',
    parents: [{ name: 'Use cases', path: '/use-cases/mobile-app-testing' }],
    priority: 0.7,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/use-cases/geo-testing',
    title: 'Geo Testing on Real Android Phones by Country | FLEET',
    description:
      'Check prices, language, store listings and consent banners as other countries see them, on real Android phones behind your own proxies, with each phone’s network verified.',
    label: 'Geo testing',
    parents: [{ name: 'Use cases', path: '/use-cases/mobile-app-testing' }],
    priority: 0.7,
    changefreq: 'monthly',
    kind: 'product',
  },
  {
    path: '/compare/cloud-device-farms',
    title: 'Own Android Phones vs Cloud Device Farms | FLEET',
    description:
      'When renting devices from a cloud device farm fits better, and when running plain-language tasks on phones you own does. A factual comparison.',
    label: 'Own phones vs device farms',
    parents: [{ name: 'Compare', path: '/compare/appium' }],
    priority: 0.6,
    changefreq: 'monthly',
    kind: 'article',
  },
  {
    path: '/compare/ai-android-automation-tools',
    title: 'AI Android Automation Tools Compared (2026) | FLEET',
    description:
      'FLEET, Mobilerun (DroidRun), HeyPico, PokeClaw, LaiCai, Momentic, Sofy and Apptest.ai side by side: whose phones, how you drive them, and how many at once.',
    label: 'AI Android automation tools',
    parents: [{ name: 'Compare', path: '/compare/appium' }],
    priority: 0.7,
    changefreq: 'monthly',
    kind: 'article',
  },
  {
    path: '/docs',
    title: 'FLEET Docs — Pair Phones, Run Missions, Fix Problems',
    description:
      'How to pair Android phones, run missions, use tags, proxy lanes and rotation, read network info, set up screenshots and flows, and fix common problems in FLEET.',
    label: 'Docs',
    priority: 0.8,
    changefreq: 'weekly',
    kind: 'article',
  },
  {
    path: '/contact',
    title: 'Contact FLEET Support | FLEET',
    description: 'Questions, bugs, account or data requests for FLEET by Vector Brain (made by Vector AI Agent): email support@vectoragent.in.',
    label: 'Contact',
    priority: 0.4,
    changefreq: 'yearly',
    kind: 'legal',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | FLEET',
    description: 'What FLEET collects from your account and your phones, why, where it goes, how long it is kept and how to have it deleted.',
    label: 'Privacy policy',
    priority: 0.3,
    changefreq: 'yearly',
    kind: 'legal',
  },
  {
    path: '/terms',
    title: 'Terms of Service | FLEET',
    description: 'The terms for using FLEET by Vector Brain, including acceptable use, your AI provider keys and the limits of the service.',
    label: 'Terms of service',
    priority: 0.3,
    changefreq: 'yearly',
    kind: 'legal',
  },
];

export const pageFor = (path: string) => PUBLIC_PAGES.find((p) => p.path === path);

export const absolute = (path: string) => `${SITE.origin}${path === '/' ? '/' : path}`;

/** Breadcrumb trail for a page: Home › parents › page. */
export function crumbsFor(page: PublicPage): Crumb[] {
  if (page.path === '/') return [];
  const trail: Crumb[] = [{ name: 'Home', path: '/' }];
  for (const p of page.parents ?? []) if (p.path !== page.path) trail.push(p);
  trail.push({ name: page.label, path: page.path });
  return trail;
}

/** Footer link map, grouped. Every public page is reachable from every other. */
export const FOOTER_GROUPS: { title: string; links: Crumb[] }[] = [
  {
    title: 'Product',
    links: [
      { name: 'How it works', path: '/how-it-works' },
      { name: 'Android fleet automation', path: '/android-fleet-automation' },
      { name: 'Phone farm automation', path: '/phone-farm-automation' },
      { name: 'Automation without root', path: '/android-automation-without-root' },
    ],
  },
  {
    title: 'Use cases',
    links: [
      { name: 'Mobile app testing', path: '/use-cases/mobile-app-testing' },
      { name: 'Install apps on many phones', path: '/use-cases/install-apps-on-many-phones' },
      { name: 'Geo testing', path: '/use-cases/geo-testing' },
      { name: 'FLEET vs Appium', path: '/compare/appium' },
      { name: 'Own phones vs device farms', path: '/compare/cloud-device-farms' },
      { name: 'AI Android automation tools', path: '/compare/ai-android-automation-tools' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { name: 'Documentation', path: '/docs' },
      { name: 'llms.txt', path: '/llms.txt' },
    ],
  },
  {
    title: 'Company',
    links: [
      { name: 'Contact', path: '/contact' },
      { name: 'Privacy', path: '/privacy' },
      { name: 'Terms', path: '/terms' },
    ],
  },
];
