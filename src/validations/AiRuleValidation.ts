import { z } from 'zod';

// Helper for coercing string query params to numbers
const coerceNumber = (fieldName: string) =>
  z.coerce.number({
    invalid_type_error: `${fieldName} must be a number`,
  });

// Create AI rule validation
export const CreateAiRuleValidation = z.object({
  name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required'),
  description: z.string().optional(),
  rule: z.string().optional(),
  is_active: z.boolean().optional(),
});

// Update AI rule validation
export const UpdateAiRuleValidation = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional(),
  rule: z.string().optional(),
  is_active: z.boolean().optional(),
});

// AI rule query validation (for GET list)
export const AiRuleListValidation = z.object({
  page: coerceNumber('Page').min(1, 'Page must be at least 1').optional().default(1),
  limit: coerceNumber('Limit').min(1, 'Limit must be at least 1').optional().default(10),
  search: z.string().optional(),
});
