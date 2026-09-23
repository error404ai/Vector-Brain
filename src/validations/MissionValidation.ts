import z from 'zod';

export const CreateMissionValidation = z.object({
  /** Plain-language instruction. Long URL lists belong in a flow, not a mission. */
  request: z.string().trim().min(1).max(8000),
  device_ids: z.array(z.number().int().positive()).max(100).optional(),
  max_steps: z.number().int().min(1).max(500).optional(),
  ai_config_id: z.number().int().positive().optional(),
  no_internet: z.boolean().optional(),
});
