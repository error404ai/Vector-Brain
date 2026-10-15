import type { UiNodeSnapshot } from '../AndroidProtocol';
import { lessonsToScore } from '../experience/experience';
import { AndroidAgent, pageKey } from './AndroidAgent';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};

type Tools = { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };

function phone(task: string, failOpen = () => false) {
  let page = 0;
  const exec = jest.fn(async (_hw: string, action: Record<string, unknown>) => {
    if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') {
      const root = node({ box: [0, 0, 1080, 2400], children: [node({ text: `Posts ${page}`, clickable: true, box: [40, 400, 1040, 520] }), node({ contentDescription: 'Main menu', clickable: true, box: [0, 100, 120, 240] })] });
      return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root } };
    }
    if (action.type === 'OpenUrl') {
      if (failOpen()) return { status: 'FAILURE', code: 'INTERNAL_ERROR', message: 'could not open' };
      page += 1;
    }
    return { status: 'SUCCESS', summary: `${String(action.type)} done` };
  });
  const gateway = { executeAction: exec, hasFeature: () => false };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, { task, screenshots: 'off' } as never);
  const tools = (agent as unknown as Tools).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  const opens = () => exec.mock.calls.filter(([, a]) => a.type === 'OpenUrl').length;
  return { run, opens };
}

describe('the same address a third time', () => {
  it('is refused, with what to do instead; other addresses still open', async () => {
    const p = phone('create a new blog on blogger.com');
    expect((await p.run('open_url', { url: 'https://www.blogger.com/' })).isError).toBe(false);
    expect((await p.run('open_url', { url: 'https://www.blogger.com/home' })).isError).toBe(false);
    expect((await p.run('open_url', { url: 'blogger.com' })).isError).toBe(false);
    const third = await p.run('open_url', { url: 'https://blogger.com/#top' });
    expect(third.isError).toBe(true);
    expect(third.text).toMatch(/^Not opened: you have already opened .* twice in this run, and it has not got you there/);
    expect(third.text).toMatch(/STUCK/);
    expect(p.opens()).toBe(3);
    expect((await p.run('open_url', { url: 'https://www.blogger.com/blog/posts' })).isError).toBe(false);
  }, 20_000);

  it('two searches are two pages', async () => {
    const p = phone('search amazon for three things');
    for (const q of ['a', 'b', 'c', 'd']) expect((await p.run('open_url', { url: `https://www.amazon.in/s?k=${q}` })).isError).toBe(false);
  }, 20_000);

  it('a task that asks for repeats, and opens that failed, do not count', async () => {
    const again = phone('open example.com 5 times');
    for (let i = 0; i < 4; i++) expect((await again.run('open_url', { url: 'https://example.com' })).isError).toBe(false);
    let fail = true;
    const flaky = phone('open example.com', () => fail);
    await flaky.run('open_url', { url: 'https://example.com' });
    await flaky.run('open_url', { url: 'https://example.com' });
    fail = false;
    expect((await flaky.run('open_url', { url: 'https://example.com' })).isError).toBe(false);
  }, 30_000);

  it('pageKey', () => {
    expect(pageKey('HTTPS://www.Blogger.com/')).toBe('blogger.com');
    expect(pageKey('https://m.example.com/a/?q=1#x')).toBe('example.com/a?q=1');
  });
});

describe('which lessons take a run\'s outcome', () => {
  const trusted = { id: 1, status: 'trusted' as const };
  const trusted2 = { id: 2, status: 'trusted' as const };
  const candidate = { id: 3, status: 'candidate' as const };

  it('a success counts for all', () => {
    expect(lessonsToScore([trusted, candidate], 'succeeded')).toEqual([trusted, candidate]);
  });
  it("a failure that was not the agent's counts for none", () => {
    expect(lessonsToScore([trusted, candidate], 'not_counted')).toEqual([]);
  });
  it("the agent's failure: the unconfirmed lessons when there are any, else all", () => {
    expect(lessonsToScore([trusted, trusted2, candidate], 'agent_failed')).toEqual([candidate]);
    expect(lessonsToScore([trusted, trusted2], 'agent_failed')).toEqual([trusted, trusted2]);
  });
});
