import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from '../eko/AndroidAgent';
import {
  domainOf,
  lessonNote,
  lessonsFor,
  normalUrl,
  parseLessons,
  provenLessons,
  sameLesson,
  scopeWord,
  scopesInText,
  scoreLesson,
  unsafeText,
  type AgentLesson,
  type RunStep,
} from './experience';

const step = (index: number, tool: string, args: Record<string, unknown>, result: string, packageAfter = 'com.android.chrome'): RunStep => ({ index, tool, args, ok: true, result, packageAfter });

describe('experience memory: places', () => {
  it('reads domains and app words', () => {
    expect(domainOf('https://www.blogger.com/blog/posts/1')).toBe('blogger.com');
    expect(domainOf('blogger.com')).toBe('blogger.com');
    expect(domainOf('not a url')).toBeNull();
    expect(normalUrl('https://www.blogger.com/blog/create/?x=1')).toBe('blogger.com/blog/create');
    expect(scopeWord('com.instagram.android')).toBe('instagram');
    expect(scopeWord('blogger.com')).toBe('blogger');
    expect(scopesInText('Open blogger.com and make a blog, then share on Instagram. Mail me at a@b.com', ['com.instagram.android', 'youtube.com']).sort()).toEqual(['blogger.com', 'com.instagram.android']);
  });
});

describe('experience memory: learning', () => {
  it('a page that said "not found" becomes a trusted avoid lesson, once', () => {
    const steps = [
      step(1, 'open_url', { url: 'https://www.blogger.com/' }, 'Action succeeded: Opened https://www.blogger.com/'),
      step(2, 'open_url', { url: 'https://www.blogger.com/blog/create' }, "Action succeeded: Opened https://www.blogger.com/blog/create\nUPDATED SCREEN ELEMENTS:\n0|text|We can't locate your page||500,400"),
      step(3, 'open_url', { url: 'https://blogger.com/blog/create/' }, "Opened https://blogger.com/blog/create/ … We can't locate your page"),
    ];
    const proven = provenLessons(steps);
    expect(proven).toHaveLength(1);
    expect(proven[0]).toMatchObject({ scope: 'blogger.com', kind: 'avoid', avoidUrl: 'blogger.com/blog/create' });
  });

  it('keeps only well formed, safe lessons about places the run went', () => {
    const run = { domains: new Set(['blogger.com']), apps: new Set<string>(), succeeded: false };
    const raw = `Here: {"lessons":[
      {"scope":"blogger.com","kind":"widget","text":"The EU notice closes with Cancel notification button."},
      {"scope":"www.blogger.com","kind":"path","text":"New blog: Main menu, blog name dropdown, New Blog..."},
      {"scope":"youtube.com","kind":"behave","text":"Ads show before every video on this site"},
      {"scope":"blogger.com","kind":"behave","text":"Sign in with lucy@gmail.com and password abc123"},
      {"scope":"blogger.com","kind":"field","text":"Tap idx 7 for the title"}
    ]}`;
    const lessons = parseLessons(raw, run);
    expect(lessons).toEqual([{ scope: 'blogger.com', kind: 'widget', text: 'The EU notice closes with Cancel notification button.' }]);
    // A path is only learned from a run that succeeded.
    expect(parseLessons(raw, { ...run, succeeded: true }).map((l) => l.kind)).toEqual(['widget', 'path']);
    // Two at most per run.
    const many = `{"lessons":[${Array.from({ length: 5 }, (_, i) => `{"scope":"blogger.com","kind":"widget","text":"Lesson number ${'abcde'[i]} about the post editor toolbar"}`).join(',')}]}`;
    expect(parseLessons(many, run)).toHaveLength(2);
    expect(parseLessons('no json', run)).toEqual([]);
  });

  it('merges the same lesson and scores by how runs end', () => {
    expect(sameLesson({ scope: 'blogger.com', kind: 'path', text: 'New blog: Main menu → blog name dropdown → New Blog...' }, { scope: 'blogger.com', kind: 'path', text: 'New blog is in Main menu, blog name dropdown, then New Blog...' })).toBe(true);
    // The same lesson under another type is still the same lesson (Oct 13: one Reels note saved twice).
    expect(sameLesson({ scope: 'instagram', kind: 'avoid', text: 'Swiping UP in the Reels feed does not advance to the next reel; the list stays on the same item' }, { scope: 'instagram', kind: 'behave', text: 'Swiping UP in the Reels feed does nothing — the reel stays on the same item, so it cannot advance to the next reel' })).toBe(true);
    expect(sameLesson({ scope: 'blogger.com', kind: 'path', text: 'New blog: Main menu → dropdown' }, { scope: 'medium.com', kind: 'path', text: 'New blog: Main menu → dropdown' })).toBe(false);
    let l = { status: 'candidate' as const, helped: 0, hurt: 0, source: 'auto' };
    let next = scoreLesson(l, true);
    next = scoreLesson({ ...l, ...next }, true);
    expect(next.status).toBe('trusted');
    l = { status: 'candidate', helped: 0, hurt: 2, source: 'auto' };
    expect(scoreLesson(l, false).status).toBe('off');
    expect(scoreLesson({ ...l, source: 'user', status: 'candidate' }, false).status).toBe('candidate');
    expect(unsafeText('code 482913')).toBe(true);
    expect(unsafeText('Title is the top input (2026 layout)')).toBe(false);
  });
});

