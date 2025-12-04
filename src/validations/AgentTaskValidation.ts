import { z } from 'zod';

// Create agent task validation
export const CreateAgentTaskValidation = z.object({
  prompt: z.string({ required_error: 'Prompt is required' }).min(1, 'Prompt is required'),
  logs: z.string().optional(),
  steps: z.string().optional(),
});

// Agent task query validation (for GET list)
export const AgentTaskListValidation = z.object({
  page: z.coerce.number().min(1, 'Page must be at least 1').optional().default(1),
  limit: z.coerce.number().min(1, 'Limit must be at least 1').optional().default(10),
});
