import z from 'zod';

export const CommandChatValidation = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.number().int().positive().optional(),
});

export const CommandChatConfirmValidation = z.object({
  confirm_token: z.string().trim().min(8).max(64),
});

export const CommandChatRerunValidation = z.object({
  mission_id: z.number().int().positive(),
  scope: z.enum(['failed', 'all']).optional(),
  continue: z.boolean().optional(),
});

export const CommandChatDryRunValidation = z.object({
  message: z.string().trim().min(1).max(4000),
  /** Pretend conversation for evals; the real one is used when omitted. */
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(30).optional(),
  /** Pretend "waiting for Confirm" items for evals. */
  pending: z.array(z.string().max(300)).max(5).optional(),
  /** Compare policies: 'v1' model decides, 'v2' backend check. */
  policy: z.enum(['v1', 'v2']).optional(),
});
