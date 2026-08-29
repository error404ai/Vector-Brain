import type { AiConfig } from '@/RTKService/aiConfigService/aiConfigService';
import {
  useDeleteAiConfigMutation,
  useGetAiConfigsQuery,
  useSetActiveAiConfigMutation,
  useTestSavedAiConfigMutation,
} from '@/RTKService/aiConfigService/aiConfigService';
import { useGetSettingsQuery, useUpdateSettingMutation } from '@/RTKService/settingService/settingService';
import { AiConfigModal } from '@/components/ai-config/AiConfigModal';
import PageHeader from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SaveIcon from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import VisibilityIcon from '@mui/icons-material/Visibility';

import {
  Alert,
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const theme = useTheme();

  // Prompt settings
  const { data: settings, isLoading: isSettingsLoading } = useGetSettingsQuery();
  const [updateSetting, { isLoading: isUpdatingPrompt }] = useUpdateSettingMutation();
  const systemPromptSetting = settings?.find((setting) => setting.key === 'systemPromptForEnhancement');
  const [systemPrompt, setSystemPrompt] = useState('');

  // AI Configurations
  const { data: aiConfigsData, isLoading: isAiConfigsLoading } = useGetAiConfigsQuery();
  const aiConfigs = aiConfigsData?.data || [];

  const [setActiveConfig, { isLoading: isSettingActive }] = useSetActiveAiConfigMutation();
  const [deleteConfig] = useDeleteAiConfigMutation();
  const [testSavedConfig, { isLoading: isTestingSaved }] = useTestSavedAiConfigMutation();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AiConfig | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  useEffect(() => {
    if (systemPromptSetting) {
      setSystemPrompt(String(systemPromptSetting.value ?? ''));
    }
  }, [systemPromptSetting]);

  const handlePromptSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateSetting({ key: 'systemPromptForEnhancement', value: systemPrompt }).unwrap();
      toast.success('System prompt updated successfully');
    } catch {
      toast.error('Failed to update system prompt');
    }
  };

  const handleSetActive = async (id: number) => {
    try {
      await setActiveConfig(id).unwrap();
      toast.success('Active AI provider updated');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to set active config');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete AI configuration "${name}"?`)) {
      try {
        await deleteConfig(id).unwrap();
        toast.success('AI configuration removed');
      } catch (err: any) {
        toast.error(err?.data?.message || 'Failed to delete configuration');
      }
    }
  };

  const handleTestSaved = async (id: number) => {
    setTestingId(id);
    try {
      const res = await testSavedConfig(id).unwrap();
      toast.success(`Connected (${res.data.latencyMs}ms): ${res.data.reply}`);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Connection test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleOpenAdd = () => {
    setEditingConfig(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (config: AiConfig) => {
    setEditingConfig(config);
    setModalOpen(true);
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'openai':
        return '#10a37f';
      case 'google':
        return '#4285f4';
      case 'anthropic':
        return '#d97706';
      case 'deepseek':
        return '#4f46e5';
      case 'groq':
        return '#f97316';
      case 'openrouter':
        return '#8b5cf6';
      default:
        return theme.palette.primary.main;
    }
  };

  return (
    <>
      <Helmet>
        <title>Settings & AI Providers - Vector Brain</title>
      </Helmet>

      <PageHeader
        title="Settings & AI Providers"
        subtitle="Manage your personal AI model configurations and agent settings."
      />

      <Stack spacing={3.5} sx={{ maxWidth: 1000 }}>
        {/* Section 1: User's AI Providers & Credentials */}
        <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
          <Stack spacing={2.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.5}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 2.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    color: 'primary.main',
                  }}
                >
                  <PsychologyIcon />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    AI Provider Configurations
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Add your personal API keys (OpenAI, Gemini, Anthropic, DeepSeek, Groq, OpenRouter).
                  </Typography>
                </Box>
              </Stack>

              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleOpenAdd}
                sx={{ borderRadius: 2 }}
              >
                Add AI Provider
              </Button>
            </Stack>

            <Divider />

            {isAiConfigsLoading ? (
              <Stack alignItems="center" sx={{ py: 6 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : aiConfigs.length === 0 ? (
              <Alert
                severity="info"
                variant="outlined"
                action={
                  <Button color="inherit" size="small" onClick={handleOpenAdd}>
                    Add One Now
                  </Button>
                }
              >
                You haven&apos;t added any AI provider configurations yet. Add your OpenAI, Gemini, or DeepSeek API key to enable Android automation and AI execution.
              </Alert>
            ) : (
              <Stack spacing={2}>
                {aiConfigs.map((config) => {
                  const providerColor = getProviderColor(config.provider);
                  const isTestingThis = testingId === config.id && isTestingSaved;

                  return (
                    <Card
                      key={config.id}
                      variant="outlined"
                      sx={{
                        borderRadius: 2.5,
                        borderColor: config.is_active ? alpha(theme.palette.primary.main, 0.5) : undefined,
                        bgcolor: config.is_active ? alpha(theme.palette.primary.main, 0.02) : undefined,
                        transition: 'all 0.2s',
                        '&:hover': {
                          borderColor: theme.palette.primary.main,
                        },
                      }}
                    >
                      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                          gap={2}
                        >
                          {/* Left: Info */}
                          <Stack direction="row" spacing={2} alignItems="center">
                            <Tooltip title={config.is_active ? 'Active Provider' : 'Click to Set Active'}>
                              <IconButton
                                color={config.is_active ? 'primary' : 'default'}
                                onClick={() => !config.is_active && handleSetActive(config.id)}
                                disabled={config.is_active || isSettingActive}
                              >
                                {config.is_active ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
                              </IconButton>
                            </Tooltip>

                            <Box>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="subtitle1" fontWeight={600}>
                                  {config.label || `${config.provider.toUpperCase()} - ${config.model}`}
                                </Typography>

                                {config.is_active && (
                                  <Chip
                                    label="ACTIVE"
                                    size="small"
                                    color="primary"
                                    sx={{ fontWeight: 700, height: 22, fontSize: '0.7rem' }}
                                  />
                                )}

                                <Chip
                                  label={config.provider.toUpperCase()}
                                  size="small"
                                  sx={{
                                    bgcolor: alpha(providerColor, 0.12),
                                    color: providerColor,
                                    fontWeight: 600,
                                    height: 22,
                                    fontSize: '0.7rem',
                                  }}
                                />

                                <Chip
                                  icon={config.config_type === 'vision' ? <VisibilityIcon fontSize="inherit" /> : <SmartToyIcon fontSize="inherit" />}
                                  label={config.config_type === 'vision' ? 'Vision' : 'Text-Only'}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 22, fontSize: '0.7rem' }}
                                />
                              </Stack>

                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                Model: <strong>{config.model}</strong>
                                {config.base_url && ` • Base URL: ${config.base_url}`}
                              </Typography>
                            </Box>
                          </Stack>

                          {/* Right: Actions */}
                          <Stack direction="row" spacing={1} alignItems="center" alignSelf={{ xs: 'flex-end', sm: 'center' }}>
                            <Button
                              size="small"
                              variant="outlined"
                              color="secondary"
                              startIcon={isTestingThis ? <CircularProgress size={14} /> : <FlashOnIcon />}
                              onClick={() => handleTestSaved(config.id)}
                              disabled={isTestingThis}
                            >
                              Test
                            </Button>

                            <Tooltip title="Edit configuration">
                              <IconButton size="small" onClick={() => handleOpenEdit(config)}>
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <Tooltip title="Delete configuration">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleDelete(config.id, config.label || config.model)}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </Paper>

        {/* Section 2: Prompt Enhancement System Settings */}
        <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
          <Stack spacing={2.25}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2.5,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: alpha(theme.palette.secondary.main, 0.1),
                  color: 'secondary.main',
                }}
              >
                <SettingsIcon />
              </Box>
              <Box>
                <Typography variant="h6" fontWeight={600}>
                  Prompt Enhancer Settings
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Configure the system prompt used by the prompt enhancement tool.
                </Typography>
              </Box>
            </Stack>

            <Divider />

            {isSettingsLoading ? (
              <Stack alignItems="center" sx={{ py: 5 }}>
                <CircularProgress size={24} />
              </Stack>
            ) : (
              <Box component="form" onSubmit={handlePromptSubmit}>
                <Stack spacing={2}>
                  <Alert severity="info" variant="outlined">
                    This prompt instructs the active AI model on how to improve user task prompts before sending them to agents.
                  </Alert>
                  <TextField
                    label="System Prompt for Prompt Enhancement"
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    placeholder="Enter system prompt..."
                    multiline
                    minRows={6}
                    fullWidth
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button type="submit" variant="contained" startIcon={<SaveIcon />} disabled={isUpdatingPrompt}>
                      Save System Prompt
                    </Button>
                  </Box>
                </Stack>
              </Box>
            )}
          </Stack>
        </Paper>
      </Stack>

      {/* AI Config Modal */}
      <AiConfigModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        configToEdit={editingConfig}
      />
    </>
  );
}
