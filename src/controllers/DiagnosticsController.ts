import { assertOwner, AuthUser } from '@/helpers/ownerAccess';
import { BilledCostService } from '@/services/android/BilledCostService';
import { DiagnosticsSyncService } from '@/services/android/DiagnosticsSyncService';
import { ClientReportService } from '@/services/ClientReportService';
import { clampDays, RunDiagnosticsService } from '@/services/android/RunDiagnosticsService';
import { Response } from 'express';
import { Authorized, Body, CurrentUser, Get, JsonController, Param, Post, QueryParam, Res } from 'routing-controllers';
import { TestSetService } from '@/services/android/testset/TestSetService';
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
    private billedCost: BilledCostService,
    private testSet: TestSetService,
  ) {}

  /** The fixed test set and its recent runs: pass rate and cost per task, to compare versions. */
  @Get('/testset')
  async testSetRuns(@CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: { tasks: this.testSet.tasks(), runs: await this.testSet.runs(user.userId) } };
  }

  /** Start the test set on these phones: one mission per task, all tagged with one run. */
  @Post('/testset/run')
  async startTestSet(@Body() body: { device_ids?: number[]; keys?: string[] }, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: await this.testSet.start(user.userId, Array.isArray(body?.device_ids) ? body.device_ids : [], Array.isArray(body?.keys) ? body.keys.map(String) : undefined) };
  }

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

  /** Ask the AI provider what it billed for each of the run's model requests (OpenRouter keys only). */
  @Post('/runs/:id/billed')
  async checkBilled(@Param('id') id: number, @CurrentUser({ required: true }) user: AuthUser) {
    assertOwner(user, 'Run diagnostics');
    return { data: await this.billedCost.check(Number(id)) };
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
