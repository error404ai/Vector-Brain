import { cachedRules, numbersIn, parseRules, rulesBlock, rulesCountChecks, rulesProgress } from './taskRules';

const tally = (o: Partial<{ openUrl: number; scrolls: number; changes: { from: string; to: string }[] }> = {}) => ({ openUrl: 0, scrolls: 0, changes: [], ...o });

describe('task rule list', () => {
  it('reads numbers as digits, English and Hinglish words (not "do")', () => {
    expect([...numbersIn('visit 10 sites, like five posts, teen comment karo, do it')].sort((a, b) => a - b)).toEqual([3, 5, 10]);
  });

  it('keeps only counts the user wrote, and code-checked kinds only where the prompt says so', () => {
    const goal = 'open 3 apps and like 5 reels, then comment on 2';
    const r = parseRules(
      JSON.stringify({
        parts: ['three apps opened', '5 reels liked', '2 comments posted'],
        counts: [
          { kind: 'pages', n: 3, what: 'apps opened' }, // no site words in the goal → judged, not code-failed
          { kind: 'button', verb: 'Like', n: 5, what: 'reels liked' },
          { kind: 'other', n: 2, what: 'comments' },
          { kind: 'scrolls', n: 20, what: 'reels scrolled' }, // 20 was never written
        ],
        proof: 'the last comment shows',
        avoid: ['follow anyone'],
        report: null,
      }),
      goal,
    )!;
    expect(r.counts).toEqual([
      { kind: 'other', n: 3, what: 'apps opened' },
      { kind: 'button', verb: 'like', n: 5, what: 'reels liked' },
      { kind: 'other', n: 2, what: 'comments' },
    ]);
    expect(rulesBlock(r)).toMatch(/^RULES FOR THIS TASK[^\n]*\n1\. three apps opened\n2\. 5 reels liked\n3\. 2 comments posted\nCOUNTS: apps opened × 3; reels liked × 5; comments × 2\nDONE WHEN: the last comment shows\nDO NOT: follow anyone$/);
  });

  it('no parts or no JSON → no list', () => {
    expect(parseRules('{"parts":[],"counts":[]}', 'x')).toBeNull();
    expect(parseRules('I cannot', 'x')).toBeNull();
    expect(parseRules('```json\n{"parts":["a"]}\n```', 'x')).toMatchObject({ parts: ['a'], counts: [], avoid: [], proof: null, report: null });
  });

  it('counts: pages and scrolls short fail, buttons are evidence only', () => {
    const r = parseRules('{"parts":["x"],"counts":[{"kind":"pages","n":10,"what":"sites"},{"kind":"button","verb":"follow","n":2,"what":"follows"}]}', 'visit 10 websites and follow 2 people')!;
    expect(rulesCountChecks(r, tally({ openUrl: 7 }))).toEqual({ short: ['pages opened (open_url): 7 of 10'], met: [] });
    const t = tally({ openUrl: 10, changes: [{ from: 'Follow', to: 'Following' }, { from: 'Follow', to: 'Following' }] });
    expect(rulesCountChecks(r, t)).toEqual({ short: [], met: ['pages opened (open_url): 10 of 10', '"follow" buttons changed by taps: 2 of 2'] });
    expect(rulesProgress(r, tally({ openUrl: 4 }))).toBe('sites: 4 of 10; follows: 0 of 2');
  });

  it('one call per prompt, shared; a failed one is asked again', async () => {
    let made = 0;
    const make = async () => (++made === 1 ? null : { parts: ['a'], counts: [], proof: null, avoid: [], report: null });
    expect(await cachedRules('p  x', make, 1).rules).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    const second = cachedRules('p x', make, 2);
    const third = cachedRules('p x', make, 3);
    expect(second.fresh).toBe(true);
    expect(third.fresh).toBe(false);
    expect(await third.rules).toEqual({ parts: ['a'], counts: [], proof: null, avoid: [], report: null });
    expect(made).toBe(2);
  });
});
