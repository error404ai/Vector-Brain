import { AndroidAgent } from './AndroidAgent';

/** A thin screen (a web page loading): two labelled rows. */
const thinScreen = {
  size: { width: 1080, height: 2400 },
  labelledCount: 2,
  elements: [
    { idx: '0', type: 'view', label: 'Page', tappable: false, editable: false, disabled: false, px: { x: 1, y: 1 }, grid: { x: 1, y: 1 }, box: { left: 0, top: 0, right: 2, bottom: 2 } },
    { idx: '1', type: 'input', label: 'Address', tappable: true, editable: true, disabled: false, px: { x: 5, y: 5 }, grid: { x: 5, y: 5 }, box: { left: 4, top: 4, right: 6, bottom: 6 } },
  ],
};

type Extras = { note: string; image?: string };
const extrasFor = async (screenshots: 'off' | 'stuck' | 'every_step', stuck: 'loop' | 'no_effect' | null): Promise<Extras> => {
  const agent = new AndroidAgent({} as never, 'hw', undefined, { vision: true, screenshots });
  Object.assign(agent as unknown as Record<string, unknown>, { screen: thinScreen, lastUiTree: 'x', lastForegroundApp: 'com.android.chrome' });
  return (agent as unknown as { screenExtras: (shot?: string, stuck?: 'loop' | 'no_effect' | null) => Promise<Extras> }).screenExtras('SHOT', stuck);
};

describe('screenshots to the AI follow the setting', () => {
  it('off: never an image, stuck or not', async () => {
    expect((await extrasFor('off', null)).image).toBeUndefined();
    expect((await extrasFor('off', 'no_effect')).image).toBeUndefined();
  });

  it('when stuck: no image on a thin screen alone, an image once it is stuck', async () => {
    const thin = await extrasFor('stuck', null);
    expect(thin.image).toBeUndefined();
    expect(thin.note).toContain('If you get stuck, you will be shown a screenshot');
    expect((await extrasFor('stuck', 'no_effect')).image).toBe('SHOT');
    expect((await extrasFor('stuck', 'loop')).image).toBe('SHOT');
  });

  it('every step: the thin screen is shown too', async () => {
    expect((await extrasFor('every_step', null)).image).toBe('SHOT');
  });
});
