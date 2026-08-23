import { z } from 'zod';

export const RequestPairingCodeValidation = z.object({
  device_name: z.string().min(1, 'Device name is required').max(150),
  device_model: z.string().max(100).optional(),
});

export const ConfirmPairingValidation = z.object({
  pairing_code: z.string().length(6, 'Pairing code must be exactly 6 characters').toUpperCase(),
  device_id: z.string().min(1, 'Device ID is required'),
  device_name: z.string().min(1, 'Device name is required').max(150),
  device_model: z.string().max(100).optional(),
  android_version: z.string().max(50).optional(),
  capabilities: z
    .object({
      accessibility: z.boolean(),
      screenCapture: z.boolean(),
      screenWidth: z.number().optional(),
      screenHeight: z.number().optional(),
    })
    .optional(),
});

export const UpdateDeviceValidation = z.object({
  device_name: z.string().min(1).max(150).optional(),
});

export const DeviceListValidation = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const DispatchAndroidPromptValidation = z.object({
  device_id: z.number({ required_error: 'Target device ID is required' }),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  max_steps: z.number().min(1).max(50).default(15),
});

export const DirectActionValidation = z.object({
  device_id: z.number(),
  action: z.any(),
});
