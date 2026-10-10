jest.mock('@/loaders/database', () => ({ AppDataSource: { getRepository: () => ({}) } }));
import { DiagnosticsSyncService } from './DiagnosticsSyncService';

describe('diagnostics reach GitHub soon after runs finish', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.DIAG_GITHUB_REPO = 'owner/diag';
    process.env.DIAG_GITHUB_TOKEN = 't';
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.DIAG_GITHUB_REPO;
    delete process.env.DIAG_GITHUB_TOKEN;
  });

  it('pushes once things go quiet, not once per run', () => {
    const sync = new DiagnosticsSyncService({} as never);
    const push = jest.spyOn(sync, 'syncNow').mockResolvedValue({} as never);
    for (let i = 0; i < 15; i += 1) {
      sync.afterRun();
      jest.advanceTimersByTime(10_000);
    }
    expect(push).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2 * 60 * 1000);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('does not wait forever while runs keep finishing', () => {
    const sync = new DiagnosticsSyncService({} as never);
    const push = jest.spyOn(sync, 'syncNow').mockResolvedValue({} as never);
    for (let i = 0; i < 20; i += 1) {
      sync.afterRun();
      jest.advanceTimersByTime(60_000);
    }
    expect(push).toHaveBeenCalled();
  });

  it('does nothing when GitHub is not set up', () => {
    delete process.env.DIAG_GITHUB_REPO;
    const sync = new DiagnosticsSyncService({} as never);
    const push = jest.spyOn(sync, 'syncNow').mockResolvedValue({} as never);
    sync.afterRun();
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(push).not.toHaveBeenCalled();
  });
});
