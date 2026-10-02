import { addSight, emptyRunSight, runSightLine, sightCapability, sightOfResult, type SightWhy } from './screenSight';

const text = (t: string) => ({ type: 'text', text: t });
const image = { type: 'image' };

describe('screen sight', () => {
  it('an image counts as seen only when the model reads images', () => {
    const state = { vision: true, grounder: false, screenshots: 'stuck' as const, hasFrame: true };
    expect(sightOfResult({ content: [text('ok'), image] }, state)).toEqual({ seen: 'ai' });
    expect(sightOfResult({ content: [text('ok'), image] }, { ...state, vision: false })).toEqual({ seen: 'none', why: 'model_text_only' });
  });

  it('rows read by the vision helper count as the helper', () => {
    const state = { vision: false, grounder: true, screenshots: 'stuck' as const, hasFrame: true };
    const res = { content: [text('NOTE: this screen exposes little to the element list. Rows v1, v2… were read from a screenshot by a vision model — tap them')] };
    expect(sightOfResult(res, state)).toEqual({ seen: 'helper' });
  });

  it('says why no image went: text-only model, setting off, no frame, only when stuck', () => {
    type State = { vision: boolean; grounder: boolean; screenshots: 'off' | 'stuck' | 'every_step'; hasFrame: boolean };
    const base: State = { vision: true, grounder: false, screenshots: 'stuck', hasFrame: true };
    const none = (s: Partial<State>) => sightOfResult({ content: [text('ok')] }, { ...base, ...s }).why;
    // Runs 2634/2635: deepseek-v4-flash, no helper, "every step" on.
    expect(none({ vision: false, screenshots: 'every_step' })).toBe('model_text_only');
    expect(none({ screenshots: 'off' })).toBe('setting_off');
    expect(none({ hasFrame: false })).toBe('no_frame');
    expect(none({})).toBe('setting_stuck');
  });

  it('a run line says how many the AI saw, or plainly why none', () => {
    const blind = emptyRunSight('deepseek/deepseek-v4-flash-0731', false, null);
    const whys = new Map<SightWhy, number>();
    for (let i = 0; i < 5; i += 1) addSight(blind, { seen: 'none', why: 'model_text_only' }, whys);
    expect(runSightLine(blind)).toBe("0 screenshots seen — deepseek-v4-flash-0731 can't see images and no vision helper is set.");

    const seeing = emptyRunSight('qwen/qwen3-vl', true, null);
    const w2 = new Map<SightWhy, number>();
    for (let i = 0; i < 6; i += 1) addSight(seeing, { seen: 'ai' }, w2);
    addSight(seeing, { seen: 'none', why: 'setting_stuck' }, w2);
    expect(runSightLine(seeing)).toBe('AI saw 6 screenshots.');
    expect(seeing.why).toBe('setting_stuck');

    const helped = emptyRunSight('deepseek/deepseek-v4-flash-0731', false, 'qwen-vl');
    addSight(helped, { seen: 'helper' }, new Map());
    expect(runSightLine(helped)).toBe('The vision helper read 1 screenshot for deepseek-v4-flash-0731.');
    expect(runSightLine(null)).toBeNull();
  });

  it('before a run: sees, helper or blind', () => {
    expect(sightCapability(true, false)).toBe('sees');
    expect(sightCapability(false, true)).toBe('helper');
    expect(sightCapability(false, false)).toBe('blind');
  });
});
