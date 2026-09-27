import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import { useGetAgentEngineQuery, useSetAgentEngineMutation, type EngineKind } from '@/RTKService/androidService/engineService';
import { isFreeModel } from '@/utils/modelMeta';
import MemoryIcon from '@mui/icons-material/Memory';
import { Box, Card, CardContent, Chip, FormControlLabel, LinearProgress, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import toast from 'react-hot-toast';

/**
 * Which engine drives the model on this account's runs. Both use the same
 * tools, prompt, guards and recording; Run diagnostics compares them.
 */
export default function AgentEngineCard() {
  const { data, isLoading } = useGetAgentEngineQuery();
  const [save, { isLoading: saving }] = useSetAgentEngineMutation();
  const settings = data?.data;
  const { data: configsData } = useGetAiConfigsQuery();
  const configs = configsData?.data ?? [];
  const active = configs.find((c) => c.is_active);
  const others = configs.filter((c) => !c.is_active);

  const update = async (body: { engine?: EngineKind | null; planner?: boolean; vision_config_id?: number | null; fallback_config_id?: number | null }) => {
    try {
      await save(body).unwrap();
      toast.success('Saved — applies to the next run');
    } catch {
      toast.error('Could not save');
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
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
              helperText={`For a main model that cannot see images${active ? ` (like ${active.model})` : ''}: on screens the element list cannot describe — web pages, Play Store, apps with unlabelled buttons — this model reads a screenshot so the agent taps real buttons instead of guessing. Pick a small, cheap vision model (e.g. a Gemini Flash or GPT-4o-mini class model). Ignored when the main model already sees images.`}
            >
              <MenuItem value="">None</MenuItem>
              {configs.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.label || c.model}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
