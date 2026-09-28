import { isOscillating } from './oscillation';

describe('isOscillating', () => {
  const abab = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? 'B' : 'A'));

  it('catches a run bouncing between two steps', () => {
    expect(isOscillating(abab(12), 12)).toBe(true);
    expect(isOscillating(['X', 'Y', ...abab(12)], 12)).toBe(true);
  });

  it('leaves real progress alone', () => {
    expect(isOscillating(abab(11), 12)).toBe(false);
    expect(isOscillating([...abab(11), 'C'], 12)).toBe(false);
    expect(isOscillating(['A', 'A', ...abab(10)], 12)).toBe(false);
    expect(isOscillating(Array.from({ length: 12 }, (_, i) => `S${i}`), 12)).toBe(false);
  });
});
