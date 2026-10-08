import { AndroidAgent } from '../eko/AndroidAgent';
import { SHORT_DESCRIPTIONS, compactTool, type ToolSpec } from './compactTools';
import { judgePrompt } from './successVerifier';

const tools = () => new AndroidAgent({} as never, 'x', undefined, { vision: true }).Tools as unknown as ToolSpec[];

describe('compact tools (Lite)', () => {
  it('has a short description for every agent tool', () => {
    const missing = tools().filter((t) => !SHORT_DESCRIPTIONS[t.name]).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('keeps every tool, parameter, type, enum and required field', () => {
    for (const t of tools()) {
      const c = compactTool(t);
      const props = (t.parameters as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
      const cprops = (c.parameters as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
      expect(Object.keys(cprops)).toEqual(Object.keys(props));
      for (const [k, v] of Object.entries(props)) {
        expect(cprops[k].type).toEqual(v.type);
        expect(cprops[k].enum).toEqual(v.enum);
      }
      expect((c.parameters as { required?: string[] }).required).toEqual((t.parameters as { required?: string[] }).required);
    }
  });

  it('sends about half the text', () => {
    const full = JSON.stringify(tools()).length;
    const short = JSON.stringify(tools().map(compactTool)).length;
    expect(short / full).toBeLessThan(0.55);
  });
});

describe('judge prompt', () => {
  it('includes the steps when given, so multi-action goals can be counted', () => {
    const p = judgePrompt('open 3 sites', 'done', { packageName: 'com.android.chrome', tree: 'x' }, ['1. open_url {"url":"a"} → ok', '2. open_url {"url":"b"} → ok']);
    expect(p).toContain('STEPS (2):');
    expect(p).toContain('2. open_url {"url":"b"} → ok');
    expect(judgePrompt('g', 's', { packageName: null, tree: 'x' })).not.toContain('STEPS');
  });
});
