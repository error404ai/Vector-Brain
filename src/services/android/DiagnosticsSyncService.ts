import Logger from '@/logger/index';
import { PassThrough } from 'stream';
import { Service } from 'typedi';
import { createGzip } from 'zlib';
import { RunDiagnosticsService, runFinished } from './RunDiagnosticsService';

/** How often today's file is refreshed. */
const SYNC_EVERY_MS = 2 * 60 * 60 * 1000;
/** First sync shortly after boot, so a deploy does not wait two hours. */
const FIRST_SYNC_MS = 5 * 60 * 1000;
/**
 * After runs finish: push once things go quiet for this long (a mission's phones
 * finish within a minute or two of each other), but never wait longer than
 * AFTER_RUNS_MAX_MS while runs keep finishing, and never push more often than
 * MIN_GAP_MS. So a finished task is on GitHub within minutes, not hours.
 */
const AFTER_RUNS_QUIET_MS = 2 * 60 * 1000;
const AFTER_RUNS_MAX_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 3 * 60 * 1000;
/** GitHub's contents API refuses very large files; a day of runs is far below this. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;

export interface SyncState {
  configured: boolean;
  repo: string | null;
  branch: string;
  last_push_at: string | null;
  last_file: string | null;
  last_error: string | null;
}

/**
 * Pushes the sanitized run export to a private GitHub repository so it can be
 * analysed without anyone copying files by hand: a few minutes after runs
 * finish, and every two hours.
 *
 * Off unless DIAG_GITHUB_REPO ("owner/name") and DIAG_GITHUB_TOKEN are set.
 * The token should be fine-grained with "Contents: read and write" on that one
 * repository only. Files: runs/YYYY-MM-DD.jsonl.gz (UTC day, refreshed every
 * two hours while the day lasts) and summary-7d.json.
 */
@Service()
export class DiagnosticsSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private finalisedDays = new Set<string>();
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private lastSyncAt = 0;
  private state: SyncState = {
    configured: false,
    repo: null,
    branch: 'main',
    last_push_at: null,
    last_file: null,
    last_error: null,
  };

  constructor(private diagnostics: RunDiagnosticsService) {}

  private get repo(): string | null {
    const repo = (process.env.DIAG_GITHUB_REPO ?? '').trim();
    return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
  }

  private get token(): string | null {
    return (process.env.DIAG_GITHUB_TOKEN ?? '').trim() || null;
  }

  private get branch(): string {
    return (process.env.DIAG_GITHUB_BRANCH ?? '').trim() || 'main';
  }

  status(): SyncState {
    return { ...this.state, configured: Boolean(this.repo && this.token), repo: this.repo, branch: this.branch };
  }

  start(): void {
    if (this.timer) return;
    if (!this.repo || !this.token) {
      Logger.info('[DiagnosticsSync] Off (set DIAG_GITHUB_REPO and DIAG_GITHUB_TOKEN to enable)');
      return;
    }
    Logger.info(`[DiagnosticsSync] Pushing run diagnostics to ${this.repo} every ${SYNC_EVERY_MS / 3_600_000}h`);
    const first = setTimeout(() => void this.syncNow(), FIRST_SYNC_MS);
    first.unref?.();
    this.timer = setInterval(() => void this.syncNow(), SYNC_EVERY_MS);
    this.timer.unref?.();
    runFinished.on('finished', () => this.afterRun());
  }

  /** A run finished: push soon (see AFTER_RUNS_QUIET_MS). */
  afterRun(now = Date.now()): void {
    if (!this.repo || !this.token) return;
    if (!this.firstPendingAt) this.firstPendingAt = now;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    const waitedLongEnough = now - this.firstPendingAt >= AFTER_RUNS_MAX_MS;
    const delay = Math.max(waitedLongEnough ? 0 : AFTER_RUNS_QUIET_MS, this.lastSyncAt + MIN_GAP_MS - now);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.firstPendingAt = 0;
      void this.syncNow();
    }, delay);
    this.quietTimer.unref?.();
  }

  /** Refresh today's file, and yesterday's once after the day has ended. */
  async syncNow(): Promise<SyncState> {
    const repo = this.repo;
    const token = this.token;
    if (!repo || !token) {
      this.state.last_error = 'Not configured: set DIAG_GITHUB_REPO and DIAG_GITHUB_TOKEN on the server.';
      return this.status();
    }
    if (this.running) return this.status();
    this.running = true;
    this.lastSyncAt = Date.now();
    try {
      const today = startOfUtcDay(new Date());
      const yesterday = new Date(today.getTime() - 86_400_000);
      const yesterdayKey = dayKey(yesterday);
      if (!this.finalisedDays.has(yesterdayKey)) {
        await this.pushDay(repo, token, yesterday, today);
        this.finalisedDays.add(yesterdayKey);
      }
      await this.pushDay(repo, token, today, new Date());

      const summary = await this.diagnostics.summary(7);
      await this.putFile(repo, token, 'summary-7d.json', Buffer.from(JSON.stringify(summary.data, null, 2)), 'Run diagnostics: 7-day summary');
      this.state.last_error = null;
    } catch (error: any) {
      this.state.last_error = String(error?.message ?? error).slice(0, 300);
      Logger.warn('[DiagnosticsSync] Push failed:', error);
    } finally {
      this.running = false;
    }
    return this.status();
  }

  private async pushDay(repo: string, token: string, from: Date, to: Date): Promise<void> {
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    gzip.pipe(sink);
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      sink.on('end', resolve);
      sink.on('error', reject);
      gzip.on('error', reject);
    });
    const counts = await this.diagnostics.exportRuns(gzip, from, to);
    gzip.end();
    await done;
    if (counts.tasks === 0) return;
    const bytes = Buffer.concat(chunks);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Export for ${dayKey(from)} is ${Math.round(bytes.length / 1048576)} MB, above the ${MAX_FILE_BYTES / 1048576} MB limit`);
    const path = `runs/${dayKey(from)}.jsonl.gz`;
    await this.putFile(repo, token, path, bytes, `Run diagnostics: ${dayKey(from)} (${counts.tasks} runs, ${counts.steps} steps)`);
    this.state.last_push_at = new Date().toISOString();
    this.state.last_file = path;
  }

  private async putFile(repo: string, token: string, path: string, content: Buffer, message: string): Promise<void> {
    // DIAG_GITHUB_API only exists so the test harness can point this at a fake GitHub.
    const api = (process.env.DIAG_GITHUB_API ?? '').trim().replace(/\/$/, '') || 'https://api.github.com';
    const url = `${api}/repos/${repo}/contents/${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vector-brain-diagnostics',
    };
    // Updating a file needs its current sha.
    let sha: string | undefined;
    const existing = await fetch(`${url}?ref=${encodeURIComponent(this.branch)}`, { headers });
    if (existing.ok) sha = ((await existing.json()) as { sha?: string }).sha;
    else if (existing.status !== 404) throw new Error(`GitHub read ${path} failed: ${existing.status} ${(await existing.text()).slice(0, 200)}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: content.toString('base64'), branch: this.branch, ...(sha ? { sha } : {}) }),
    });
    if (!response.ok) throw new Error(`GitHub write ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
