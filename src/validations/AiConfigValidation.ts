import { AiConfigType, AiProvider } from '@/entities/AiConfig';
import { z } from 'zod';

const optionalUrlSchema = z.string().url('Base URL must be a valid URL').optional().nullable().or(z.literal(''));

export const CreateAiConfigValidation = z.object({
  provider: z.nativeEnum(AiProvider, { required_error: 'Provider is required' }),
  model: z.string().min(1, 'Model name is required').max(150),
  api_key: z.string().min(1, 'API Key is required'),
  base_url: optionalUrlSchema,
  is_active: z.boolean().default(true),
  label: z.string().max(150).optional().nullable(),
  config_type: z.nativeEnum(AiConfigType).default(AiConfigType.VISION),
});

export const UpdateAiConfigValidation = z.object({
  provider: z.nativeEnum(AiProvider).optional(),
  model: z.string().min(1).max(150).optional(),
  api_key: z.string().min(1).optional(),
  base_url: optionalUrlSchema,
  is_active: z.boolean().optional(),
  label: z.string().max(150).optional().nullable(),
  config_type: z.nativeEnum(AiConfigType).optional(),
});

export const TestAiConfigValidation = z.object({
  provider: z.nativeEnum(AiProvider),
  model: z.string().min(1),
  api_key: z.string().min(1),
  base_url: optionalUrlSchema,
});

