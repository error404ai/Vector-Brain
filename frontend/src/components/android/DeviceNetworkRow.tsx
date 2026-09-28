import PublicIcon from '@mui/icons-material/Public';
import CheckIcon from '@mui/icons-material/Check';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { Box, Button, ButtonBase, Divider, Popover, Stack, Typography, alpha } from '@mui/material';
import { memo, useState, type MouseEvent } from 'react';
import toast from 'react-hot-toast';
import { useRefreshDeviceNetworkMutation, type DeviceNetworkInfo } from '@/RTKService/androidService/androidService';
import { checkedAgo, clockOk, clockText, ipWithCountry, summaryLine } from './networkInfo';

interface Props {
  deviceId: number;
  name: string;
  online: boolean;
  value: DeviceNetworkInfo | null | undefined;
}

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

function Field({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary', fontSize: '0.65rem' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: mono ? MONO : undefined, wordBreak: 'break-all' }}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Stack>
  );
}

/**
 * One line on the fleet card: the phone's public IP, country, language and
 * city, with a mark when something is worth a look. Opens the full reading:
 * proxy and direct IP, WebRTC, DNS, languages, region, timezone and clock.
 */
function DeviceNetworkRowBase({ deviceId, name, online, value }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [refresh, { isLoading: refreshing }] = useRefreshDeviceNetworkMutation();

  const open = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchor(event.currentTarget);
  };
  const ask = async () => {
    try {
      const res = await refresh({ ids: [deviceId] }).unwrap();
      toast.success(res.data.asked ? 'Asked the phone to read it again' : 'The phone is offline — showing its last reading');
    } catch {
      toast.error('Could not ask the phone');
    }
  };

  const needsLook = Boolean(value?.attention.length);

  return (
    <>
      <ButtonBase
        onClick={open}
        aria-label={`${name}: network and locale`}
        sx={{
          mx: 1.5,
          mb: 0.75,
          px: 1,
          py: 0.6,
          gap: 0.75,
          borderRadius: 1.5,
          justifyContent: 'flex-start',
          border: '1px solid',
          borderColor: (t) => (needsLook ? alpha(t.palette.warning.main, 0.5) : t.palette.divider),
          bgcolor: (t) => (needsLook ? alpha(t.palette.warning.main, 0.06) : alpha(t.palette.text.primary, 0.02)),
          fontSize: '0.75rem',
          color: 'text.primary',
          minHeight: 32,
          width: 'calc(100% - 24px)',
        }}
      >
        <PublicIcon sx={{ fontSize: 15, color: needsLook ? 'warning.dark' : 'primary.main' }} />
        {value ? (
          <>
            <Box component="span" sx={{ fontFamily: MONO }}>
              {value.public_ip ?? 'IP unknown'}
            </Box>
            <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summaryLine(value) ? `· ${summaryLine(value)}` : ''}
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            {needsLook ? (
              <WarningAmberRoundedIcon sx={{ fontSize: 16, color: 'warning.dark' }} />
            ) : (
              <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
            )}
          </>
        ) : (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {online ? 'Network info: waiting for the phone (needs app 0.28+)' : 'Network info: not read yet'}
          </Box>
        )}
      </ButtonBase>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { borderRadius: 3, width: 520, maxWidth: 'calc(100vw - 32px)', p: 2 } } }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ flexGrow: 1 }}>
            {name} · Network &amp; locale
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {value ? `Checked ${checkedAgo(value.checked_at)}` : 'Not read yet'}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => void ask()} disabled={refreshing || !online}>
            Refresh
          </Button>
        </Stack>

        {value ? (
          <>
            {value.attention.length ? (
              <Stack spacing={0.5} sx={{ mb: 1.5, p: 1, borderRadius: 2, bgcolor: (t) => alpha(t.palette.warning.main, 0.08) }}>
                {value.attention.map((line) => (
                  <Typography key={line} variant="caption" color="warning.dark">
                    {line}
                  </Typography>
                ))}
              </Stack>
            ) : null}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              <Field label="Public IP · via proxy" value={ipWithCountry(value.public_ip, value.public_country)} sub={value.proxy ? `Proxy ${value.proxy}` : 'No proxy set on the phone'} mono />
              <Field label="Direct IP · no proxy" value={ipWithCountry(value.direct_ip, value.direct_country)} mono />
              <Field label="WebRTC IP (STUN)" value={ipWithCountry(value.webrtc_ip, value.webrtc_country)} sub={value.local_ips.length ? `Local ${value.local_ips.join(', ')}` : undefined} mono />
              <Field label="DNS" value={value.dns.join(', ') || '—'} sub={value.private_dns ? `Private DNS: ${value.private_dns}` : undefined} mono />
              <Field label="Language" value={value.languages[0] ?? '—'} sub={value.languages.length > 1 ? `Also: ${value.languages.slice(1).join(', ')}` : undefined} />
              <Field label="Region" value={value.region || '—'} sub={`SIM: ${value.sim_country ?? 'none'} · Network: ${value.network_country ?? 'none'}`} />
              <Field
                label="Timezone"
                value={value.timezone ?? '—'}
                sub={value.auto_timezone === null ? undefined : `Automatic timezone: ${value.auto_timezone ? 'on' : 'off'}`}
              />
              <Field
                label="Phone clock"
                value={clockOk(value.clock_skew_s) ? `In step (${clockText(value.clock_skew_s)})` : `${clockText(value.clock_skew_s)} vs server`}
                sub={value.auto_time === null ? undefined : `Automatic time: ${value.auto_time ? 'on' : 'off'}`}
              />
            </Box>
            {value.ip_history.length > 1 ? (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" fontWeight={700}>
                  IP history
                </Typography>
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {value.ip_history.slice(0, 6).map((h) => (
                    <Stack key={`${h.ip}-${h.at}`} direction="row" spacing={1} sx={{ fontSize: '0.75rem' }}>
                      <Box component="span" sx={{ fontFamily: MONO }}>
                        {ipWithCountry(h.ip, h.country)}
                      </Box>
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        {checkedAgo(h.at)} · {h.reason}
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            This phone has not reported yet. Vector 0.28 or newer reads it on connect, every 15 minutes, and when you press Refresh.
          </Typography>
        )}
      </Popover>
    </>
  );
}

const DeviceNetworkRow = memo(DeviceNetworkRowBase);
export default DeviceNetworkRow;
