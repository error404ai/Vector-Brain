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

function sanitizeDiagnosticText(value: string | undefined, maxLength: number) {
  if (!value) return undefined;

  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/https?:\/\/[^\s)\]}>'"]+/gi, '[url]')
    .replace(/(?:chrome|moz)-extension:\/\/[^/\s]+/gi, 'extension://[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeDiagnosticIdentifier(value: string | undefined, maxLength: number) {
  if (!value) return undefined;

  return value
    .replace(/[^A-Za-z0-9._:/+-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
}

function sanitizeExtensionStack(value: string | undefined) {
  if (!value) return undefined;

  const frames = value
    .split('\n')
    .flatMap((line) => {
      const normalized = line.replace(/(?:chrome|moz)-extension:\/\/[^/\s)]+/gi, 'extension://[redacted]').trim();
      return /^at extension:\/\/\[redacted\]\/[A-Za-z0-9._/:+-]{1,400}$/.test(normalized) ? [normalized] : [];
    })
    .slice(0, 20);

  return frames.length > 0 ? frames.join('\n').slice(0, 8000) : undefined;
}

function diagnosticMessage(errorCode: string) {
  const messages: Record<string, string> = {
    AUTH_ERROR: 'The AI provider rejected the request due to an invalid or missing API key.',
    MODEL_NOT_FOUND: 'The requested AI model was not found or is unavailable on this provider.',
    RATE_LIMIT_ERROR: 'The AI provider rate limit or account quota was exceeded.',
    CONTEXT_LENGTH_EXCEEDED: 'The conversation or page content exceeded the model’s maximum context limit.',
    TAB_CLOSED: 'The browser tab was closed while automation was in progress.',
    BACKGROUND_WORKER_INTERRUPTED: 'A browser automation task was interrupted when the extension background worker stopped.',
    BACKGROUND_COMMUNICATION_ERROR: 'The BrowserWorker interface could not communicate with the extension background worker.',
    PANEL_RENDER_ERROR: 'The BrowserWorker side panel encountered a rendering error.',
    AGENT_RUNTIME_ERROR: 'The browser automation agent encountered a runtime error.',
    TASK_FAILED: 'A user-requested browser automation task failed.',
    UNHANDLED_REJECTION: 'BrowserWorker encountered an unhandled asynchronous error.',
    UNHANDLED_ERROR: 'BrowserWorker encountered an unhandled extension error.',
    TIMEOUT: 'A BrowserWorker operation timed out.',
    PERMISSION_ERROR: 'A BrowserWorker operation could not access a required browser capability.',
    NETWORK_ERROR: 'A BrowserWorker network operation failed.',
    STORAGE_ERROR: 'A BrowserWorker local storage operation failed.',
  };

  return messages[errorCode] || 'BrowserWorker encountered an unexpected extension error.';
}

function serverFingerprint(event: ErrorEvent) {
  const message = diagnosticMessage(event.error_code);
  const stack = sanitizeExtensionStack(event.stack)?.split('\n').slice(0, 5).join('\n') || '';

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
      const message = diagnosticMessage(event.error_code);
      const stack = sanitizeExtensionStack(event.stack);
      const browserVersion = sanitizeDiagnosticIdentifier(event.browser_version, 50);
      const provider = sanitizeDiagnosticIdentifier(event.provider, 50);
      const model = sanitizeDiagnosticIdentifier(event.model, 100);
      const tool = sanitizeDiagnosticIdentifier(event.tool, 100);

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
