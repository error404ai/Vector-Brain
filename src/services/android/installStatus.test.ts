import { acceptsInstallStage, normalizeInstallReport } from './installStatus';

describe('normalizeInstallReport', () => {
  it('accepts a known stage and trims the message', () => {
    expect(normalizeInstallReport({ stage: 'waiting_tap', message: '  tap it  ' })).toEqual({ stage: 'waiting_tap', message: 'tap it' });
  });

  it('rejects unknown stages and bodies that are not objects', () => {
    expect(normalizeInstallReport({ stage: 'exploded' })).toBeNull();
    expect(normalizeInstallReport(null)).toBeNull();
    expect(normalizeInstallReport('installed')).toBeNull();
  });

  it('caps the message at 500 characters and turns blank into null', () => {
    expect(normalizeInstallReport({ stage: 'failed', message: 'x'.repeat(900) })?.message).toHaveLength(500);
    expect(normalizeInstallReport({ stage: 'failed', message: '   ' })?.message).toBeNull();
  });
});

describe('acceptsInstallStage', () => {
  it('lets progress move forward', () => {
    expect(acceptsInstallStage(null, 'received')).toBe(true);
    expect(acceptsInstallStage('waiting_tap', 'installed')).toBe(true);
    expect(acceptsInstallStage('failed', 'waiting_tap')).toBe(true);
  });

  it('never lets a late report undo an installed update', () => {
    expect(acceptsInstallStage('installed', 'waiting_tap')).toBe(false);
    expect(acceptsInstallStage('installed', 'failed')).toBe(false);
    expect(acceptsInstallStage('installed', 'installed')).toBe(true);
    expect(acceptsInstallStage('not_newer', 'installing')).toBe(false);
  });
});
