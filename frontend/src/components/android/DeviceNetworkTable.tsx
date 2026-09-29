import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { Fragment, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useGetFleetStateQuery, useRefreshDeviceNetworkMutation } from '@/RTKService/androidService/androidService';
import DeviceTimePanel from './DeviceTimePanel';
import { CSV_HEADER, checkedAgo, clockOk, clockText, csvRow, inZone, ipWithCountry, phoneNow, timezoneMatchesIp, toCsv, useNow } from './networkInfo';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Every phone's network and locale side by side: the table view of what each
 * fleet card shows in its network line. Search, a "needs a look" filter, CSV
 * export and one Refresh for the whole fleet.
 */
export default function DeviceNetworkTable() {
  const { data } = useGetFleetStateQuery(undefined, { pollingInterval: 15_000 });
  const [refresh, { isLoading: refreshing }] = useRefreshDeviceNetworkMutation();
  const [query, setQuery] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const now = useNow();

  const lanes = useMemo(() => new Map((data?.data.lanes ?? []).map((l) => [l.id, l.name])), [data]);
  const devices = useMemo(() => data?.data.devices ?? [], [data]);
  const attentionCount = devices.filter((d) => d.network?.attention.length).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (onlyAttention && !d.network?.attention.length) return false;
      if (!q) return true;
      const n = d.network;
      const hay = [d.name, d.proxy_id ? lanes.get(d.proxy_id) : '', n?.public_ip, n?.public_country, n?.direct_ip, n?.webrtc_ip, n?.timezone, ...(n?.languages ?? []), n?.region]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [devices, lanes, query, onlyAttention]);

  const refreshAll = async () => {
    try {
      const res = await refresh({}).unwrap();
      toast.success(res.message);
    } catch {
      toast.error('Could not ask the phones');
    }
  };

  const exportCsv = () => {
    const csv = toCsv([CSV_HEADER, ...rows.map((d) => csvRow(d.name, d.proxy_id ? lanes.get(d.proxy_id) ?? '' : '', d.network))]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-network-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, mt: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ p: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            Network &amp; locale
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Read by each phone itself: on connect, every 15 minutes, after its proxy rotates, and when you refresh.
          </Typography>
        </Box>
        <TextField size="small" placeholder="Search phone, IP, country…" value={query} onChange={(e) => setQuery(e.target.value)} inputProps={{ 'aria-label': 'Search network info' }} />
        <Chip
          label={`Needs a look · ${attentionCount}`}
          color={onlyAttention ? 'warning' : 'default'}
          variant={onlyAttention ? 'filled' : 'outlined'}
          onClick={() => setOnlyAttention((v) => !v)}
        />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
        <Button variant="contained" startIcon={<RefreshIcon />} onClick={() => void refreshAll()} disabled={refreshing}>
          Refresh all
        </Button>
      </Stack>

      <TableContainer>
        <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              {['Phone', 'Lane', 'Public IP', 'Direct IP', 'WebRTC IP', 'DNS', 'Language', 'Timezone', 'Phone time', 'Clock', 'Checked'].map((h) => (
                <TableCell key={h} sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', fontWeight: 700 }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((d) => {
              const n = d.network;
              const look = Boolean(n?.attention.length);
              const webrtcDiffers = Boolean(n?.webrtc_ip && n?.public_ip && n.webrtc_ip !== n.public_ip);
              return (
                <Fragment key={d.id}>
                  <TableRow
                    hover
                    onClick={() => setOpenId(openId === d.id ? null : d.id)}
                    sx={{ cursor: 'pointer', bgcolor: (t) => (look ? alpha(t.palette.warning.main, 0.06) : undefined) }}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.online ? 'success.main' : 'grey.400' }} />
                        <span>{d.name}</span>
                      </Stack>
                    </TableCell>
                    <TableCell>{d.proxy_id ? lanes.get(d.proxy_id) ?? '—' : 'No lane'}</TableCell>
                    <TableCell sx={{ fontFamily: MONO }}>{n ? ipWithCountry(n.public_ip, n.public_country) : '—'}</TableCell>
                    <TableCell sx={{ fontFamily: MONO, color: 'text.secondary' }}>{n ? ipWithCountry(n.direct_ip, n.direct_country) : '—'}</TableCell>
                    <TableCell sx={{ fontFamily: MONO, color: webrtcDiffers ? 'warning.dark' : undefined }}>
                      {n ? ipWithCountry(n.webrtc_ip, n.webrtc_country) : '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: MONO, color: 'text.secondary' }}>{n?.dns.join(', ') || '—'}</TableCell>
                    <TableCell>{n?.languages[0] ?? '—'}</TableCell>
                    <TableCell sx={{ color: n && timezoneMatchesIp(n) === false ? 'warning.dark' : undefined }}>
                      {n?.timezone ?? '—'}
                      {n && timezoneMatchesIp(n) === false ? ` ≠ ${n.public_country}` : ''}
                    </TableCell>
                    <TableCell sx={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                      {n?.timezone ? (
                        <Tooltip title={inZone(phoneNow(n, now), n.timezone).date}>
                          <span>{inZone(phoneNow(n, now), n.timezone).time}</span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell sx={{ color: n && !clockOk(n.clock_skew_s) ? 'warning.dark' : 'success.dark' }}>{n ? clockText(n.clock_skew_s) : '—'}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {n ? (
                        <Tooltip title={new Date(n.checked_at).toLocaleString()}>
                          <span>{checkedAgo(n.checked_at)}</span>
                        </Tooltip>
                      ) : (
                        'needs app 0.28+'
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={11} sx={{ p: 0, borderBottom: openId === d.id ? undefined : 'none' }}>
                      <Collapse in={openId === d.id} unmountOnExit>
                        {n ? (
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ p: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}>
                            <Stack spacing={0.5} sx={{ minWidth: 260 }}>
                              <Typography variant="caption" fontWeight={700}>
                                Details
                              </Typography>
                              <Typography variant="caption">Proxy: {n.proxy ?? 'none set'}</Typography>
                              <Typography variant="caption">Private DNS: {n.private_dns ?? '—'}</Typography>
                              <Typography variant="caption">Languages: {n.languages.join(', ') || '—'}</Typography>
                              <Typography variant="caption">
                                Region {n.region || '—'} · SIM {n.sim_country ?? 'none'} · Network {n.network_country ?? 'none'}
                              </Typography>
                              <Typography variant="caption">Local IPs: {n.local_ips.join(', ') || '—'}</Typography>
                            </Stack>
                            <Box sx={{ minWidth: 360, maxWidth: 440 }}>
                              <DeviceTimePanel info={n} />
                            </Box>
                            <Stack spacing={0.5} sx={{ minWidth: 260 }}>
                              <Typography variant="caption" fontWeight={700}>
                                IP history
                              </Typography>
                              {n.ip_history.slice(0, 8).map((h) => (
                                <Typography key={`${h.ip}-${h.at}`} variant="caption" sx={{ fontFamily: MONO }}>
                                  {ipWithCountry(h.ip, h.country)} · {checkedAgo(h.at)} · {h.reason}
                                </Typography>
                              ))}
                            </Stack>
                            {n.attention.length ? (
                              <Stack spacing={0.5} sx={{ flexGrow: 1 }}>
                                <Typography variant="caption" fontWeight={700} color="warning.dark">
                                  Needs a look
                                </Typography>
                                {n.attention.map((line) => (
                                  <Typography key={line} variant="caption" color="warning.dark">
                                    {line}
                                  </Typography>
                                ))}
                              </Stack>
                            ) : null}
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 2 }}>
                            Not reported yet: the phone needs Vector 0.28 or newer.
                          </Typography>
                        )}
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
        Countries from IP2Location LITE data, lite.ip2location.com.
      </Typography>
    </Card>
  );
}
