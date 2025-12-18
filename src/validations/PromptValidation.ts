import z from 'zod';

export const EnhancePromptValidation = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(2000, 'Prompt is too long'),
});
