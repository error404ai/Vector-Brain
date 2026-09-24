import fs from 'node:fs';
import path from 'node:path';

/**
 * The agent wasted 100+ steps swiping at a phone stuck on the lock screen.
 * The planner prompt must tell it to give up on unlocking fast, so this
 * guards that guidance stays present and stays firm about a step cap.
 */
describe('planner prompt handles the lock screen', () => {
  const text = fs.readFileSync(path.join(__dirname, 'AndroidPlannerService.ts'), 'utf8');

  it('mentions the lock screen and a swipe-up-once rule', () => {
    expect(text.toLowerCase()).toMatch(/lock screen|swipe up to unlock|locked/);
  });

  it('caps unlock attempts instead of retrying forever', () => {
    // Some phrase bounding the attempts must be there (once / one swipe / give up / 2-3).
    expect(text).toMatch(/only once|one swipe|give up|do not keep swiping|stop trying to unlock/i);
  });
});
