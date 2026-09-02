import type { AiConfig } from '@/RTKService/aiConfigService/aiConfigService';
import type { AndroidAgentTask, AndroidDevice } from '@/RTKService/androidService/androidService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { alpha, Box, Button, LinearProgress, Paper, Stack, Typography, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface OnboardingChecklistProps {
  devices: AndroidDevice[];
  aiConfigs: AiConfig[];
  tasks: AndroidAgentTask[];
  /** Hide while the underlying queries are still loading to avoid a flash. */
  loading?: boolean;
  /** Setup-mode presentation: welcome heading, centered, roomier. */
  hero?: boolean;
}

interface ChecklistStep {
  label: string;
  detail: string;
  done: boolean;
  actionLabel: string;
  actionPath: string;
}

/**
 * New-user setup journey derived from live data — no stored "dismissed" flag
 * needed because the card disappears on its own once every step is real.
 */
export default function OnboardingChecklist({ devices, aiConfigs, tasks, loading, hero }: OnboardingChecklistProps) {
  const theme = useTheme();
  const navigate = useNavigate();

  const hasDevice = devices.length > 0;
  const hasReadyDevice = devices.some(
    (device) => device.capabilities?.accessibility === true && device.capabilities?.screenCapture === true,
  );
  const hasKey = aiConfigs.length > 0;
  const hasActiveModel = aiConfigs.some((config) => config.is_active);
  const hasFirstRun = tasks.length > 0;

  const steps: ChecklistStep[] = [
    {
      label: 'Pair your Android phone',
      detail: 'Install the companion APK on the phone and pair it with this account.',
      done: hasDevice,
      actionLabel: 'Pair device',
      actionPath: '/android-devices',
    },
    {
      label: 'Enable phone services',
      detail: 'Turn on the Accessibility service and screen capture inside the companion app.',
      done: hasReadyDevice,
      actionLabel: 'Check device',
      actionPath: '/android-devices',
    },
    {
      label: 'Add your API key',
      detail: 'Bring your own key — OpenRouter, OpenAI, Gemini, DeepSeek, Groq or Anthropic.',
      done: hasKey,
      actionLabel: 'Add key',
      actionPath: '/settings',
    },
    {
      label: 'Activate a model',
      detail: 'Pick which model drives the agent. Look for the RECOMMENDED chip.',
      done: hasActiveModel,
      actionLabel: 'Choose model',
      actionPath: '/settings',
    },
    {
      label: 'Run your first task',
      detail: 'Try a starter suggestion like "Open Chrome and go to google.com".',
      done: hasFirstRun,
      actionLabel: 'Open agent',
      actionPath: '/android-agent',
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;

  // Fully set up (or still loading) — the card has nothing useful to say.
  if (loading || doneCount === steps.length) return null;

  return (
    <Paper
      sx={{
        p: { xs: 2, md: hero ? 3.5 : 2.5 },
        borderRadius: 3,
        borderLeft: `4px solid ${theme.palette.primary.main}`,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.07)} 0%, transparent 70%)`,
      }}
    >
      <Stack spacing={hero ? 2.5 : 1.75}>
        {hero ? (
          <Box sx={{ textAlign: 'center' }}>
            <RocketLaunchIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h5" sx={{ fontWeight: 900 }}>
              Welcome to Vector Brain
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Five quick steps and your phone starts working for you.
            </Typography>
          </Box>
        ) : (
          <Stack direction="row" alignItems="center" spacing={1}>
            <RocketLaunchIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, flexGrow: 1 }}>
              Getting started
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main' }}>
              {doneCount} / {steps.length}
            </Typography>
          </Stack>
        )}

        <Box>
          {hero && (
            <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main', display: 'block', mb: 0.5 }}>
              {doneCount} of {steps.length} complete
            </Typography>
          )}
          <LinearProgress
            variant="determinate"
            value={(doneCount / steps.length) * 100}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>

        <Stack spacing={hero ? 1.5 : 1}>
          {steps.map((step, index) => (
            <Stack
              key={step.label}
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{
                opacity: step.done ? 0.6 : 1,
                ...(hero && {
                  p: 1.25,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: step.done ? 'transparent' : alpha(theme.palette.primary.main, 0.15),
                  bgcolor: step.done ? 'transparent' : alpha(theme.palette.background.paper, 0.7),
                }),
              }}
            >
              {step.done ? (
                <CheckCircleIcon color="success" sx={{ fontSize: 22 }} />
              ) : (
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: 'primary.main',
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </Box>
              )}
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, textDecoration: step.done ? 'line-through' : 'none' }}
                >
                  {step.label}
                </Typography>
                {!step.done && (
                  <Typography variant="caption" color="text.secondary">
                    {step.detail}
                  </Typography>
                )}
              </Box>
              {!step.done && (
                <Button
                  size="small"
                  variant={hero && steps.findIndex((item) => !item.done) === index ? 'contained' : 'outlined'}
                  onClick={() => navigate(step.actionPath)}
                  sx={{ borderRadius: 2, fontWeight: 700, flexShrink: 0 }}
                >
                  {step.actionLabel}
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
