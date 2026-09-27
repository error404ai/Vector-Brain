import { assertOwner, AuthUser } from '@/helpers/ownerAccess';
import { DiagnosticsSyncService } from '@/services/android/DiagnosticsSyncService';
import { ClientReportService } from '@/services/ClientReportService';
import { clampDays, RunDiagnosticsService } from '@/services/android/RunDiagnosticsService';
import { Response } from 'express';
import { Authorized, CurrentUser, Get, JsonController, Param, Post, QueryParam, Res } from 'routing-controllers';
import { Service } from 'typedi';
import { createGzip } from 'zlib';

/**
 * Run diagnostics for the platform owner: where the agent's steps, time and
 * tokens go, across every run on the platform. Read-only, apart from asking
 * the GitHub sync to run now.
 */
@Service()
@Authorized()
@JsonController('/diagnostics')
export class DiagnosticsController {
  constructor(
    private diagnostics: RunDiagnosticsService,
    private sync: DiagnosticsSyncService,
    private clientReports: ClientReportService,
  ) {}

  /** What browsers reported about themselves: unclean exits, stuck loaders, JS/render errors. */
  @Get('/client-reports')
  async listClientReports(@QueryParam('days') days: number, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: await this.clientReports.list(clampDays(days)) };
  }

  @Get('/summary')
  async summary(@QueryParam('days') days: number, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return this.diagnostics.summary(clampDays(days));
  }

  @Get('/runs')
  async runs(@QueryParam('days') days: number, @QueryParam('limit') limit: number, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return this.diagnostics.runs(clampDays(days), Number(limit) || 50);
  }

  @Get('/runs/:id')
  async run(@Param('id') id: number, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return this.diagnostics.run(Number(id));
  }

  /** Sanitized export (gzip JSONL) of the last N days; no screenshots, no personal text. */
  @Get('/export')
  async export(@QueryParam('days') days: number, @CurrentUser({ required: true }) user: AuthUser, @Res() res: Response) {
    assertOwner(user, 'Run diagnostics');
    const span = clampDays(days);
    const from = new Date(Date.now() - span * 86_400_000);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="vector-runs-${span}d-${stamp}.jsonl.gz"`);
    res.setHeader('Cache-Control', 'no-store');
    const gzip = createGzip();
    gzip.pipe(res);
    await this.diagnostics.exportRuns(gzip, from);
    gzip.end();
    await new Promise<void>((resolve) => res.on('finish', () => resolve()));
    return res;
  }

  @Get('/sync')
  syncStatus(@CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: this.sync.status() };
  }

  @Post('/sync')
  async syncNow(@CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: await this.sync.syncNow() };
  }
}
