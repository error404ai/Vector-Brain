import type {
  AiConfig,
  AiConfigType,
  AiProvider,
} from '@/RTKService/aiConfigService/aiConfigService';
import {
  useCreateAiConfigMutation,
  useTestAiConfigMutation,
  useUpdateAiConfigMutation,
} from '@/RTKService/aiConfigService/aiConfigService';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyIcon from '@mui/icons-material/Key';
import RemoveRedEyeIcon from '@mui/icons-material/RemoveRedEye';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import {
  Alert,
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface AiConfigModalProps {
  open: boolean;
  onClose: () => void;
  configToEdit?: AiConfig | null;
}

const PROVIDER_PRESETS: Record<
  AiProvider,
  { label: string; defaultBaseUrl?: string; models: { id: string; name: string; isVision: boolean }[] }
> = {
  openai: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Flagship Multimodal)', isVision: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cheap Vision)', isVision: true },
      { id: 'o3-mini', name: 'o3-mini (High-Intelligence Reasoning)', isVision: false },
      { id: 'o1', name: 'o1 (Frontier Reasoning)', isVision: true },
      { id: 'o1-mini', name: 'o1-mini (Fast Reasoning)', isVision: false },
      { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', isVision: true },
    ],
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Next-Gen Realtime Vision)', isVision: true },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite (Ultra-Fast)', isVision: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Deep Context Reasoning)', isVision: true },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Workhorse Vision)', isVision: true },
    ],
  },
  anthropic: {
    label: 'Anthropic Claude',
    models: [
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Reasoning & Vision)', isVision: true },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (High Performance Vision)', isVision: true },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Ultra Fast)', isVision: true },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', isVision: true },
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (Chat)', isVision: false },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Full Reasoning)', isVision: false },
    ],
  },
  groq: {
    label: 'Groq (Ultra-Fast LPU Inference)',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', isVision: false },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', isVision: false },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', isVision: false },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B MoE', isVision: false },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B', isVision: false },
    ],
  },
  openrouter: {
    label: 'OpenRouter (Unified Multi-Model Gateway)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', isVision: true },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', isVision: true },
      { id: 'openai/gpt-4o', name: 'GPT-4o', isVision: true },
      { id: 'openai/o3-mini', name: 'o3-mini', isVision: false },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', isVision: false },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', isVision: false },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', isVision: true },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', isVision: false },
    ],
  },
  custom: {
    label: 'Custom OpenAI-Compatible API / Ollama / Local',
    models: [],
  },
};


