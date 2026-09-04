import type { AiConfig } from '@/RTKService/aiConfigService/aiConfigService';
import { getModelMeta, isFreeModel, modelDisplayName, providerAccent, sortModelsForDisplay } from '@/utils/modelMeta';
import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  alpha,
  Box,
  Button,
  Chip,
  InputAdornment,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useMemo, useState } from 'react';

interface ModelPickerProps {
  configs: AiConfig[];
  /** 0 means "whichever provider is active". */
  selectedId: number;
  onSelect: (id: number) => void;
  disabled?: boolean;
}

/**
 * Model chooser that sits under the prompt box.
 *
 * Raw ids like "deepseek/deepseek-v4-flash-0731" are hard to scan, so each row
 * leads with a readable name and keeps the id underneath for people who need
 * the exact string.
 */
export default function ModelPicker({ configs, selectedId, onSelect, disabled }: ModelPickerProps) {
  const theme = useTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');

  const activeConfig = configs.find((config) => config.is_active);
  const current = selectedId ? configs.find((config) => config.id === selectedId) : activeConfig;
  const currentMeta = getModelMeta(current?.model);

  const ordered = useMemo(() => sortModelsForDisplay(configs), [configs]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter(
      (config) =>
        config.model.toLowerCase().includes(needle) ||
        modelDisplayName(config.model).toLowerCase().includes(needle) ||
        config.provider.toLowerCase().includes(needle),
    );
  }, [ordered, query]);

  const close = () => {
    setAnchor(null);
    setQuery('');
  };

  if (configs.length === 0) return null;

  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        onClick={(event) => setAnchor(event.currentTarget)}
        endIcon={<KeyboardArrowDownIcon />}
        sx={{
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: 2,
          px: 1.25,
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) },
        }}
      >
        <Box
          component="span"
          sx={{
            width: 18,
            height: 18,
            borderRadius: 1,
            mr: 0.85,
            display: 'grid',
            placeItems: 'center',
            fontSize: 10,
            fontWeight: 900,
            color: 'white',
            bgcolor: providerAccent(current?.provider),
          }}
        >
          {(current?.provider ?? '?').charAt(0).toUpperCase()}
        </Box>
        {current ? modelDisplayName(current.model) : 'Choose model'}
        {currentMeta?.tag === 'recommended' && <StarIcon sx={{ fontSize: 14, ml: 0.6, color: 'success.main' }} />}
        {currentMeta?.tag === 'caution' && <WarningAmberIcon sx={{ fontSize: 14, ml: 0.6, color: 'warning.main' }} />}
      </Button>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 340, borderRadius: 3, mt: -1, overflow: 'hidden' } } }}
      >
        <Box sx={{ p: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Search models…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 17 }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ '& .MuiInputBase-root': { borderRadius: 2, fontSize: 13 } }}
          />
        </Box>

        <Box sx={{ maxHeight: 340, overflowY: 'auto', py: 0.5 }}>
          {/* Follow whatever is active in Settings rather than pinning one model. */}
          <Row
            label="Use the active provider"
            sublabel={activeConfig ? modelDisplayName(activeConfig.model) : 'none set'}
            accent={theme.palette.text.disabled}
            initial="★"
            selected={selectedId === 0}
            onClick={() => {
              onSelect(0);
              close();
            }}
          />

          {filtered.map((config) => {
            const meta = getModelMeta(config.model);
            return (
              <Row
                key={config.id}
                label={modelDisplayName(config.model)}
                sublabel={config.model}
                accent={providerAccent(config.provider)}
                initial={config.provider.charAt(0).toUpperCase()}
                selected={selectedId === config.id}
                free={isFreeModel(config.model)}
                meta={meta}
                onClick={() => {
                  onSelect(config.id);
                  close();
                }}
              />
            );
          })}

          {filtered.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 2 }}>
              No models match that search.
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}

function Row({
  label,
  sublabel,
  accent,
  initial,
  selected,
  free,
  meta,
  onClick,
}: {
  label: string;
  sublabel: string;
  accent: string;
  initial: string;
  selected: boolean;
  free?: boolean;
  meta?: { tag: 'recommended' | 'caution'; note: string } | null;
  onClick: () => void;
}) {
  const theme = useTheme();

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      onClick={onClick}
      sx={{
        px: 1.5,
        py: 1,
        cursor: 'pointer',
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) },
      }}
    >
      <Box
        sx={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          bgcolor: accent,
          color: 'white',
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {initial}
      </Box>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.6}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {label}
          </Typography>
          {meta?.tag === 'recommended' && (
            <Tooltip title={meta.note}>
              <StarIcon sx={{ fontSize: 14, color: 'success.main' }} />
            </Tooltip>
          )}
          {meta?.tag === 'caution' && (
            <Tooltip title={meta.note}>
              <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main' }} />
            </Tooltip>
          )}
          {free && (
            <Chip
              label="FREE"
              size="small"
              sx={{
                height: 16,
                fontSize: 9,
                fontWeight: 800,
                bgcolor: alpha(theme.palette.success.main, 0.14),
                color: 'success.dark',
              }}
            />
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {sublabel}
        </Typography>
      </Box>

      {selected && <CheckIcon sx={{ fontSize: 17, color: 'primary.main' }} />}
    </Stack>
  );
}
