import type { AiConfig } from '@/RTKService/aiConfigService/aiConfigService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';

/** Result of the last connection test run this session. */
export interface TestOutcome {
  ok: boolean;
  at: number;
  detail: string;
}

/** OpenRouter marks free-tier models with a ":free" suffix in the model id. */
export function isFreeModel(model: string): boolean {
  return model.toLowerCase().includes(':free');
}

interface ActiveProviderHeroProps {
  config: AiConfig;
  providerColor: string;
  isDuplicate: boolean;
  testOutcome: TestOutcome | undefined;
  isTesting: boolean;
  onTest: (id: number) => void;
  onEdit: (config: AiConfig) => void;
}

/**
 * Prominent card for the provider currently driving the agent.
 * Deliberately has no delete action: removing the active provider
 * mid-task is the one destructive click we never want to invite.
 */
export default function ActiveProviderHero({
  config,
  providerColor,
  isDuplicate,
  testOutcome,
  isTesting,
  onTest,
  onEdit,
}: ActiveProviderHeroProps) {
  const theme = useTheme();
  const free = isFreeModel(config.model);

  let statusBg = alpha(theme.palette.warning.main, 0.1);
  let statusColor = theme.palette.warning.dark;
  let statusIcon = <WarningAmberRoundedIcon fontSize="small" />;
  let statusText = 'Untested this session — run a test before starting tasks';

  if (isTesting) {
    statusBg = alpha(theme.palette.info.main, 0.08);
    statusColor = theme.palette.info.dark;
    statusIcon = <CircularProgress size={16} />;
    statusText = 'Testing connection…';
  } else if (testOutcome?.ok) {
    statusBg = alpha(theme.palette.success.main, 0.1);
    statusColor = theme.palette.success.dark;
    statusIcon = <CheckCircleIcon fontSize="small" />;
    statusText = `Connected · ${testOutcome.detail}`;
  } else if (testOutcome && !testOutcome.ok) {
    statusBg = alpha(theme.palette.error.main, 0.08);
    statusColor = theme.palette.error.dark;
    statusIcon = <ErrorOutlineIcon fontSize="small" />;
    statusText = `Test failed · ${testOutcome.detail}`;
  }

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 3,
        borderLeft: `4px solid ${theme.palette.primary.main}`,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(
          theme.palette.primary.main,
          0.02,
        )} 65%, transparent 100%)`,
        boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.14)}`,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Stack spacing={1.75}>
        {/* Top row: pulse + ACTIVE + actions */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1.5} flexWrap="wrap">
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: 'success.main',
                animation: 'vbActivePulse 1.8s ease-in-out infinite',
                '@keyframes vbActivePulse': {
                  '0%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.5)}` },
                  '70%': { boxShadow: `0 0 0 9px ${alpha(theme.palette.success.main, 0)}` },
                  '100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0)}` },
                },
              }}
            />
            <Typography
              variant="overline"
              sx={{ fontWeight: 800, letterSpacing: 1.2, color: 'primary.main', lineHeight: 1 }}
            >
              Active Provider
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="contained"
              startIcon={isTesting ? <CircularProgress size={14} color="inherit" /> : <FlashOnIcon />}
              onClick={() => onTest(config.id)}
              disabled={isTesting}
              sx={{ borderRadius: 2 }}
            >
              Test
            </Button>
            <Tooltip title="Edit configuration">
              <IconButton size="small" onClick={() => onEdit(config)}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* Model identity */}
        <Box>
          <Typography variant="h5" fontWeight={800} sx={{ wordBreak: 'break-word', lineHeight: 1.25 }}>
            {config.model}
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            <Chip
              label={config.provider.toUpperCase()}
              size="small"
              sx={{
                bgcolor: alpha(providerColor, 0.14),
                color: providerColor,
                fontWeight: 700,
                height: 22,
                fontSize: '0.7rem',
              }}
            />
            {free && (
              <Chip
                label="FREE"
                size="small"
                sx={{
                  bgcolor: alpha(theme.palette.success.main, 0.14),
                  color: 'success.dark',
                  fontWeight: 700,
                  height: 22,
                  fontSize: '0.7rem',
                }}
              />
            )}
            <Chip
              icon={config.config_type === 'vision' ? <VisibilityIcon fontSize="inherit" /> : <SmartToyIcon fontSize="inherit" />}
              label={config.config_type === 'vision' ? 'Vision' : 'Text-Only'}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
            {config.label && config.label !== config.model && (
              <Chip
                label={config.label}
                size="small"
                variant="outlined"
                sx={{ height: 22, fontSize: '0.7rem', maxWidth: 220 }}
              />
            )}
            {isDuplicate && (
              <Tooltip title="Another entry uses the same model">
                <Chip
                  label="DUPLICATE"
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.65rem', fontWeight: 700 }}
                />
              </Tooltip>
            )}
          </Stack>

          {config.base_url && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {config.base_url}
            </Typography>
          )}
        </Box>

        {/* Test status strip */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            borderRadius: 2,
            px: 1.5,
            py: 1,
            bgcolor: statusBg,
            color: statusColor,
          }}
        >
          {statusIcon}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {statusText}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
