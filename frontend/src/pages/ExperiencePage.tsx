import type { Lesson, LessonKind, LessonStatus } from '@/RTKService/experienceService/experienceService';
import {
  useDeleteLessonMutation,
  useGetExperienceQuery,
  useSaveExperienceSettingsMutation,
  useTeachLessonMutation,
  useUpdateLessonMutation,
} from '@/RTKService/experienceService/experienceService';
import PageHeader from '@/components/ui/PageHeader';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, keyframes, type Theme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

const rise = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
const grow = keyframes`from { transform: scaleX(0); }`;
const drift = keyframes`to { transform: translate(40px, 30px) scale(1.08); }`;

const KINDS: { key: LessonKind; label: string; hint: string }[] = [
  { key: 'path', label: 'Path', hint: 'The way to reach something' },
  { key: 'avoid', label: 'Avoid', hint: 'A dead end to skip' },
  { key: 'widget', label: 'Widget', hint: 'How a control or pop-up works' },
  { key: 'behave', label: 'Behaviour', hint: 'How the site behaves' },
  { key: 'limit', label: 'Limit', hint: 'A field rule' },
  { key: 'field', label: 'Field', hint: 'Which field is which' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;

function kindColor(theme: Theme, kind: string): string {
  const p = theme.palette;
  return (
    { path: p.primary.main, avoid: p.error.main, widget: '#8b5cf6', behave: p.info.main, limit: p.warning.main, field: p.success.main } as Record<string, string>
  )[kind] ?? p.text.secondary;
}

/** A site's mark: its first letter on a colour taken from its name. */
function scopeMark(scope: string) {
  const isApp = !/\.[a-z]{2,}$/.test(scope) || scope.split('.').length > 3;
  const word = isApp ? scope.split('.').filter((p) => !['com', 'android', 'app', 'google', 'org'].includes(p))[0] ?? scope : scope.split('.')[0];
  let h = 0;
  for (const c of scope) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { letter: (word[0] ?? '?').toUpperCase(), hue: h, isApp };
}

function Mark({ scope, size = 32 }: { scope: string; size?: number }) {
  const m = scopeMark(scope);
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: `${Math.round(size / 3.4)}px`,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontWeight: 800,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${m.hue} 75% 55%), hsl(${(m.hue + 40) % 360} 70% 45%))`,
        boxShadow: `0 6px 16px -8px hsl(${m.hue} 75% 45%)`,
      }}
    >
      {m.letter}
    </Box>
  );
}

function StatusLabel({ status }: { status: LessonStatus }) {
  const color = status === 'trusted' ? 'success.main' : status === 'candidate' ? 'warning.main' : 'text.disabled';
  if (status === 'unverified') {
    return (
      <Tooltip title="Learned by a run that did not succeed. The agent does not see it until a successful run teaches the same.">
        <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
          ◌ Unverified
        </Typography>
      </Tooltip>
    );
  }
  return (
    <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color, display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
      {status === 'trusted' ? '● Trusted' : status === 'candidate' ? '◐ Learning' : '○ Off'}
    </Typography>
  );
}

function KindChip({ kind }: { kind: string }) {
  const theme = useTheme();
  const c = kindColor(theme, kind);
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.4,
        borderRadius: 1.5,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: c,
        bgcolor: alpha(c, 0.12),
        '&::before': { content: '""', width: 6, height: 6, borderRadius: '50%', bgcolor: c },
      }}
    >
      {kindLabel(kind)}
    </Box>
  );
}

function HelpBar({ helped, hurt }: { helped: number; hurt: number }) {
  const total = Math.max(helped + hurt, 8);
  return (
    <Box title={`Helped ${helped} · Hurt ${hurt}`} sx={{ width: 110, height: 6, borderRadius: 99, bgcolor: 'action.hover', overflow: 'hidden', display: 'flex' }}>
      <Box sx={{ width: `${(helped / total) * 100}%`, bgcolor: 'success.main', transformOrigin: 'left', animation: `${grow} 800ms cubic-bezier(.2,.8,.2,1) both` }} />
      <Box sx={{ width: `${(hurt / total) * 100}%`, bgcolor: 'error.main', transformOrigin: 'left', animation: `${grow} 800ms cubic-bezier(.2,.8,.2,1) both` }} />
    </Box>
  );
}

interface Draft {
  id?: number;
  scope: string;
  kind: LessonKind;
  text: string;
}

function LessonDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [value, setValue] = useState<Draft | null>(draft);
  const [teach, { isLoading: teaching }] = useTeachLessonMutation();
  const [update, { isLoading: updating }] = useUpdateLessonMutation();
  if (!value) return null;
  const save = async () => {
    try {
      if (value.id) await update({ id: value.id, scope: value.scope, kind: value.kind, text: value.text }).unwrap();
      else await teach({ scope: value.scope, kind: value.kind, text: value.text }).unwrap();
      toast.success(value.id ? 'Lesson saved' : 'Lesson added. It is trusted at once.');
      onClose();
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not save the lesson');
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>{value.id ? 'Edit lesson' : 'Teach a lesson'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField id="lesson-scope" label="Site or app" placeholder="blogger.com or com.instagram.android" value={value.scope} onChange={(e) => setValue({ ...value, scope: e.target.value })} fullWidth />
        <TextField id="lesson-kind" select label="Type" value={value.kind} onChange={(e) => setValue({ ...value, kind: e.target.value as LessonKind })} fullWidth>
          {KINDS.map((k) => (
            <MenuItem key={k.key} value={k.key}>
              {k.label} · {k.hint}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          id="lesson-text"
          label="Lesson"
          placeholder="New blog: Main menu → blog name dropdown → New Blog..."
          value={value.text}
          onChange={(e) => setValue({ ...value, text: e.target.value })}
          multiline
          minRows={2}
          inputProps={{ maxLength: 200 }}
          helperText={`${value.text.length}/200 · no emails, passwords or codes`}
          fullWidth
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={teaching || updating || value.text.trim().length < 8 || !value.scope.trim()} onClick={() => void save()}>
          {value.id ? 'Save' : 'Add lesson'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function LessonCard({ lesson, index, onEdit }: { lesson: Lesson; index: number; onEdit: () => void }) {
  const theme = useTheme();
  const c = kindColor(theme, lesson.kind);
  const [update] = useUpdateLessonMutation();
  const [remove] = useDeleteLessonMutation();
  const [confirming, setConfirming] = useState(false);
  const on = lesson.status === 'trusted' || lesson.status === 'candidate';
  return (
    <Card
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        opacity: on ? 1 : 0.62,
        animation: `${rise} 420ms cubic-bezier(.2,.8,.2,1) ${Math.min(index, 10) * 50}ms both`,
        transition: 'border-color 200ms, box-shadow 200ms, opacity 200ms',
        '&:hover': { borderColor: alpha(c, 0.5), boxShadow: `0 12px 30px -20px ${c}` },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <KindChip kind={lesson.kind} />
        <StatusLabel status={lesson.status} />
        {lesson.source === 'user' && <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>· Taught by you</Typography>}
        {lesson.avoid_url && (
          <Tooltip title="The agent is not allowed to open this address">
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'error.main' }}>· Blocked address</Typography>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Edit">
          <IconButton size="small" onClick={onEdit} aria-label="Edit lesson">
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {confirming ? (
          <Stack direction="row" spacing={0.5}>
            <Button size="small" color="error" onClick={() => void remove(lesson.id).unwrap().catch(() => toast.error('Could not delete it'))}>
              Delete
            </Button>
            <Button size="small" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </Stack>
        ) : (
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => setConfirming(true)} aria-label="Delete lesson">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={on ? 'In use: the agent sees it' : 'Off: the agent does not see it'}>
          <Switch
            size="small"
            checked={on}
            onChange={(e) => void update({ id: lesson.id, status: e.target.checked ? 'trusted' : 'off' }).unwrap().catch(() => toast.error('Could not change it'))}
            inputProps={{ 'aria-label': 'Lesson in use' }}
          />
        </Tooltip>
      </Stack>
      <Typography sx={{ fontWeight: 650, fontSize: 15, lineHeight: 1.45 }}>{lesson.text}</Typography>
      {lesson.off_reason && lesson.status === 'off' && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{lesson.off_reason}</Typography>}
      <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap sx={{ color: 'text.secondary', fontSize: 12 }}>
        <span>
          Helped <b style={{ fontVariantNumeric: 'tabular-nums' }}>{lesson.helped}</b> · Hurt <b style={{ fontVariantNumeric: 'tabular-nums' }}>{lesson.hurt}</b> · Shown in{' '}
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{lesson.uses}</b> runs
        </span>
        <HelpBar helped={lesson.helped} hurt={lesson.hurt} />
        {lesson.helped + lesson.hurt > 0 && (
          <Tooltip title="Start Helped and Hurt again from 0, for a lesson blamed for runs it had no part in">
            <Button
              size="small"
              onClick={() =>
                void update({ id: lesson.id, reset_score: true })
                  .unwrap()
                  .then(() => toast.success('Score reset'))
                  .catch(() => toast.error('Could not reset it'))
              }
              sx={{ textTransform: 'none', minWidth: 0, px: 0.75, py: 0, fontSize: 12 }}
            >
              Reset score
            </Button>
          </Tooltip>
        )}
        {lesson.evidence.length > 0 && (
          <span>
            From run{lesson.evidence.length > 1 ? 's' : ''}{' '}
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{lesson.evidence.slice(-3).map((id) => `#${id}`).join(', ')}</b>
          </span>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Experience memory: what the account's runs learned about each site and app.
 * Lessons are shown to the agent when a run reaches their site; the page lets
 * the user read, correct, switch off and add them.
 */
export default function ExperiencePage() {
  const theme = useTheme();
  const { data, isLoading } = useGetExperienceQuery(undefined, { pollingInterval: 60_000 });
  const [saveSettings] = useSaveExperienceSettingsMutation();
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<'lessons' | 'runs'>('lessons');
  const [show, setShow] = useState<'use' | 'unverified' | 'off' | 'all'>('use');
  const [dialog, setDialog] = useState<Draft | null>(null);
  const ov = data?.data;
  const scope = picked ?? ov?.scopes[0]?.scope ?? null;
  const lessons = useMemo(
    () =>
      (ov?.lessons ?? []).filter(
        (l) => l.scope === scope && (show === 'all' || (show === 'use' ? l.status === 'trusted' || l.status === 'candidate' : l.status === show)),
      ),
    [ov, scope, show],
  );

  const toggle = (key: 'enabled' | 'learn', value: boolean) =>
    void saveSettings({ [key]: value })
      .unwrap()
      .then(() => toast.success(key === 'enabled' ? (value ? 'The agent uses lessons again' : 'The agent no longer sees lessons') : value ? 'Runs add lessons again' : 'Runs no longer add lessons'))
      .catch(() => toast.error('Could not change it'));

  const stats = ov?.stats;
  const helpedPct = stats && stats.runs_with_memory_week ? Math.round((100 * stats.runs_helped_week) / stats.runs_with_memory_week) : null;

  return (
    <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box aria-hidden sx={{ position: 'absolute', inset: '-40px -16px auto', height: 320, overflow: 'hidden', zIndex: -1, pointerEvents: 'none' }}>
        {[theme.palette.primary.main, '#8b5cf6', theme.palette.success.main].map((c, i) => (
          <Box
            key={c}
            sx={{
              position: 'absolute',
              width: 340,
              height: 340,
              borderRadius: '50%',
              filter: 'blur(70px)',
              opacity: theme.palette.mode === 'dark' ? 0.18 : 0.22,
              bgcolor: c,
              left: `${[-6, 38, 72][i]}%`,
              top: [-120, 20, -80][i],
              animation: `${drift} ${18 + i * 4}s ease-in-out ${-i * 5}s infinite alternate`,
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          />
        ))}
      </Box>

      <PageHeader
        title="Experience"
        subtitle="What your runs have learned about each site and app. The agent gets these lessons when a run reaches that site, so the next run does not repeat the same mistakes."
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(4, minmax(0,1fr))' }, gap: 1.25, flex: 1 }}>
          {[
            { v: stats?.active ?? '–', l: 'lessons in use' },
            { v: stats?.trusted ?? '–', l: 'trusted' },
            { v: stats?.runs_with_memory_week ?? '–', l: 'runs used a lesson this week' },
            { v: helpedPct === null ? '–' : `${helpedPct}%`, l: 'of those succeeded' },
          ].map((s, i) => (
            <Card key={s.l} variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 3, animation: `${rise} 400ms ${i * 60}ms both` }}>
              <Typography sx={{ fontWeight: 800, fontSize: 26, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{s.v}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{s.l}</Typography>
            </Card>
          ))}
        </Box>
        <Card variant="outlined" sx={{ px: 2, py: 1, borderRadius: 3, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: { xs: 2, md: 0 }, flexWrap: 'wrap' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Agent uses lessons</Typography>
            <Switch size="small" checked={ov?.settings.enabled ?? true} onChange={(e) => toggle('enabled', e.target.checked)} inputProps={{ 'aria-label': 'Agent uses lessons' }} />
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Runs add lessons</Typography>
            <Switch size="small" checked={ov?.settings.learn ?? true} onChange={(e) => toggle('learn', e.target.checked)} inputProps={{ 'aria-label': 'Runs add lessons' }} />
          </Stack>
        </Card>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {(['lessons', 'runs'] as const).map((t) => (
          <Button key={t} size="small" variant={tab === t ? 'contained' : 'outlined'} onClick={() => setTab(t)} sx={{ borderRadius: 99, px: 2, fontWeight: 700 }}>
            {t === 'lessons' ? 'Lessons by site' : 'What each run used and learned'}
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" color="secondary" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ scope: scope ?? '', kind: 'path', text: '' })} sx={{ borderRadius: 99, fontWeight: 700 }}>
          Teach a lesson
        </Button>
      </Stack>

      {isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : !ov || ov.lessons.length === 0 ? (
        <Card variant="outlined" sx={{ p: { xs: 3, md: 5 }, borderRadius: 4, textAlign: 'center', animation: `${rise} 400ms both` }}>
          <Typography sx={{ fontWeight: 800, fontSize: 22, mb: 1 }}>No lessons yet</Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 560, mx: 'auto', mb: 2 }}>
            Each finished run adds what it learned about the sites and apps it used: the way to a button, a page that does not exist, how a pop-up closes. You can also add one yourself.
          </Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ scope: '', kind: 'path', text: '' })}>
            Teach the first lesson
          </Button>
        </Card>
      ) : tab === 'lessons' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '270px minmax(0,1fr)' }, gap: 2, alignItems: 'start' }}>
          <Card variant="outlined" sx={{ p: 1, borderRadius: 3, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.5, overflowX: { xs: 'auto', md: 'visible' } }}>
            {ov.scopes.map((s) => (
              <Box
                key={s.scope}
                component="button"
                type="button"
                onClick={() => setPicked(s.scope)}
                aria-pressed={s.scope === scope}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1.25,
                  border: 0,
                  borderRadius: 2,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'text.primary',
                  font: 'inherit',
                  flex: 'none',
                  bgcolor: s.scope === scope ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
                  transition: 'background-color 200ms',
                  '&:hover': { bgcolor: s.scope === scope ? alpha(theme.palette.primary.main, 0.16) : 'action.hover' },
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
                }}
              >
                <Mark scope={s.scope} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.scope}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {s.lessons} lesson{s.lessons === 1 ? '' : 's'} · {s.trusted} trusted
                  </Typography>
                </Box>
              </Box>
            ))}
          </Card>
          <Stack spacing={1.25} sx={{ minWidth: 0 }}>
            {scope && (
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
                <Mark scope={scope} size={40} />
                <Box>
                  <Typography sx={{ fontWeight: 800, fontSize: 24, lineHeight: 1.1 }}>{scope}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Shown to the agent when a run reaches this {scopeMark(scope).isApp ? 'app' : 'site'}, trusted lessons first.</Typography>
                </Box>
              </Stack>
            )}
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {(
                [
                  ['use', 'In use'],
                  ['unverified', 'Unverified'],
                  ['off', 'Off'],
                  ['all', 'All'],
                ] as const
              ).map(([key, name]) => {
                const n = (ov.lessons ?? []).filter((l) => l.scope === scope && (key === 'all' || (key === 'use' ? l.status === 'trusted' || l.status === 'candidate' : l.status === key))).length;
                return (
                  <Button key={key} size="small" variant={show === key ? 'contained' : 'text'} color="inherit" onClick={() => setShow(key)} sx={{ borderRadius: 99, px: 1.5, fontWeight: 700, fontSize: 12, minWidth: 0 }}>
                    {name} · {n}
                  </Button>
                );
              })}
            </Stack>
            {lessons.length === 0 && <Typography sx={{ color: 'text.secondary', fontSize: 14, py: 2 }}>Nothing here.</Typography>}
            {lessons.map((l, i) => (
              <LessonCard key={l.id} lesson={l} index={i} onEdit={() => setDialog({ id: l.id, scope: l.scope, kind: l.kind, text: l.text })} />
            ))}
          </Stack>
        </Box>
      ) : (
        <Box sx={{ position: 'relative', pl: 3.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box aria-hidden sx={{ position: 'absolute', left: 10, top: 8, bottom: 8, width: 2, borderRadius: 2, background: `linear-gradient(${theme.palette.primary.main}, #8b5cf6, ${theme.palette.success.main})` }} />
          {ov.runs.length === 0 && <Typography sx={{ color: 'text.secondary' }}>No run has used or added a lesson yet.</Typography>}
          {ov.runs.map((r, i) => (
            <Box key={r.task_id} sx={{ position: 'relative', animation: `${rise} 420ms ${Math.min(i, 10) * 60}ms both` }}>
              <Box aria-hidden sx={{ position: 'absolute', left: -30, top: 14, width: 14, height: 14, borderRadius: '50%', bgcolor: 'background.paper', border: `3px solid ${r.succeeded ? theme.palette.success.main : theme.palette.text.disabled}` }} />
              <Card variant="outlined" sx={{ p: 2, borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography component="span" sx={{ fontWeight: 800, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
                    Run #{r.task_id}
                  </Typography>
                  <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 1.5, fontSize: 11, fontWeight: 800, color: r.succeeded ? 'success.main' : 'text.secondary', bgcolor: r.succeeded ? alpha(theme.palette.success.main, 0.12) : 'action.hover' }}>
                    {r.succeeded ? 'DONE' : 'NOT DONE'}
                  </Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Typography>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
                  {(
                    [
                      ['Used', r.used, '↳'],
                      ['Learned', r.learned, '＋'],
                    ] as const
                  ).map(([title, list, mark]) => (
                    <Box key={title} sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'text.secondary' }}>{title}</Typography>
                      {list.length ? (
                        list.map((x) => (
                          <Typography key={x.id} sx={{ fontSize: 13 }}>
                            {mark} {x.text}
                          </Typography>
                        ))
                      ) : (
                        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Nothing</Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Card>
            </Box>
          ))}
        </Box>
      )}

      {dialog && <LessonDialog key={dialog.id ?? 'new'} draft={dialog} onClose={() => setDialog(null)} />}
    </Box>
  );
}
