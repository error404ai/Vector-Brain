import { ClientReportService } from '@/services/ClientReportService';
import { Request } from 'express';
import { Body, CurrentUser, JsonController, Post, Req } from 'routing-controllers';
import { Service } from 'typedi';

/**
 * Where the web app reports its own failures (see frontend _helpers/clientDiagnostics).
 * Open without a session on purpose: the interesting reports are often sent
 * while the app is still booting and has no token yet. Rate-limited per IP and
 * size-capped in ClientReportService.
 */
@Service()
@JsonController('/client-reports')
export class ClientReportController {
  constructor(private reports: ClientReportService) {}

  @Post('/')
  async create(
    @Body() body: { kind?: string; page?: string; tab_id?: string; app_version?: string; payload?: Record<string, unknown> },
    @CurrentUser({ required: false }) user: { userId?: number } | undefined,
    @Req() request: Request,
  ) {
    // The last X-Forwarded-For entry is the one our own proxy added; earlier
    // ones come from the client and would let it dodge the rate limit.
    const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    const ip = forwarded[forwarded.length - 1] ?? request.socket?.remoteAddress ?? '';
    return { data: await this.reports.record(body ?? {}, { userId: user?.userId ?? null, ip, userAgent: String(request.headers['user-agent'] ?? '') }) };
  }
}
