import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { Box, Button, Popover, Stack, TextField, Tooltip, Typography, alpha } from '@mui/material';
import { memo, useState, type MouseEvent } from 'react';
import toast from 'react-hot-toast';
import { useResolveDeviceEmailsMutation, useSetDeviceEmailsMutation, type DeviceEmails } from '@/RTKService/androidService/androidService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

interface Props {
  deviceId: number;
  value: DeviceEmails | null | undefined;
}

/**
 * The email accounts on one phone, on its fleet card.
 *
 * A run that reads the phone fills it on its own; the user can correct it,
 * and from then on their list stands — a later read that disagrees shows up
 * as "Mismatch" to accept or dismiss instead of silently replacing it.
 */
function DeviceEmailRowBase({ deviceId, value }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState('');
  const [setEmails, { isLoading: saving }] = useSetDeviceEmailsMutation();
  const [resolve, { isLoading: resolving }] = useResolveDeviceEmailsMutation();

  const emails = value?.emails ?? [];
  const mismatch = Boolean(value?.suggested);

  const open = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setDraft(emails.join('\n'));
    setAnchor(event.currentTarget);
  };

  const entries = draft
    .split(/[\n,]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const invalid = entries.filter((e) => !EMAIL_RE.test(e));

  const save = async () => {
    try {
      await setEmails({ id: deviceId, emails: entries }).unwrap();
      setAnchor(null);
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not save the emails');
    }
  };

  const choose = async (choice: 'accept' | 'dismiss' | 'clear') => {
    try {
      await resolve({ id: deviceId, choice }).unwrap();
      setAnchor(null);
    } catch {
      toast.error('Could not update the emails');
    }
  };

  const sourceLine = !value
    ? 'Not checked yet — ask Vector to check the phones’ email accounts, or add them here.'
    : value.source === 'user'
      ? `Entered by you · ${ago(value.updated_at)}`
      : `Read by the phone${value.mission_id ? ` in mission #${value.mission_id}` : ''} · ${ago(value.updated_at)}`;

  return (
    <>
      <Tooltip title={mismatch ? `A newer read found: ${value?.suggested?.join(', ') || 'no email'}` : sourceLine}>
        <Stack
          direction="row"
          alignItems="center"
          gap={0.6}
          onClick={open}
          sx={{
            mx: 1,
            mb: 0.5,
            px: 0.75,
            py: 0.35,
            borderRadius: 1,
            cursor: 'pointer',
            minWidth: 0,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <MailOutlineIcon sx={{ fontSize: 15, color: emails.length ? 'text.secondary' : 'text.disabled', flexShrink: 0 }} />
          <Typography
            variant="caption"
            noWrap
            sx={{ minWidth: 0, flexShrink: 1, fontWeight: emails.length ? 600 : 400, color: emails.length ? 'text.primary' : 'text.disabled' }}
          >
            {emails.length ? emails[0] : value ? 'No email on this phone' : 'Email · add'}
          </Typography>
          {emails.length > 1 && (
            <Box component="span" sx={{ fontSize: 10.5, fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>
              +{emails.length - 1}
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {mismatch && (
            <Box
              component="span"
              sx={{ px: 0.7, py: '1px', borderRadius: 1, fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: 'warning.dark', bgcolor: alpha('#ea580c', 0.14) }}
            >
              Mismatch
            </Box>
          )}
          {value && !mismatch && (
            <Box component="span" sx={{ fontSize: 10, fontWeight: 700, color: 'text.disabled', flexShrink: 0, letterSpacing: '0.04em' }}>
              {value.source === 'user' ? 'YOU' : 'AI'}
            </Box>
          )}
        </Stack>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 300 } } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          Email
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          {sourceLine}
        </Typography>

        {mismatch && value && (
          <Box sx={{ mb: 1.25, p: 1, borderRadius: 1, bgcolor: alpha('#ea580c', 0.08), border: '1px solid', borderColor: alpha('#ea580c', 0.3) }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
              Newer read{value.suggested_mission_id ? ` (mission #${value.suggested_mission_id})` : ''}:
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-all', mb: 0.75 }}>
              {value.suggested?.length ? value.suggested.join(', ') : 'no email signed in'}
            </Typography>
            <Stack direction="row" gap={1}>
              <Button size="small" variant="contained" disabled={resolving} onClick={() => void choose('accept')}>
                Use this
              </Button>
              <Button size="small" disabled={resolving} onClick={() => void choose('dismiss')}>
                Keep mine
              </Button>
            </Stack>
          </Box>
        )}

        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          size="small"
          placeholder={'one email per line\nname@gmail.com'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={invalid.length > 0}
          helperText={invalid.length ? `Not an email: ${invalid.slice(0, 2).join(', ')}` : 'Saved as yours — later runs won’t overwrite it.'}
        />
        <Stack direction="row" gap={1} sx={{ mt: 1 }}>
          {value && (
            <Tooltip title="Forget these; the next run that checks this phone fills them again">
              <Button size="small" color="inherit" disabled={resolving} onClick={() => void choose('clear')}>
                Clear
              </Button>
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => setAnchor(null)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" disabled={saving || invalid.length > 0 || entries.length > 10} onClick={() => void save()}>
            Save
          </Button>
        </Stack>
      </Popover>
    </>
  );
}

const DeviceEmailRow = memo(DeviceEmailRowBase);
export default DeviceEmailRow;
