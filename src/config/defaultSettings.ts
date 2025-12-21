export interface DefaultSetting {
  key: string;
  value: string;
  group: string;
  value_type: 'string' | 'boolean' | 'json';
  title: string;
}

export const DEFAULT_SETTINGS: DefaultSetting[] = [
  {
    title: 'System Prompt for Prompt Enhancement',
    key: 'systemPromptForEnhancement',
    value: 'You are an expert prompt engineer. Enhance the following user prompt to make it clearer, more specific, and more effective for AI models. Keep the core intent but improve structure, add context if needed, and ensure it\'s concise. Return only the enhanced prompt, no explanations.',
    group: 'ai',
    value_type: 'string',
  },
];

export const DEFAULT_SETTINGS_MAP = new Map<string, string>(
  DEFAULT_SETTINGS.map((setting) => [setting.key, setting.value])
);

export const DEFAULT_SETTINGS_VALUE_TYPE_MAP = new Map<string, 'string' | 'boolean' | 'json'>(
  DEFAULT_SETTINGS.map((s) => [s.key, s.value_type])
);

export const SETTING_KEYS = DEFAULT_SETTINGS.map((s) => s.key);