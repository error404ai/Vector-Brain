import z from 'zod';

export const CommandChatValidation = z.object({
  message: z.string().trim().min(1).max(4000),
});

export const CommandChatConfirmValidation = z.object({
  confirm_token: z.string().trim().min(8).max(64),
});
