import { z } from 'zod';

/** "HH:MM" in 24-hour form. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM 24-hour format');

/** 0 = Sunday … 6 = Saturday. An empty list means every day. */
const daysOfWeek = z.array(z.number().int().min(0).max(6)).max(7);

export const CreateScheduledTaskValidation = z.object({
  device_id: z.number({ required_error: 'Target device is required' }),
  prompt: z.string().min(1, 'Prompt cannot be empty').max(500),
  run_at: timeOfDay,
  days_of_week: daysOfWeek.optional(),
  timezone: z.string().max(64).optional(),
  max_steps: z.number().int().min(1).max(200).optional(),
  ai_config_id: z.number().int().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const UpdateScheduledTaskValidation = z.object({
  device_id: z.number().optional(),
  prompt: z.string().min(1).max(500).optional(),
  run_at: timeOfDay.optional(),
  days_of_week: daysOfWeek.optional(),
  timezone: z.string().max(64).optional(),
  max_steps: z.number().int().min(1).max(200).optional(),
  ai_config_id: z.number().int().nullable().optional(),
  enabled: z.boolean().optional(),
});
