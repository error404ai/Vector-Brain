import { z } from 'zod';
import { SETTING_KEYS } from '../config/defaultSettings';

export const SettingGetValidation = z
  .object({
    key: z.string({
      required_error: 'Key is required',
    }),
  })
  .refine(
    (data) => {
      return SETTING_KEYS.includes(data.key);
    },
    {
      message: 'Invalid setting key.',
      path: ['key'],
    }
  );

export const SettingUpsertValidation = z
  .object({
    key: z.string({
      required_error: 'Key is required',
    }),
    value: z.union([z.string(), z.boolean()], {
      required_error: 'Value is required',
    }),
  })
  .refine(
    (data) => {
      return SETTING_KEYS.includes(data.key);
    },
    {
      message: 'Invalid setting key.',
      path: ['key'],
    }
  );

export const SettingBulkUpsertValidation = z.array(SettingUpsertValidation);
