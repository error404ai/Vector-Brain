import { z } from 'zod';

// Helper for coercing string query params to numbers
const coerceNumber = (fieldName: string) =>
  z.coerce.number({
    invalid_type_error: `${fieldName} must be a number`,
  });

// Create AI rule validation
export const CreateAiRuleValidation = z.object({
  name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required'),
  rule: z.string({ required_error: 'Rule is required' }).min(1, 'Rule is required'),
  intent: z.string({ required_error: 'Intent is required' }).min(1, 'Intent is required'),
  website: z.string().url().optional(),
  is_active: z.boolean().optional(),
  is_global: z.boolean().optional(),
});

// Update AI rule validation
export const UpdateAiRuleValidation = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  rule: z.string().min(1, 'Rule cannot be empty').optional(),
  intent: z.string().min(1, 'Intent cannot be empty').optional(),
  website: z.string().url().optional(),
  is_active: z.boolean().optional(),
});

// AI rule query validation (for GET list)
export const AiRuleListValidation = z.object({
  page: coerceNumber('Page').min(1, 'Page must be at least 1').optional().default(1),
  limit: coerceNumber('Limit').min(1, 'Limit must be at least 1').optional().default(10),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

// Search AI rules by prompt validation
export const SearchAiRulesValidation = z.object({
  prompt: z.string({ required_error: 'Prompt is required' }).min(1, 'Prompt is required'),
  limit: coerceNumber('Limit').min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').optional().default(10),
});

// Export AI rules validation
export const ExportAiRulesValidation = z.object({
  ids: z.string().optional(),
});

// Import AI rules validation
export const ImportAiRulesValidation = z.object({
  rules: z.array(
    z.object({
      name: z.string().min(1, 'Name is required'),
      rule: z.string().min(1, 'Rule is required'),
      intent: z.string().min(1, 'Intent is required'),
      website: z.union([z.string().url(), z.null()]),
      is_active: z.boolean().optional(),
    })
  ),
  deleteExisting: z.boolean().optional(),
});

// Bulk delete AI rules validation
export const BulkDeleteAiRulesValidation = z.object({
  ids: z.array(coerceNumber('ID')).min(1, 'At least one ID is required'),
});
