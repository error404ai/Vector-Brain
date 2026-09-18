import { z } from 'zod';

/**
 * Only http and https are accepted.
 *
 * A rotation link is always a plain web request, so anything else is either a
 * typo or an attempt to make the server fetch something it should not.
 */
const rotationUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), { message: 'Only http:// and https:// URLs are supported' });

export const CreateProxyValidation = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1).max(100),
  rotation_url: rotationUrl,
  concurrency: z.number().int().min(1).max(50).optional(),
  settle_seconds: z.number().int().min(0).max(120).optional(),
  rotate_every_tasks: z.number().int().min(0).max(1000).optional(),
});

export const UpdateProxyValidation = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  /** Empty string keeps the saved URL, so renaming never resends the secret. */
  rotation_url: z.union([rotationUrl, z.literal('')]).optional(),
  concurrency: z.number().int().min(1).max(50).optional(),
  settle_seconds: z.number().int().min(0).max(120).optional(),
  rotate_every_tasks: z.number().int().min(0).max(1000).optional(),
});

export const AssignProxyValidation = z.object({
  device_id: z.number().int().positive(),
  proxy_id: z.number().int().positive().nullable(),
});
