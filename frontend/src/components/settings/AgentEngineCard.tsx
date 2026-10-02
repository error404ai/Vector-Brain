import { useEffect } from 'react';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import { useGetAgentEngineQuery, useSetAgentEngineMutation, type EngineKind, type ScreenshotMode } from '@/RTKService/androidService/engineService';
import { isFreeModel } from '@/utils/modelMeta';
import MemoryIcon from '@mui/icons-material/Memory';
import { Alert, Box, Card, CardContent, Chip, FormControlLabel, LinearProgress, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import toast from 'react-hot-toast';

const SCREENSHOT_HELP: Record<ScreenshotMode, string> = {
  stuck:
    'The AI works from the list of on-screen elements, and is shown a screenshot when it gets stuck: going back and forth, or actions that change nothing. Good results at little extra cost.',
  every_step:
    'The AI sees a screenshot after every action as well as the element list. Best understanding of icons and web pages; each step costs roughly 10–15% more.',
  off: 'Screenshots only on screens the element list cannot describe at all. Cheapest; the AI can miss unlabelled icons.',
};

/**
 * Which engine drives the model on this account's runs. Both use the same
 * tools, prompt, guards and recording; Run diagnostics compares them.
 */
export default function AgentEngineCard() {
  // Mission Control's "Add vision helper" links here: bring the card into view.
  useEffect(() => {
    if (window.location.hash !== '#agent-engine') return;
    const timer = setTimeout(() => document.getElementById('agent-engine')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(timer);
  }, []);
  const { data, isLoading } = useGetAgentEngineQuery();
  const [save, { isLoading: saving }] = useSetAgentEngineMutation();
  const settings = data?.data;
  const { data: configsData } = useGetAiConfigsQuery();
  const configs = configsData?.data ?? [];
  const active = configs.find((c) => c.is_active);
  const others = configs.filter((c) => !c.is_active);

  const update = async (body: { engine?: EngineKind | null; planner?: boolean; vision_config_id?: number | null; fallback_config_id?: number | null; screenshots?: ScreenshotMode | null }) => {
    try {
      await save(body).unwrap();
      toast.success('Saved — applies to the next run');
    } catch {
      toast.error('Could not save');
    }
  };

  return (
    <Card id="agent-engine" variant="outlined" sx={{ borderRadius: 3, scrollMarginTop: 80 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
          <MemoryIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Agent engine
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {settings?.source === 'server' ? <Chip size="small" variant="outlined" label="Server default" /> : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          How the AI is driven on your phones. Both engines use the same tools and safety checks; switch any time — it applies to the next run.
        </Typography>
        {isLoading || !settings ? (
          <LinearProgress sx={{ borderRadius: 2 }} />
        ) : (
          <Stack spacing={1.5}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={settings.kind}
              disabled={saving}
              onChange={(_, value: EngineKind | null) => value && value !== settings.kind && void update({ engine: value })}
              aria-label="Agent engine"
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value="eko">Eko (stable)</ToggleButton>
              <ToggleButton value="vector">Vector (beta)</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              {settings.kind === 'eko'
                ? 'Eko: a planning call first, then step by step; long runs are compressed with extra AI calls.'
                : 'Vector: acts from the first call, keeps history within a token budget without extra calls, finishes with task_done and a system check of the phone.'}
            </Typography>
            {settings.kind === 'vector' ? (
              <FormControlLabel
                control={<Switch checked={settings.planner} disabled={saving} onChange={(e) => void update({ planner: e.target.checked })} />}
                label={
                  <Box>
                    <Typography variant="body2">Plan before acting</Typography>
                    <Typography variant="caption" color="text.secondary">
                      One extra AI call per run that writes a short plan and shows it on the task card.
                    </Typography>
                  </Box>
                }
              />
            ) : null}

            <TextField
              select
              size="small"
              label="Screenshots to the AI"
              value={settings.screenshots ?? 'stuck'}
              disabled={saving}
              onChange={(e) => void update({ screenshots: e.target.value as ScreenshotMode })}
              helperText={SCREENSHOT_HELP[settings.screenshots ?? 'stuck']}
            >
              <MenuItem value="stuck">When it gets stuck (recommended)</MenuItem>
              <MenuItem value="every_step">Every step</MenuItem>
              <MenuItem value="off">Off</MenuItem>
            </TextField>
            {active && active.sees_images === false ? (
              <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
                Your main model, {active.label || active.model}, cannot read screenshots itself. Choose a model marked “Sees screenshots”, or set a
                Screen reader below to read them for it.
              </Alert>
            ) : null}

            <TextField
              select
              size="small"
              label="Backup model"
              value={settings.fallback_config_id ?? ''}
              disabled={saving}
              onChange={(e) => void update({ fallback_config_id: e.target.value === '' ? null : Number(e.target.value) })}
              helperText="Takes over for the rest of a run when the main model is rate-limited or has used up its daily limit, instead of the run failing."
            >
              <MenuItem value="">None</MenuItem>
              {others.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.label || c.model}
                  {isFreeModel(c.model) ? ' — free, has a daily cap' : ''}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Screen reader (vision model)"
              value={settings.vision_config_id ?? ''}
              disabled={saving}
              onChange={(e) => void update({ vision_config_id: e.target.value === '' ? null : Number(e.target.value) })}
              helperText="For a main model marked “Text only”: on screens the element list cannot describe — web pages, Play Store, apps with unlabelled buttons — and when the AI gets stuck, this model reads a screenshot so the agent taps real buttons instead of guessing. Pick a small, cheap model marked “Sees screenshots”. Not used when the main model sees screenshots itself."
            >
              <MenuItem value="">None</MenuItem>
              {configs.map((c) => (
                <MenuItem key={c.id} value={c.id} disabled={c.sees_images === false}>
                  {c.label || c.model}
                  {c.sees_images === false ? ' — cannot read screenshots' : ''}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
