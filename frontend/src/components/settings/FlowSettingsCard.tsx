import { useGetFlowSettingsQuery, useSetFlowSettingsMutation, type FlowSettings } from '@/RTKService/flowService/flowService';
import BoltIcon from '@mui/icons-material/Bolt';
import { Box, Card, CardContent, Divider, LinearProgress, Stack, Switch, Typography } from '@mui/material';
import toast from 'react-hot-toast';

interface Row {
  key: keyof FlowSettings;
  title: string;
  help: string;
  /** Only does something when this other switch is on. */
  needs?: keyof FlowSettings;
}

const ROWS: Row[] = [
  {
    key: 'record',
    title: 'Save successful tasks as flows',
    help: 'Each task that finishes and passes its check is kept as a flow: the steps that worked, with what each screen should show. Typed text is kept only when it is part of the task’s wording — never passwords or codes.',
  },
  {
    key: 'replay_first',
    title: 'Use a saved flow first',
    help: 'When a task matches a saved flow, the phone replays it with no AI. Each step checks it is on the right screen and finds the button by its label, not its old position. In a mission, one phone runs first and the others replay its flow.',
  },
  {
    key: 'ai_repair',
    title: 'When a step breaks, the AI fixes that step only',
    help: 'The AI gets just the broken step, and the flow carries on as soon as the phone is back on track. Off: when a step breaks, the AI finishes the whole task from there.',
    needs: 'replay_first',
  },
  {
    key: 'share_fixes',
    title: 'Use step fixes on my other phones',
    help: 'Off: a fix the AI made is reused only on the phone it came from. On: your other phones try it before asking the AI, and it becomes part of the flow once it has worked 3 times on at least 2 phone models — undone again if the flow then fails twice in a row.',
    needs: 'ai_repair',
  },
];

/** Settings → Saved flows: the account's four switches (docs/REPLAY_ENGINE.md). */
export default function FlowSettingsCard() {
  const { data, isLoading } = useGetFlowSettingsQuery();
  const [save, { isLoading: saving }] = useSetFlowSettingsMutation();
  const settings = data?.data;

  const toggle = async (key: keyof FlowSettings, value: boolean) => {
    try {
      await save({ [key]: value }).unwrap();
      toast.success('Saved — applies to the next run');
    } catch {
      toast.error('Could not save');
    }
  };

  return (
    <Card id="saved-flows" variant="outlined" sx={{ borderRadius: 3, scrollMarginTop: 80 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
          <BoltIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Saved flows
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Repeat tasks without paying for the AI every time. All off by default; turn them on one by one.
        </Typography>
        {isLoading || !settings ? (
          <LinearProgress sx={{ borderRadius: 2 }} />
        ) : (
          <Stack divider={<Divider flexItem />} spacing={1.25}>
            {ROWS.map((row) => {
              const blocked = row.needs ? !settings[row.needs] : false;
              const id = `flow-setting-${row.key}`;
              return (
                <Stack key={row.key} direction="row" alignItems="flex-start" gap={1.5} sx={{ opacity: blocked ? 0.55 : 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography component="label" htmlFor={id} variant="body2" sx={{ fontWeight: 700, display: 'block', cursor: blocked ? 'default' : 'pointer' }}>
                      {row.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {row.help}
                      {blocked ? ` Needs “${ROWS.find((r) => r.key === row.needs)?.title}”.` : ''}
                    </Typography>
                  </Box>
                  <Switch
                    id={id}
                    checked={settings[row.key]}
                    disabled={saving || blocked}
                    onChange={(_, value) => void toggle(row.key, value)}
                    inputProps={{ 'aria-label': row.title }}
                  />
                </Stack>
              );
            })}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          A replayed flow is always checked step by step and at the end; a flow that ran but whose result does not check out is reported as failed, not done.
        </Typography>
      </CardContent>
    </Card>
  );
}
