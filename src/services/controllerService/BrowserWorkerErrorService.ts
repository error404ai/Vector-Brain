import { BrowserWorkerError } from '@/entities/BrowserWorkerError';
import AppError from '@/helpers/AppError';
import paginate from '@/helpers/paginationHelper';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { BrowserWorkerErrorListValidation, ReportBrowserWorkerErrorsValidation } from '@/validations/BrowserWorkerErrorValidation';
import { createHash } from 'node:crypto';
import { Service } from 'typedi';
import z from 'zod';

type ErrorEvent = z.infer<typeof ReportBrowserWorkerErrorsValidation>['events'][number];

function sanitizeDiagnosticText(value: string | undefined, maxLength: number, preserveLines = false) {
  if (!value) return undefined;

  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/https?:\/\/[^\s)\]}>'"]+/gi, '[url]')
    .replace(/(?:chrome|moz)-extension:\/\/[^/\s]+/gi, 'extension://[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(preserveLines ? /[^\S\r\n]+/g : /\s+/g, ' ')
    .replace(preserveLines ? /(?:\r?\n){3,}/g : /$^/, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function serverFingerprint(event: ErrorEvent) {
  const message = sanitizeDiagnosticText(event.message, 1000)?.replace(/\b\d+\b/g, '#') || 'unknown';
  const stack = sanitizeDiagnosticText(event.stack, 8000, true)?.split('\n').slice(0, 5).join('\n') || '';

  return createHash('sha256')
    .update([event.error_code, event.phase, event.extension_version, event.browser, event.provider || '', event.tool || '', message, stack].join('|'))
    .digest('hex');
}

@Service()
export class BrowserWorkerErrorService {
  private browserWorkerErrorRepository = AppDataSource.getRepository(BrowserWorkerError);
  private lastCleanupAt = 0;

  private async cleanupExpiredErrors() {
    const now = Date.now();
    if (now - this.lastCleanupAt < 24 * 60 * 60 * 1000) return;

    this.lastCleanupAt = now;
    await this.browserWorkerErrorRepository.createQueryBuilder().delete().where('last_seen_at < UTC_TIMESTAMP() - INTERVAL 90 DAY').execute();
  }

  async report(request: z.infer<typeof ReportBrowserWorkerErrorsValidation>): Promise<ApiResponse> {
    await this.cleanupExpiredErrors();

    for (const event of request.events) {
      const fingerprint = serverFingerprint(event);
      const message = sanitizeDiagnosticText(event.message, 1000) || 'Unknown extension error';
      const stack = sanitizeDiagnosticText(event.stack, 8000, true);
      const browserVersion = sanitizeDiagnosticText(event.browser_version, 50);
      const provider = sanitizeDiagnosticText(event.provider, 50);
      const model = sanitizeDiagnosticText(event.model, 100);
      const tool = sanitizeDiagnosticText(event.tool, 100);

      await this.browserWorkerErrorRepository.query(
        `INSERT INTO \`browserworker_errors\` (
          \`fingerprint\`, \`error_code\`, \`phase\`, \`message\`, \`stack\`,
          \`extension_version\`, \`browser\`, \`browser_version\`, \`provider\`,
          \`model\`, \`tool\`, \`step\`, \`task_duration_ms\`, \`occurrence_count\`,
          \`first_seen_at\`, \`last_seen_at\`
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
        ON DUPLICATE KEY UPDATE
          \`occurrence_count\` = \`occurrence_count\` + VALUES(\`occurrence_count\`),
          \`last_seen_at\` = UTC_TIMESTAMP(6),
          \`message\` = VALUES(\`message\`),
          \`stack\` = VALUES(\`stack\`),
          \`browser_version\` = VALUES(\`browser_version\`),
          \`provider\` = VALUES(\`provider\`),
          \`model\` = VALUES(\`model\`),
          \`tool\` = VALUES(\`tool\`),
          \`step\` = VALUES(\`step\`),
          \`task_duration_ms\` = VALUES(\`task_duration_ms\`)`,
        [fingerprint, event.error_code, event.phase, message, stack || null, event.extension_version, event.browser, browserVersion || null, provider || null, model || null, tool || null, event.step ?? null, event.task_duration_ms ?? null, event.occurrences]
      );
    }

    return {
      message: 'BrowserWorker error reports accepted',
      data: { accepted: request.events.length },
    };
  }

  async list(request: z.infer<typeof BrowserWorkerErrorListValidation>): Promise<ApiResponse> {
    const { page, limit, search, error_code, phase, extension_version, browser, sortField, sortDirection } = request;
    const query = this.browserWorkerErrorRepository.createQueryBuilder('error');

    if (search) {
      query.andWhere('(error.message LIKE :search OR error.error_code LIKE :search OR error.tool LIKE :search)', { search: `%${search}%` });
    }
    if (error_code) query.andWhere('error.error_code = :error_code', { error_code });
    if (phase) query.andWhere('error.phase = :phase', { phase });
    if (extension_version) query.andWhere('error.extension_version = :extension_version', { extension_version });
    if (browser) query.andWhere('error.browser = :browser', { browser });

    query.orderBy(`error.${sortField || 'last_seen_at'}`, (sortDirection || 'desc').toUpperCase() as 'ASC' | 'DESC');

    return paginate(query, { page, limit });
  }

  async details(id: number): Promise<ApiResponse> {
    const error = await this.browserWorkerErrorRepository.findOne({ where: { id } });
    if (!error) throw new AppError('BrowserWorker error was not found', 404);
    return { message: 'BrowserWorker error retrieved successfully', data: error };
  }

  async summary(): Promise<ApiResponse> {
    const raw = await this.browserWorkerErrorRepository.createQueryBuilder('error').select('COUNT(*)', 'total_groups').addSelect('COALESCE(SUM(error.occurrence_count), 0)', 'total_occurrences').addSelect('SUM(error.last_seen_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR)', 'active_groups_24h').getRawOne();

    return {
      message: 'BrowserWorker error summary retrieved successfully',
      data: {
        total_groups: Number(raw?.total_groups || 0),
        total_occurrences: Number(raw?.total_occurrences || 0),
        active_groups_24h: Number(raw?.active_groups_24h || 0),
      },
    };
  }

  async delete(id: number): Promise<ApiResponse> {
    const result = await this.browserWorkerErrorRepository.delete(id);
    if (!result.affected) throw new AppError('BrowserWorker error was not found', 404);
    return { message: 'BrowserWorker error deleted successfully' };
  }
}
