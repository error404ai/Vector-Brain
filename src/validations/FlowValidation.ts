import { z } from 'zod';

export const SaveFlowValidation = z.object({
  task_id: z.number({ required_error: 'Task id is required' }),
  name: z.string().min(1).max(150).optional(),
});

export const RunFlowValidation = z.object({
  device_id: z.number({ required_error: 'Target device is required' }),
});

export const RenameFlowValidation = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(150),
});
