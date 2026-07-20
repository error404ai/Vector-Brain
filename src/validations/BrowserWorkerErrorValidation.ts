import { z } from 'zod';

const OptionalShortText = (max: number) => z.string().trim().max(max).optional();

export const BrowserWorkerErrorEventValidation = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    error_code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,99}$/),
    phase: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{0,79}$/),
    message: z.string().trim().min(1).max(1000),
    stack: OptionalShortText(8000),
    extension_version: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/),
    browser: z.enum(['chrome', 'firefox', 'edge', 'other']),
    browser_version: OptionalShortText(50),
    provider: OptionalShortText(50),
    model: OptionalShortText(100),
    tool: OptionalShortText(100),
    step: z.number().int().min(0).max(10_000).optional(),
    task_duration_ms: z.number().int().min(0).max(86_400_000).optional(),
    occurrences: z.number().int().min(1).max(100).optional().default(1),
  })
  .strict();

export const ReportBrowserWorkerErrorsValidation = z
  .object({
    events: z.array(BrowserWorkerErrorEventValidation).min(1).max(20),
  })
  .strict();

export const BrowserWorkerErrorListValidation = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(200).optional(),
  error_code: z.string().trim().max(100).optional(),
  phase: z.string().trim().max(80).optional(),
  extension_version: z.string().trim().max(32).optional(),
  browser: z.enum(['chrome', 'firefox', 'edge', 'other']).optional(),
  sortField: z.enum(['last_seen_at', 'first_seen_at', 'occurrence_count', 'error_code', 'extension_version']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});
