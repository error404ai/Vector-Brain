import { useGetFlowSettingsQuery, useSetFlowSettingsMutation, type FlowSettings } from '@/RTKService/flowService/flowService';
import BoltIcon from '@mui/icons-material/Bolt';
import { Box, Card, CardContent, LinearProgress, Stack, Switch, Typography } from '@mui/material';
import { monoLabel, PRISM_ACCENT, PRISM_INK, PRISM_MUTED, PRISM_PINK, prismSwitch, sectionTitle } from './settingsStyle';
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

  const on = settings ? ROWS.filter((row) => settings[row.key] && !(row.needs && !settings[row.needs])).length : 0;

  return (
    <Card id="saved-flows" variant="outlined" sx={{ borderRadius: 3, scrollMarginTop: 88 }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" gap={1.5} sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <BoltIcon fontSize="small" sx={{ color: PRISM_PINK }} />
              <Typography component="h2" sx={sectionTitle}>
                Saved flows
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: PRISM_MUTED, mt: 0.5 }}>
              Repeat tasks without paying for the AI every time. All off by default; turn them on one by one.
            </Typography>
          </Box>
          {settings ? (
            <Box sx={{ textAlign: 'right', flex: 'none' }}>
              <Typography
                sx={{
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  background: `linear-gradient(90deg, ${PRISM_ACCENT}, ${PRISM_PINK})`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {on}/4
              </Typography>
              <Typography sx={monoLabel}>On</Typography>
            </Box>
          ) : null}
        </Stack>
        {isLoading || !settings ? (
          <LinearProgress sx={{ borderRadius: 2 }} />
        ) : (
          <Stack spacing={0.75}>
            {ROWS.map((row) => {
              const blocked = row.needs ? !settings[row.needs] : false;
              const active = settings[row.key] && !blocked;
              const id = `flow-setting-${row.key}`;
              return (
                <Stack
                  key={row.key}
                  direction="row"
                  alignItems="center"
                  gap={1.5}
                  sx={{
                    px: 1.75,
                    py: 1.5,
                    borderRadius: '16px',
                    opacity: blocked ? 0.5 : 1,
                    background: active ? `linear-gradient(90deg, ${PRISM_ACCENT}14, rgba(236,72,153,.06))` : 'transparent',
                    transition: 'background 300ms ease',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography component="label" htmlFor={id} variant="body2" sx={{ fontWeight: 700, display: 'block', color: PRISM_INK, cursor: blocked ? 'default' : 'pointer' }}>
                      {row.title}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: PRISM_MUTED, lineHeight: 1.45 }}>
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
                    sx={prismSwitch}
                  />
                </Stack>
              );
            })}
          </Stack>
        )}
        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: PRISM_MUTED }}>
          A replayed flow is always checked step by step and at the end; a flow that ran but whose result does not check out is reported as failed, not done.
        </Typography>
      </CardContent>
    </Card>
  );
}
