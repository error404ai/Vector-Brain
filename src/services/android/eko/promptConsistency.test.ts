import fs from 'node:fs';
import path from 'node:path';

/**
 * The agent's instructions must agree with its tools. press_key ENTER exists
 * (Android 11+, companion v0.10.0 performs ACTION_IME_ENTER), so no prompt or
 * tool description may claim there is no way to press Enter.
 */
const files = [path.join(__dirname, 'AndroidAgent.ts'), path.join(__dirname, '..', 'AndroidPlannerService.ts')];
const contradictions = [/no way to press enter/i, /cannot submit the field/i, /never plan a node that says "?press enter/i];

describe('agent prompts agree with the press_key tool', () => {
  for (const file of files) {
    it(`${path.basename(file)} does not deny that Enter can be pressed`, () => {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of contradictions) expect(text).not.toMatch(pattern);
    });
  }

  it('type_text points to press_key ENTER for submitting', () => {
    const text = fs.readFileSync(files[0], 'utf8');
    const typeText = text.slice(text.indexOf("name: 'type_text'"), text.indexOf("name: 'type_text'") + 1200);
    expect(typeText).toMatch(/press_key/);
  });
});