describe('experience memory: what the agent sees', () => {
  const lessons: AgentLesson[] = [
    { id: 1, scope: 'blogger.com', kind: 'path', text: 'New blog: Main menu → blog name dropdown → New Blog...', status: 'trusted' },
    { id: 2, scope: 'blogger.com', kind: 'avoid', text: 'blogger.com/blog/create does not exist (page not found).', status: 'trusted', avoidUrl: 'blogger.com/blog/create' },
    { id: 3, scope: 'blogger.com', kind: 'behave', text: 'The name dialog arrives a second after the keyboard.', status: 'candidate' },
    { id: 4, scope: 'youtube.com', kind: 'path', text: 'Search with youtube.com/results?search_query=…', status: 'trusted' },
    { id: 5, scope: 'blogger.com', kind: 'field', text: 'Off lesson', status: 'off' },
  ];

  it('picks trusted first, never off ones, and writes a short note', () => {
    const picked = lessonsFor(lessons, ['blogger.com']);
    expect(picked.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(lessonNote('blogger.com', picked)).toMatch(/^EXPERIENCE on blogger\.com.*\n- \[way\] New blog.*\n- \[avoid\].*\n- \[note, unconfirmed\]/s);
  });

  let n = 0;
  const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
    const { box, ...rest } = over;
    return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
  };

  it('the first result carries the lessons of the site the task names; a dead address is refused', async () => {
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'ObserveScreen') {
        return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: node({ box: [0, 0, 1080, 2400], children: [node({ text: 'blogger.com/blog/posts', editable: true, clickable: true, box: [100, 50, 900, 150] }), node({ contentDescription: 'Main menu', clickable: true, box: [0, 200, 120, 300] })] }) } };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw', undefined, { task: 'Create a new blog on blogger.com', experience: lessons });
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    };
    const first = await run('read_ui_tree');
    expect(first.text).toMatch(/EXPERIENCE on blogger\.com/);
    expect(first.text).not.toMatch(/youtube/);
    // Shown once per site.
    expect((await run('read_ui_tree')).text).not.toMatch(/EXPERIENCE/);
    const dead = await run('open_url', { url: 'https://www.blogger.com/blog/create' });
    expect(dead.isError).toBe(true);
    expect(dead.text).toMatch(/does not exist.*Menus on this screen you have not opened yet: "Main menu"/s);
    expect(exec.mock.calls.some(([, a]) => a.type === 'OpenUrl')).toBe(false);
    expect(agent.experienceUsed().sort()).toEqual([1, 2, 3]);
  });
});

import { irreversibleWarning } from '../agent/irreversible';
describe('tasks that cannot be taken back wait for Confirm with a warning, never a refusal', () => {
  it('names what happens', () => {
    expect(irreversibleWarning('Switch off all phones')).toMatch(/^POWER OFF/);
    expect(irreversibleWarning('power off the phone')).toMatch(/^POWER OFF/);
    expect(irreversibleWarning('turn off wifi')).toBeNull();
    expect(irreversibleWarning('turn off the screen')).toBeNull();
    expect(irreversibleWarning('factory reset the phone')).toMatch(/^FACTORY RESET/);
    expect(irreversibleWarning('uninstall TikTok')).toMatch(/cannot be undone/);
    expect(irreversibleWarning('like 5 reels')).toBeNull();
  });
});
