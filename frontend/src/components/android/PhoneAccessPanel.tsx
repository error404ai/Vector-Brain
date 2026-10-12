import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import { Box, Button, Card, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Access = 'NOTIFICATIONS' | 'FILES';
interface PhoneAccess {
  device_id: number;
  device_name: string;
  notifications: 'granted' | 'off' | null;
  files: 'granted' | 'off' | null;
  can_enable: boolean;
}

const rise = keyframes`from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }`;
const pop = keyframes`0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); }`;
const sweep = keyframes`from { background-position: 200% 0; } to { background-position: -200% 0; }`;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = authManager.getAccessToken();
  return fetch(`${Global.BASE_API_PATH}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

const LABEL: Record<Access, { name: string; why: string; Icon: typeof FolderOpenRoundedIcon }> = {
  NOTIFICATIONS: { name: 'Notification access', why: 'Read the shade, press notification buttons, reply', Icon: NotificationsActiveRoundedIcon },
  FILES: { name: 'All files access', why: 'Send downloaded files to the dashboard', Icon: FolderOpenRoundedIcon },
};

/**
 * Phones (companion 0.32) that are missing Notification access or All files
 * access. "Turn on" asks the phone to open the Settings page and flip Vector's
 * own switch through accessibility — no adb, nobody at the phone. Hidden when
 * every online phone already has both.
 */
export default function PhoneAccessPanel() {
  const [rows, setRows] = useState<PhoneAccess[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await call('/android/uploads/access');
      if (res.ok) setRows(((await res.json()) as { data: PhoneAccess[] }).data ?? []);
    } catch {
      // Quiet: the panel stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const enable = async (row: PhoneAccess, access: Access): Promise<boolean> => {
    const key = `${row.device_id}:${access}`;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const res = await call('/android/uploads/access', { method: 'POST', body: JSON.stringify({ device_id: row.device_id, access }) });
      const body = (await res.json()) as { data?: { ok: boolean; message: string }; message?: string };
      if (!res.ok || !body.data?.ok) {
        toast.error(`${row.device_name}: ${body.data?.message ?? body.message ?? 'could not turn it on'}`);
        return false;
      }
      setDone((d) => ({ ...d, [key]: true }));
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const missing = rows.filter((r) => r.notifications === 'off' || r.files === 'off');
  if (!missing.length) return null;
  const fixable = missing.filter((r) => r.can_enable);

  const enableAll = async () => {
    // One phone at a time: each opens its own Settings page.
    let ok = 0;
    for (const row of fixable) {
      for (const access of ['NOTIFICATIONS', 'FILES'] as Access[]) {
        const state = access === 'FILES' ? row.files : row.notifications;
        if (state === 'off' && !done[`${row.device_id}:${access}`] && (await enable(row, access))) ok += 1;
      }
    }
    if (ok) toast.success(`Turned on ${ok} switch${ok === 1 ? '' : 'es'}`);
    void load();
  };

  return (
    <Card variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3, position: 'relative', overflow: 'hidden', animation: `${rise} 280ms ease both` }}>
      <Box
        aria-hidden
        sx={(t) => ({
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(80% 90% at 0% 0%, ${alpha(t.palette.warning.main, 0.12)}, transparent 55%), radial-gradient(70% 80% at 100% 100%, ${alpha(t.palette.success.main, 0.08)}, transparent 60%)`,
        })}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ position: 'relative', mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            Phone access to turn on
          </Typography>
          <Typography variant="caption" color="text.secondary">
            The phone opens the Settings page and flips Vector&apos;s switch by itself. No cable, no adb.
          </Typography>
        </Box>
        {fixable.length > 1 && (
          <Button size="small" variant="contained" color="warning" onClick={() => void enableAll()} sx={{ borderRadius: 99, fontWeight: 800, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
            Turn on for all {fixable.length}
          </Button>
        )}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1, position: 'relative' }}>
        {missing.map((row, i) => (
          <Box
            key={row.device_id}
            sx={(t) => ({
              p: 1.25,
              borderRadius: 2,
              border: `1px solid ${t.palette.divider}`,
              bgcolor: alpha(t.palette.background.paper, 0.88),
              animation: `${rise} 260ms ease ${Math.min(i, 8) * 35}ms both`,
            })}
          >
            <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.device_name}>
              {row.device_name}
            </Typography>
            <Stack spacing={0.75}>
              {(['NOTIFICATIONS', 'FILES'] as Access[]).map((access) => {
                const state = access === 'FILES' ? row.files : row.notifications;
                if (state === null) return null;
                const key = `${row.device_id}:${access}`;
                const on = state === 'granted' || done[key];
                const working = busy[key];
                const { name, why, Icon } = LABEL[access];
                return (
                  <Stack
                    key={access}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={(t) => ({
                      px: 1,
                      py: 0.75,
                      borderRadius: 1.5,
                      bgcolor: alpha(on ? t.palette.success.main : t.palette.warning.main, 0.08),
                      ...(working
                        ? {
                            backgroundImage: `linear-gradient(90deg, transparent, ${alpha(t.palette.warning.main, 0.18)}, transparent)`,
                            backgroundSize: '200% 100%',
                            animation: `${sweep} 1.2s linear infinite`,
                          }
                        : {}),
                      transition: 'background-color 240ms ease',
                    })}
                  >
                    <Icon fontSize="small" sx={{ color: on ? 'success.main' : 'warning.main' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                        {name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, fontSize: 11 }}>
                        {why}
                      </Typography>
                    </Box>
                    {on ? (
                      <CheckRoundedIcon fontSize="small" sx={{ color: 'success.main', animation: `${pop} 360ms ease both` }} />
                    ) : row.can_enable ? (
                      <Button size="small" variant="outlined" color="warning" disabled={working} onClick={() => void enable(row, access).then(() => void load())} sx={{ borderRadius: 99, minWidth: 84, fontWeight: 800 }}>
                        {working ? <CircularProgress size={14} color="inherit" /> : 'Turn on'}
                      </Button>
                    ) : (
                      <Tooltip title="Update Vector on this phone to 0.33 to do this from here; until then turn it on in the app's Setup.">
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                          On the phone
                        </Typography>
                      </Tooltip>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </Box>
        ))}
      </Box>
    </Card>
  );
}
