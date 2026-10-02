import { playPackageExists, searchPlayPackages, setPlayFetch, wrongPackageHint } from './playStoreLookup';

/** A stand-in Play Store: details pages for the packages it knows, a fixed search page. */
function fakeStore(known: string[], searchHtml: string) {
  const calls: string[] = [];
  setPlayFetch(async (url) => {
    calls.push(url);
    const id = /details\?id=([^&]+)/.exec(url)?.[1];
    if (id) return { status: known.includes(decodeURIComponent(id)) ? 200 : 404, text: async () => '' };
    return { status: 200, text: async () => searchHtml };
  });
  return calls;
}

const SEARCH = '<a href="/store/apps/details?id=com.openai.chatgpt">ChatGPT</a><a href="/store/apps/details?id=com.openai.chatgpt">x</a><a href="/store/apps/details?id=com.microsoft.copilot">Copilot</a>';

afterEach(() => setPlayFetch(null));

describe('Play Store package check', () => {
  it('catches a guessed package and names the real one from a search (run 2622/2626: com.openai.chat)', async () => {
    fakeStore(['com.openai.chatgpt'], SEARCH);
    const hint = await wrongPackageHint('com.openai.chat', '"ChatGPT"');
    expect(hint).toMatch(/no app with the package "com\.openai\.chat"/);
    expect(hint).toMatch(/search for "ChatGPT" lists: com\.openai\.chatgpt, com\.microsoft\.copilot/);
  });

  it('says nothing for a real package, and caches the answer', async () => {
    const calls = fakeStore(['com.openai.chatgpt'], SEARCH);
    expect(await wrongPackageHint('com.openai.chatgpt', 'ChatGPT')).toBeNull();
    expect(await playPackageExists('com.openai.chatgpt')).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('stays out of the way when the Play Store cannot be reached', async () => {
    setPlayFetch(async () => {
      throw new Error('network down');
    });
    expect(await playPackageExists('com.whatsapp')).toBeNull();
    expect(await wrongPackageHint('com.whatsapp', 'WhatsApp')).toBeNull();
    expect(await searchPlayPackages('WhatsApp')).toEqual([]);
  });

  it('treats other answers (rate limits, 5xx) as unknown, not as a wrong package', async () => {
    setPlayFetch(async () => ({ status: 429, text: async () => '' }));
    expect(await playPackageExists('com.whatsapp')).toBeNull();
  });
});
