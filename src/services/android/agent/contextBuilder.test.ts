import { buildContext, estimateTokens, type StepRecord } from './contextBuilder';
import { appNamedIn, parseAppList, parseVerdict, ruleFor } from './successVerifier';

const screen = (n: number) => `Action succeeded: step ${n}\n\nUPDATED SCREEN ELEMENTS:\nidx|type|label|flags|tap_at\n${`0|btn|Button ${n}|t|1,1\n`.repeat(40)}`;
const step = (n: number, extra: Partial<StepRecord> = {}): StepRecord => ({
  callId: `v${n}`,
  toolName: 'tap_coordinate',
  input: { x: n, y: n },
  thought: `thinking about step ${n} `.repeat(20),
  resultText: screen(n),
  isError: false,
  ...extra,
});

describe('buildContext', () => {
  it('keeps recent steps in full within the budget and summarises the rest in one line each', () => {
    const steps = Array.from({ length: 30 }, (_, i) => step(i + 1));
    const built = buildContext({ task: 'do it', steps, budgetTokens: 1500, minRecent: 3, vision: false });
    expect(built.fullSteps).toBeGreaterThanOrEqual(3);
    expect(built.fullSteps + built.summarisedSteps).toBe(30);
    const intro = built.messages[0].content as string;
    expect(intro).toContain('STEPS ALREADY DONE');
    expect(intro).toContain('1. tap_coordinate');
    // Only the newest screen is sent in full.
    const text = JSON.stringify(built.messages);
    expect(text).toContain('Button 30');
    expect(text).not.toContain('Button 29|');
  });

  it('always keeps the minimum number of recent steps even over budget', () => {
    const steps = Array.from({ length: 5 }, (_, i) => step(i + 1));
    const built = buildContext({ task: 't', steps, budgetTokens: 10, minRecent: 3, vision: false });
    expect(built.fullSteps).toBe(3);
  });

  it('grows with the budget, not with a fixed step count', () => {
    const steps = Array.from({ length: 40 }, (_, i) => step(i + 1));
    const small = buildContext({ task: 't', steps, budgetTokens: 1000, minRecent: 3, vision: false });
    const large = buildContext({ task: 't', steps, budgetTokens: 8000, minRecent: 3, vision: false });
    expect(large.fullSteps).toBeGreaterThan(small.fullSteps);
  });

  it('sends a screenshot only to a vision model and only from the latest step', () => {
    const steps = [step(1, { image: { data: 'OLDIMG', mediaType: 'image/jpeg' } }), step(2, { image: { data: 'NEWIMG', mediaType: 'image/jpeg' } })];
    expect(JSON.stringify(buildContext({ task: 't', steps, budgetTokens: 5000, minRecent: 3, vision: true }).messages)).toContain('NEWIMG');
    expect(JSON.stringify(buildContext({ task: 't', steps, budgetTokens: 5000, minRecent: 3, vision: true }).messages)).not.toContain('OLDIMG');
    expect(JSON.stringify(buildContext({ task: 't', steps, budgetTokens: 5000, minRecent: 3, vision: false }).messages)).not.toContain('IMG');
  });

  it('estimates tokens at about four characters each', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('successVerifier helpers', () => {
  const apps = parseAppList('Installed apps (3):\nYouTube | com.google.android.youtube\nYouTube Music | com.google.android.apps.youtube.music\nChrome | com.android.chrome');

  it('reads the launcher list and picks the longest app name in the goal', () => {
    expect(apps).toHaveLength(3);
    expect(appNamedIn('open youtube music', apps)?.packageName).toBe('com.google.android.apps.youtube.music');
    expect(appNamedIn('open YouTube', apps)?.packageName).toBe('com.google.android.youtube');
    expect(appNamedIn('open the settings', apps)).toBeNull();
  });

  it('applies a rule only when the whole task is one open or close', () => {
    expect(ruleFor('Open YouTube')).toBe('open');
    expect(ruleFor('youtube kholo')).toBe('open');
    expect(ruleFor("Stop the YouTube app — close it if it's open")).toBe('close');
    expect(ruleFor('Close the Reddit app completely (swipe it away from recent apps or force stop it)')).toBe('close');
    expect(ruleFor('Open YouTube and play lofi music')).toBeNull();
    expect(ruleFor('open chrome, search news')).toBeNull();
    expect(ruleFor('Search Google for phonebox')).toBeNull();
  });

  it('never reads closing tabs or popups as closing the app', () => {
    // Real runs 2250, 2254 and 2256 were done right and failed this rule.
    expect(ruleFor('Open the Chrome browser and close all open tabs, leaving just one new tab open.')).toBeNull();
    expect(ruleFor('Open Chrome, close all Trustpilot tabs, then open google.co.uk.')).toBeNull();
    expect(ruleFor('Close the popup in Instagram')).toBeNull();
    expect(ruleFor('close chrome and open youtube')).toBeNull();
    // Closing the app as the last step still has its rule.
    expect(ruleFor('Open the Reddit app, wait for it to load, then close the Reddit app.')).toBe('close');
    expect(ruleFor('reddit band karo')).toBe('close');
  });

  it('reads the judge verdict defensively', () => {
    expect(parseVerdict('{"verdict":"no","reason":"login wall"}')).toEqual({ verdict: 'no', reason: 'login wall' });
    expect(parseVerdict('Sure! {"verdict":"yes","reason":"ok"}').verdict).toBe('yes');
    expect(parseVerdict('garbage').verdict).toBe('unsure');
  });
});
