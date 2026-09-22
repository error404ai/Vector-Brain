import type { AiConfig } from '@/RTKService/aiConfigService/aiConfigService';
import {
  useDeleteAiConfigMutation,
  useGetAiConfigsQuery,
  useSetActiveAiConfigMutation,
  useTestSavedAiConfigMutation,
} from '@/RTKService/aiConfigService/aiConfigService';
import { AiConfigModal } from '@/components/ai-config/AiConfigModal';
import StorageCard from '@/components/settings/StorageCard';
import TelegramLinkCard from '@/components/telegram/TelegramLinkCard';
import type { TestOutcome } from '@/components/ai-config/ActiveProviderHero';
import ActiveProviderHero, { isFreeModel } from '@/components/ai-config/ActiveProviderHero';
import { getModelMeta, sortModelsForDisplay } from '@/utils/modelMeta';
import Reveal from '@/components/ui/Reveal';
import PageHeader from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
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
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';

/**
 * The enhancer shapes every task, so its default has to keep prompts tight.
 * Expanding a request into a multi-page research plan is what makes runs
 * exhaust their step budget.
 */
export default function SettingsPage() {
  const theme = useTheme();


  // AI Configurations
  const { data: aiConfigsData, isLoading: isAiConfigsLoading } = useGetAiConfigsQuery();
  const aiConfigs = aiConfigsData?.data || [];

  const [setActiveConfig, { isLoading: isSettingActive }] = useSetActiveAiConfigMutation();
  const [deleteConfig] = useDeleteAiConfigMutation();
  const [testSavedConfig, { isLoading: isTestingSaved }] = useTestSavedAiConfigMutation();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AiConfig | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  // Remembers the last connection test per provider for this visit.
  const [testResults, setTestResults] = useState<Record<number, TestOutcome>>({});


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
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: true, at: Date.now(), detail: `${res.data.latencyMs}ms` },
      }));
      toast.success(`Connected (${res.data.latencyMs}ms)`);
    } catch (err: any) {
      const detail = err?.data?.message || 'Connection test failed';
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, at: Date.now(), detail } }));
      toast.error(detail);
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

  /** Models configured more than once — the free-text label hides these. */
  const duplicateModels = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const config of aiConfigs) counts[config.model] = (counts[config.model] ?? 0) + 1;
    return new Set(Object.keys(counts).filter((model) => counts[model] > 1));
  }, [aiConfigs]);

  const activeConfig = aiConfigs.find((config) => config.is_active);
  // Recommended models first, free models second — cheap to try — then the rest.
  const otherConfigs = sortModelsForDisplay(aiConfigs.filter((config) => !config.is_active));

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
        <Reveal index={0}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            transition: 'border-color 220ms ease, box-shadow 220ms ease',
            '&:hover': {
              borderColor: alpha(theme.palette.primary.main, 0.35),
              boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.08)}`,
            },
          }}
        >
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
                    transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), background-color 260ms ease',
                    '&:hover': { transform: 'scale(1.06) rotate(-4deg)', bgcolor: alpha(theme.palette.primary.main, 0.18) },
                  }}
                >
                  <PsychologyIcon />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    AI Provider Configurations
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {activeConfig
                      ? `Currently active: ${activeConfig.model}`
                      : 'Add your personal API keys (OpenAI, Gemini, Anthropic, DeepSeek, Groq, OpenRouter).'}
                  </Typography>
                </Box>
              </Stack>

              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleOpenAdd}
                sx={{
                  borderRadius: 2,
                  fontWeight: 700,
                  px: 2.25,
                  boxShadow: 'none',
                  transition: 'transform 180ms ease, box-shadow 180ms ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 20px ${alpha(theme.palette.primary.main, 0.35)}`,
                  },
                  '&:active': { transform: 'translateY(0)' },
                  '@media (prefers-reduced-motion: reduce)': { '&:hover': { transform: 'none' } },
                }}
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
              <Stack spacing={2.5}>
                {activeConfig ? (
                  <ActiveProviderHero
                    config={activeConfig}
                    providerColor={getProviderColor(activeConfig.provider)}
                    isDuplicate={duplicateModels.has(activeConfig.model)}
                    testOutcome={testResults[activeConfig.id]}
                    isTesting={testingId === activeConfig.id && isTestingSaved}
                    onTest={handleTestSaved}
                    onEdit={handleOpenEdit}
                  />
                ) : (
                  <Alert severity="warning" variant="outlined">
                    No active provider selected — the agent cannot run tasks. Pick one from the list below.
                  </Alert>
                )}

                {otherConfigs.length > 0 && (
                  <Box>
                    <Typography
                      variant="overline"
                      sx={{ fontWeight: 700, letterSpacing: 1, color: 'text.secondary' }}
                    >
                      Other providers ({otherConfigs.length})
                    </Typography>

                    <Stack spacing={1} sx={{ mt: 0.75 }}>
                      {otherConfigs.map((config, configIndex) => {
                        const providerColor = getProviderColor(config.provider);
                        const isTestingThis = testingId === config.id && isTestingSaved;
                        const outcome = testResults[config.id];
                        const meta = getModelMeta(config.model);

                        return (
                          <Reveal key={config.id} index={configIndex + 1}>
                          <Card
                            variant="outlined"
                            sx={{
                              borderRadius: 2,
                              // 'all' also animates layout properties, which makes
                              // hover feel laggy on a long list; opacity and
                              // transform are the only cheap ones.
                              transition:
                                'border-color 200ms ease, background-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
                              '&:hover': {
                                borderColor: theme.palette.primary.main,
                                bgcolor: alpha(theme.palette.primary.main, 0.03),
                                transform: 'translateY(-2px)',
                                boxShadow: `0 8px 22px ${alpha(theme.palette.primary.main, 0.12)}`,
                              },
                              '@media (prefers-reduced-motion: reduce)': {
                                '&:hover': { transform: 'none' },
                              },
                            }}
                          >
                            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                              <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                justifyContent="space-between"
                                alignItems={{ xs: 'flex-start', sm: 'center' }}
                                gap={1.5}
                              >
                                {/* Left: Info */}
                                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                                  <Tooltip title="Set as active provider">
                                    <span>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleSetActive(config.id)}
                                        disabled={isSettingActive}
                                      >
                                        <RadioButtonUncheckedIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>

                                  <Box sx={{ minWidth: 0 }}>
                                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                                      <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: 'break-word' }}>
                                        {config.model}
                                      </Typography>

                                      {isFreeModel(config.model) && (
                                        <Chip
                                          label="FREE"
                                          size="small"
                                          sx={{
                                            bgcolor: alpha(theme.palette.success.main, 0.14),
                                            color: 'success.dark',
                                            fontWeight: 700,
                                            height: 20,
                                            fontSize: '0.65rem',
                                          }}
                                        />
                                      )}

                                      {meta && (
                                        <Tooltip title={meta.note}>
                                          <Chip
                                            label={meta.tag === 'recommended' ? 'RECOMMENDED' : 'CAUTION'}
                                            size="small"
                                            color={meta.tag === 'recommended' ? 'success' : 'warning'}
                                            variant={meta.tag === 'recommended' ? 'filled' : 'outlined'}
                                            sx={{ height: 20, fontSize: '0.6rem', fontWeight: 800 }}
                                          />
                                        </Tooltip>
                                      )}

                                      {config.label && config.label !== config.model && (
                                        <Chip
                                          label={config.label}
                                          size="small"
                                          variant="outlined"
                                          sx={{ height: 20, fontSize: '0.65rem', maxWidth: 180 }}
                                        />
                                      )}

                                      {duplicateModels.has(config.model) && (
                                        <Tooltip title="Another entry uses the same model">
                                          <Chip
                                            label="DUPLICATE"
                                            size="small"
                                            color="warning"
                                            variant="outlined"
                                            sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }}
                                          />
                                        </Tooltip>
                                      )}

                                      <Chip
                                        label={config.provider.toUpperCase()}
                                        size="small"
                                        sx={{
                                          bgcolor: alpha(providerColor, 0.12),
                                          color: providerColor,
                                          fontWeight: 600,
                                          height: 20,
                                          fontSize: '0.65rem',
                                        }}
                                      />

                                      <Chip
                                        icon={config.config_type === 'vision' ? <VisibilityIcon fontSize="inherit" /> : <SmartToyIcon fontSize="inherit" />}
                                        label={config.config_type === 'vision' ? 'Vision' : 'Text-Only'}
                                        size="small"
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.65rem' }}
                                      />
                                    </Stack>

                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 0.25 }}>
                                      {config.base_url && (
                                        <Typography variant="caption" color="text.secondary">
                                          {config.base_url}
                                        </Typography>
                                      )}
                                      {outcome ? (
                                        <Typography
                                          variant="caption"
                                          sx={{ fontWeight: 700, color: outcome.ok ? 'success.main' : 'error.main' }}
                                        >
                                          {outcome.ok ? `Tested OK · ${outcome.detail}` : `Test failed · ${outcome.detail}`}
                                        </Typography>
                                      ) : (
                                        <Typography variant="caption" color="text.disabled">
                                          Not tested this session
                                        </Typography>
                                      )}
                                    </Stack>
                                  </Box>
                                </Stack>

                                {/* Right: Actions */}
                                <Stack direction="row" spacing={0.75} alignItems="center" alignSelf={{ xs: 'flex-end', sm: 'center' }}>
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
                          </Reveal>
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>
        </Reveal>

        {/* Section 2: Telegram bot */}
        <Reveal index={1}>
          <TelegramLinkCard />
        </Reveal>

        <Reveal>
          <StorageCard />
        </Reveal>
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