export function AiConfigModal({ open, onClose, configToEdit }: AiConfigModalProps) {
  const [createConfig, { isLoading: isCreating }] = useCreateAiConfigMutation();

  const [updateConfig, { isLoading: isUpdating }] = useUpdateAiConfigMutation();
  const [testConfig, { isLoading: isTesting }] = useTestAiConfigMutation();

  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [configType, setConfigType] = useState<AiConfigType>('vision');
  const [isActive, setIsActive] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);

  useEffect(() => {
    if (configToEdit) {
      setProvider(configToEdit.provider);
      setModel(configToEdit.model);
      setLabel(configToEdit.label || '');
      setApiKey(''); // Clear for editing security
      setBaseUrl(configToEdit.base_url || '');
      setConfigType(configToEdit.config_type);
      setIsActive(configToEdit.is_active);
    } else {
      setProvider('openai');
      setModel('gpt-4o-mini');
      setLabel('');
      setApiKey('');
      setBaseUrl('');
      setConfigType('vision');
      setIsActive(true);
    }
    setTestResult(null);
    setShowApiKey(false);
  }, [configToEdit, open]);

  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset.models.length > 0) {
      setModel(preset.models[0].id);
      setConfigType(preset.models[0].isVision ? 'vision' : 'text');
    }
    if (preset.defaultBaseUrl) {
      setBaseUrl(preset.defaultBaseUrl);
    } else {
      setBaseUrl('');
    }
    setTestResult(null);
  };

  const handleModelPresetClick = (modelId: string, isVision: boolean) => {
    setModel(modelId);
    setConfigType(isVision ? 'vision' : 'text');
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim() && !configToEdit?.has_api_key) {
      toast.error('Please enter an API Key to test connection');
      return;
    }

    setTestResult(null);
    try {
      const res = await testConfig({
        provider,
        model,
        api_key: apiKey,
        base_url: baseUrl.trim() || undefined,
      }).unwrap();

      setTestResult({
        success: true,
        message: `Success (${res.data.latencyMs}ms): Model responded with "${res.data.reply}"`,
        latencyMs: res.data.latencyMs,
      });
      toast.success(`Connected successfully in ${res.data.latencyMs}ms`);
    } catch (err: any) {
      const errorMsg = err?.data?.message || err?.error || err?.message || 'Failed to connect to AI provider';
      setTestResult({
        success: false,
        message: errorMsg,
      });
      toast.error(errorMsg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!configToEdit && !apiKey.trim()) {
      toast.error('API Key is required');
      return;
    }

    try {
      if (configToEdit) {
        await updateConfig({
          id: configToEdit.id,
          provider,
          model,
          label: label.trim() || undefined,
          base_url: baseUrl.trim() || null,
          config_type: configType,
          is_active: isActive,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }).unwrap();
        toast.success('AI Configuration updated successfully');
      } else {
        await createConfig({
          provider,
          model,
          api_key: apiKey.trim(),
          label: label.trim() || undefined,
          base_url: baseUrl.trim() || null,
          config_type: configType,
          is_active: isActive,
        }).unwrap();
        toast.success('AI Configuration created successfully');
      }
      onClose();
    } catch (err: any) {
      const errorMsg = err?.data?.message || err?.error || err?.message || 'Failed to save configuration';
      toast.error(errorMsg);
    }
  };


  const isSaving = isCreating || isUpdating;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={600}>
            {configToEdit ? 'Edit AI Configuration' : 'Add AI Provider Configuration'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure your personal AI credentials for mobile automation, prompt enhancement, and agent execution.
          </Typography>
        </DialogTitle>

        <DialogContent dividers sx={{ px: 3, py: 2.5 }}>
          <Stack spacing={2.5}>

            {/* --- Provider & model --------------------------------------- */}
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.6 }}>
                Provider & model
              </Typography>

              <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                <InputLabel>AI provider</InputLabel>
                <Select value={provider} label="AI provider" onChange={(e) => handleProviderChange(e.target.value as AiProvider)}>
                  {Object.entries(PROVIDER_PRESETS).map(([key, value]) => (
                    <MenuItem key={key} value={key}>
                      {value.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Vision guidance — the agent reads screenshots, so this is the
                  single most important thing to get right. */}
              <Box
                sx={{
                  mt: 1.5,
                  display: 'flex',
                  gap: 1,
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                }}
              >
                <RemoveRedEyeIcon fontSize="small" color="primary" sx={{ mt: 0.2 }} />
                <Typography variant="caption" color="primary.dark" sx={{ lineHeight: 1.5 }}>
                  Pick a <strong>vision</strong> model — the agent reads phone screenshots, so a text-only model can't drive the phone.
                </Typography>
              </Box>

              {/* Model chips — one place, vision marked. */}
              {PROVIDER_PRESETS[provider].models.length > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                  {PROVIDER_PRESETS[provider].models.map((m) => (
                    <Chip
                      key={m.id}
                      label={m.name.split(' (')[0]}
                      size="small"
                      clickable
                      icon={m.isVision ? <RemoveRedEyeIcon sx={{ fontSize: 15 }} /> : undefined}
                      color={model === m.id ? 'primary' : 'default'}
                      variant={model === m.id ? 'filled' : 'outlined'}
                      onClick={() => handleModelPresetClick(m.id, m.isVision)}
                    />
                  ))}
                </Stack>
              )}

              <TextField
                label="Name (optional)"
                size="small"
                fullWidth
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Claude 3.7 Sonnet — a name you'll recognise"
                sx={{ mt: 1.5 }}
              />

              <TextField
                label="Model ID"
                size="small"
                fullWidth
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. anthropic/claude-3.7-sonnet"
                helperText="The exact identifier the provider's API expects — not the display name."
                sx={{ mt: 1.5 }}
              />

              {/* Live capability line + warning for text-only picks. */}
              {(() => {
                const known = PROVIDER_PRESETS[provider].models.find((m) => m.id === model);
                const isVision = known ? known.isVision : configType === 'vision';
                return isVision ? (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75, color: 'success.main' }}>
                    <RemoveRedEyeIcon sx={{ fontSize: 16 }} />
                    <Typography variant="caption">Vision — can read the phone screen</Typography>
                  </Stack>
                ) : (
                  <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.warning.main, 0.12) }}>
                    <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.dark', mt: 0.2 }} />
                    <Typography variant="caption" color="warning.dark" sx={{ lineHeight: 1.5 }}>
                      Heads up: <code>{model || 'this model'}</code> is text-only. It won't be able to see the screen.
                    </Typography>
                  </Stack>
                );
              })()}
            </Box>

            <Divider />

            {/* --- Credentials -------------------------------------------- */}
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.6 }}>
                Credentials
              </Typography>

              <TextField
                label={configToEdit ? 'API key (leave blank to keep existing)' : 'API key'}
                size="small"
                fullWidth
                required={!configToEdit}
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={configToEdit?.has_api_key ? '••••••••••••••••••••••••' : 'sk-...'}
                sx={{ mt: 1 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <KeyIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowApiKey(!showApiKey)} edge="end">
                        {showApiKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                helperText="Encrypted with AES-256-GCM at rest. Never shown in responses."
              />
            </Box>

            {/* --- Advanced (collapsed) ----------------------------------- */}
            <Box>
              <Button
                size="small"
                onClick={() => setShowAdvanced((v) => !v)}
                endIcon={<ExpandMoreIcon sx={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />}
                sx={{ textTransform: 'none', color: 'text.secondary', px: 0 }}
              >
                Advanced — custom URL, capability
              </Button>
              <Collapse in={showAdvanced}>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    label="Custom base URL (optional)"
                    size="small"
                    fullWidth
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    helperText="Leave empty for official endpoints. For OpenRouter, DeepSeek, or self-hosted proxies."
                  />
                  <FormControl fullWidth size="small">
                    <InputLabel>Capability type</InputLabel>
                    <Select value={configType} label="Capability type" onChange={(e) => setConfigType(e.target.value as AiConfigType)}>
                      <MenuItem value="vision">Vision / multimodal (screenshots + UI hierarchy)</MenuItem>
                      <MenuItem value="text">Text-only (UI hierarchy only — faster, cheaper)</MenuItem>
                    </Select>
                    <FormHelperText>
                      {configType === 'vision'
                        ? 'Sends live screen captures and UI trees to the agent.'
                        : 'Sends only the UI tree (best for DeepSeek, Groq, or text-only models).'}
                    </FormHelperText>
                  </FormControl>
                </Stack>
              </Collapse>
            </Box>

            <Divider />

            {/* --- Active + test ------------------------------------------ */}
            <FormControlLabel
              control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} color="primary" />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Set as active
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Use this model for all upcoming runs.
                  </Typography>
                </Box>
              }
            />

            <Box>
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                startIcon={isTesting ? <CircularProgress size={16} /> : <FlashOnIcon />}
                onClick={handleTestConnection}
                disabled={isTesting || (!apiKey.trim() && !configToEdit?.has_api_key)}
              >
                {isTesting ? 'Testing…' : 'Test connection'}
              </Button>
              {testResult && (
                <Alert
                  severity={testResult.success ? 'success' : 'error'}
                  icon={testResult.success ? <CheckCircleOutlineIcon /> : <ErrorOutlineIcon />}
                  sx={{ mt: 1.5 }}
                >
                  <Typography variant="body2">{testResult.message}</Typography>
                </Alert>
              )}
            </Box>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSaving}>
            {isSaving ? <CircularProgress size={20} color="inherit" /> : configToEdit ? 'Save Changes' : 'Create Configuration'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
