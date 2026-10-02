/**
 * Checks a package name against the public Play Store web pages, from the
 * server, before the phone spends a minute on a page that does not exist.
 * Models often guess a package ("com.openai.chat" for ChatGPT); the details
 * page answers 404 for those, and a search by the app's name lists the real
 * one. Any network trouble returns null, and install_app behaves as before.
 */

const TIMEOUT_MS = 6000;
const CACHE_MS = 24 * 60 * 60_000;
const exists = new Map<string, { at: number; value: boolean }>();
const searches = new Map<string, { at: number; value: string[] }>();

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;
let fetcher: Fetch = (url, init) => fetch(url, init);

/** Tests swap the network out. */
export function setPlayFetch(f: Fetch | null): void {
  fetcher = f ?? ((url, init) => fetch(url, init));
  exists.clear();
  searches.clear();
}

const HEADERS = { 'accept-language': 'en', 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' };

/** true: the Play Store has this package. false: it answers 404. null: could not tell. */
export async function playPackageExists(packageName: string): Promise<boolean | null> {
  const hit = exists.get(packageName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const res = await fetcher(`https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS });
    const value = res.status === 200 ? true : res.status === 404 ? false : null;
    if (value !== null) exists.set(packageName, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

/** Package names a Play Store search for this name lists, in the store's order (at most 5). */
export async function searchPlayPackages(query: string): Promise<string[]> {
  const q = query.trim().replace(/^"|"$/g, '');
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = searches.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const res = await fetcher(`https://play.google.com/store/search?q=${encodeURIComponent(q)}&c=apps&hl=en`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS });
    if (res.status !== 200) return [];
    const html = await res.text();
    const found: string[] = [];
    for (const m of html.matchAll(/details\?id=([A-Za-z][\w]*(?:\.[\w]+)+)/g)) {
      if (!found.includes(m[1])) found.push(m[1]);
      if (found.length >= 5) break;
    }
    searches.set(key, { at: Date.now(), value: found });
    return found;
  } catch {
    return [];
  }
}

/**
 * The line install_app returns for a package the Play Store does not have:
 * what a search for the app's name found, so the next call uses the real one.
 */
export async function wrongPackageHint(packageName: string, appName: string): Promise<string | null> {
  if ((await playPackageExists(packageName)) !== false) return null;
  const name = appName && appName !== packageName ? appName.replace(/^"|"$/g, '') : packageName.split('.').pop() ?? packageName;
  const found = (await searchPlayPackages(name)).filter((p) => p !== packageName);
  return found.length
    ? `The Play Store has no app with the package "${packageName}" — that name is wrong. A Play Store search for "${name}" lists: ${found.join(', ')}. The first is usually the app; call install_app again with the right package.`
    : `The Play Store has no app with the package "${packageName}" — that name is wrong. Find the real package name (search the Play Store for "${name}"), then call install_app again.`;
}
