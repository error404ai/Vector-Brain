import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import {
  fetchLandingShotBlob,
  useDeleteLandingShotMutation,
  useGetLandingShotsQuery,
  useImportLandingMissionMutation,
  useUpdateLandingShotMutation,
  type LandingShot,
} from '@/RTKService/landingShotService/landingShotService';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';

/** What each slot is on the landing page. `fleet` and `app` take many shots. */
const SLOT_LABELS: Record<string, string> = {
  'hero-1': 'Hero · front phone (command)',
  'hero-2': 'Hero · phone 2',
  'hero-3': 'Hero · phone 3',
  'hero-4': 'Hero · phone 4',
  'hero-5': 'Hero · phone 5',
  'step-1': 'How it works · 1 Connect',
  'step-2': 'How it works · 2 Type the task',
  'step-3': 'How it works · 3 Watch it run',
  'run-1': 'Example run 1 · Checkout',
  'run-2': 'Example run 2 · Onboarding',
  'run-3': 'Example run 3 · Nightly check',
  'run-4': 'Example run 4 · Settings',
  'run-5': 'Example run 5 · Accounts',
  'run-6': 'Example run 6 · Rollout',
  fleet: 'Real fleet wall (many)',
  app: 'App pages (many)',
};

type Filter = 'all' | 'phone' | 'page' | 'live' | 'unused';

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Loads an admin-only image with the bearer token and shows it from an object URL. */
function ShotImage({ id, alt, onOpen }: { id: number; alt: string; onOpen?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetchLandingShotBlob(id)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (failed) return <Typography variant="caption" color="error">Image unavailable</Typography>;
  if (!url) return <Skeleton variant="rectangular" sx={{ width: '100%', height: '100%' }} />;
  return (
    <Box
      component="img"
      src={url}
      alt={alt}
      onClick={() => onOpen?.(url)}
      sx={{ height: '100%', width: '100%', objectFit: 'contain', display: 'block', cursor: 'zoom-in', borderRadius: 1 }}
    />
  );
}

function ShotCard({ shot, slots, onOpen }: { shot: LandingShot; slots: string[]; onOpen: (url: string) => void }) {
  const [update, { isLoading: saving }] = useUpdateLandingShotMutation();
  const [remove, { isLoading: deleting }] = useDeleteLandingShotMutation();
  const save = async (patch: { slot?: string | null; approved?: boolean }) => {
    try {
      await update({ id: shot.id, ...patch }).unwrap();
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not save');
    }
  };
  const live = shot.approved && !!shot.slot;
  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', borderColor: live ? 'success.main' : 'divider', borderWidth: live ? 2 : 1 }}>
      {/* Fixed-height frame; the image is contained inside it so tall phone shots never spill over the card. */}
      <Box sx={{ height: 280, bgcolor: 'grey.100', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1.5, overflow: 'hidden', flexShrink: 0 }}>
        <ShotImage id={shot.id} alt={shot.label} onOpen={onOpen} />
      </Box>
      {(saving || deleting) && <LinearProgress />}
      <Stack spacing={1.25} sx={{ p: 1.5, flexGrow: 1 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }} noWrap title={shot.label}>
              {shot.label}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {[shot.device_model, shot.width && shot.height ? `${shot.width}×${shot.height}` : null, kb(shot.size_bytes)].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Chip size="small" label={shot.kind === 'page' ? 'Page' : shot.source === 'mission' ? 'Mission' : 'Phone'} variant="outlined" />
            {live && <Chip size="small" color="success" label="Live" />}
          </Stack>
        </Stack>
        <TextField
          select
          size="small"
          label="Landing slot"
          value={shot.slot ?? ''}
          onChange={(e) => void save({ slot: e.target.value || null })}
        >
          <MenuItem value="">
            <em>Not used</em>
          </MenuItem>
          {slots.map((s) => (
            <MenuItem key={s} value={s}>
              {SLOT_LABELS[s] ?? s}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <FormControlLabel
            control={<Switch size="small" checked={shot.approved} onChange={(e) => void save({ approved: e.target.checked })} />}
            label={<Typography variant="body2">Approved</Typography>}
          />
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              {new Date(shot.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Typography>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" disabled={deleting} onClick={() => void remove(shot.id)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}

/**
 * Admin page for the landing page's screenshots: everything captured from the
 * fleet or the app, with a slot picker and an approve switch. The landing page
 * shows a shot only when it is approved and in a slot.
 */
export default function LandingShotsPage() {
  const { data, isLoading } = useGetLandingShotsQuery();
  const [importMission, { isLoading: importing }] = useImportLandingMissionMutation();
  const [filter, setFilter] = useState<Filter>('all');
  const [zoom, setZoom] = useState<string | null>(null);
  const shots = useMemo(() => data?.data?.shots ?? [], [data]);
  const slots = data?.data?.slots ?? Object.keys(SLOT_LABELS);

  const shown = shots.filter((s) =>
    filter === 'all' ? true : filter === 'live' ? s.approved && s.slot : filter === 'unused' ? !s.slot : s.kind === filter,
  );
  const filled = new Set(shots.filter((s) => s.approved && s.slot).map((s) => s.slot));

  const handleImport = async () => {
    try {
      const res = await importMission().unwrap();
      toast.success(res.message);
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not import');
    }
  };

  return (
    <>
      <Helmet>
        <title>Landing shots - Vector Brain</title>
      </Helmet>
      <PageHeader
        title="Landing shots"
        subtitle="Screens for the public landing page. Capture phones from the Fleet page (camera button or Capture all), or any app page from your profile menu → Capture this page. A shot goes live when it is approved and in a slot."
        action={
          <HeaderActions>
            <Button variant="outlined" startIcon={<MovieFilterIcon />} onClick={() => void handleImport()} disabled={importing}>
              Import last mission's final screens
            </Button>
            <Button variant="outlined" component={Link} to="/" target="_blank" endIcon={<OpenInNewIcon />}>
              Open landing page
            </Button>
          </HeaderActions>
        }
      />

      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        {slots.map((s) => (
          <Chip
            key={s}
            size="small"
            label={s}
            color={filled.has(s) ? 'success' : 'default'}
            variant={filled.has(s) ? 'filled' : 'outlined'}
            title={SLOT_LABELS[s]}
          />
        ))}
      </Stack>

      <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <ToggleButton value="all">All ({shots.length})</ToggleButton>
        <ToggleButton value="phone">Phones</ToggleButton>
        <ToggleButton value="page">Pages</ToggleButton>
        <ToggleButton value="live">Live</ToggleButton>
        <ToggleButton value="unused">Not used</ToggleButton>
      </ToggleButtonGroup>

      {isLoading ? (
        <LinearProgress />
      ) : shown.length === 0 ? (
        <Card variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700 }}>No shots here yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Open the Fleet page and press Capture all, or import the final screens of your last mission.
          </Typography>
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {shown.map((s) => (
            <ShotCard key={s.id} shot={s} slots={slots} onOpen={setZoom} />
          ))}
        </Box>
      )}

      <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="lg">
        {zoom && <Box component="img" src={zoom} alt="" sx={{ display: 'block', maxWidth: '90vw', maxHeight: '90vh' }} />}
      </Dialog>
    </>
  );
}
