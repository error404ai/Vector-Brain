import { useGetAgentEngineQuery, useSetAgentEngineMutation, type EngineKind } from '@/RTKService/androidService/engineService';
import MemoryIcon from '@mui/icons-material/Memory';
import { Box, Card, CardContent, Chip, FormControlLabel, LinearProgress, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import toast from 'react-hot-toast';

/**
 * Which engine drives the model on this account's runs. Both use the same
 * tools, prompt, guards and recording; Run diagnostics compares them.
 */
export default function AgentEngineCard() {
  const { data, isLoading } = useGetAgentEngineQuery();
  const [save, { isLoading: saving }] = useSetAgentEngineMutation();
  const settings = data?.data;

  const update = async (body: { engine?: EngineKind | null; planner?: boolean }) => {
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
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
