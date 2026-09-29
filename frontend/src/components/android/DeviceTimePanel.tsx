import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { Box, Stack, Typography, alpha } from '@mui/material';
import type { DeviceNetworkInfo } from '@/RTKService/androidService/androidService';
import { clockOk, clockText, durationText, inZone, languageRegion, offsetMinutes, offsetText, phoneNow, timezoneMatchesIp, useNow } from './networkInfo';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

function Row({ label, at, tz, sub, tone }: { label: string; at: number; tz: string | null | undefined; sub: string; tone?: 'ok' | 'warn' }) {
  const { date, time } = inZone(at, tz);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', columnGap: 1.5, alignItems: 'baseline', py: 0.75 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack spacing={0.1} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '1.05rem', fontWeight: 600, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums' }}>{time}</Typography>
          <Typography variant="body2" color="text.secondary">
            {date}
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ color: tone === 'warn' ? 'warning.dark' : tone === 'ok' ? 'success.dark' : 'text.secondary' }}>
          {sub}
        </Typography>
      </Stack>
    </Box>
  );
}

function Match({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const warn = ok === false;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.35,
        borderRadius: 999,
        fontSize: '0.72rem',
        border: '1px solid',
        borderColor: (t) => (warn ? alpha(t.palette.warning.main, 0.55) : t.palette.divider),
        bgcolor: (t) => (warn ? alpha(t.palette.warning.main, 0.1) : ok ? alpha(t.palette.success.main, 0.06) : 'transparent'),
        color: warn ? 'warning.dark' : 'text.primary',
      }}
    >
      {ok === null ? null : warn ? <WarningAmberRoundedIcon sx={{ fontSize: 13 }} /> : <CheckRoundedIcon sx={{ fontSize: 13, color: 'success.main' }} />}
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontWeight: 700 }}>
        {value}
      </Box>
    </Box>
  );
}

/**
 * The phone's date and time as it shows them, ticking live; the real time in
 * the same timezone; the local time where its public IP is; the gap between
 * them; and whether timezone, region, language and SIM match the IP country.
 */
export default function DeviceTimePanel({ info }: { info: DeviceNetworkInfo }) {
  const now = useNow();
  const phoneAt = phoneNow(info, now);
  const phoneTz = info.timezone;
  const phoneOffset = offsetMinutes(phoneTz, now);
  const ipTz = info.ip_timezone ?? null;
  const ipOffset = offsetMinutes(ipTz, now);
  const ipCountry = info.public_country;
  const tzMatch = timezoneMatchesIp(info);
  const gap = phoneOffset !== null && ipOffset !== null ? ipOffset - phoneOffset : null;
  const clockGood = clockOk(info.clock_skew_s);
  const skew = info.clock_skew_s ?? 0;
  const langRegion = languageRegion(info.languages[0]);
  const same = (v: string | null | undefined) => (ipCountry && v ? v.toUpperCase() === ipCountry : null);

  const gapLine =
    tzMatch === null || gap === null
      ? null
      : tzMatch
        ? { warn: false, text: `Timezone matches the IP’s country (${ipCountry})` }
        : gap === 0
          ? { warn: true, text: `Timezone is from ${info.timezone_countries?.[0]}, the IP is in ${ipCountry} — same clock time, different country` }
          : { warn: true, text: `Phone shows ${durationText(gap)} ${gap > 0 ? 'behind' : 'ahead of'} local time at the IP (${ipCountry})` };

  return (
    <Box sx={{ gridColumn: '1 / -1', borderRadius: 2, border: '1px solid', borderColor: 'divider', p: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.02) }}>
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary', fontSize: '0.65rem' }}>
        Date &amp; time
      </Typography>

      <Row
        label="Phone shows"
        at={phoneAt}
        tz={phoneTz}
        sub={[phoneTz ?? 'timezone unknown', offsetText(phoneOffset), info.auto_timezone === null ? '' : `automatic timezone ${info.auto_timezone ? 'on' : 'off'}`].filter(Boolean).join(' · ')}
      />
      <Row
        label="Actual time"
        at={now}
        tz={phoneTz}
        tone={clockGood ? 'ok' : 'warn'}
        sub={[
          info.clock_skew_s === null ? 'clock not measured' : skew === 0 ? 'Phone clock exactly in step' : `Phone clock ${clockText(skew).replace(/^[+−]/, '')} ${skew > 0 ? 'ahead' : 'behind'}${clockGood ? '' : ' — sign-ins and codes can fail'}`,
          info.auto_time === null ? '' : `automatic time ${info.auto_time ? 'on' : 'off'}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      {ipTz && ipCountry ? (
        <Row
          label={`At the IP · ${ipCountry}`}
          at={now}
          tz={ipTz}
          tone={tzMatch === false ? 'warn' : undefined}
          sub={[ipTz, offsetText(ipOffset), (info.ip_timezone_count ?? 0) > 1 && ipTz !== phoneTz ? `main zone of ${info.ip_timezone_count}` : ''].filter(Boolean).join(' · ')}
        />
      ) : null}

      {gapLine ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mt: 0.75,
            px: 1,
            py: 0.75,
            borderRadius: 1.5,
            bgcolor: (t) => alpha(gapLine.warn ? t.palette.warning.main : t.palette.success.main, gapLine.warn ? 0.1 : 0.07),
            color: gapLine.warn ? 'warning.dark' : 'success.dark',
          }}
        >
          {gapLine.warn ? <WarningAmberRoundedIcon sx={{ fontSize: 16 }} /> : <CheckRoundedIcon sx={{ fontSize: 16 }} />}
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {gapLine.text}
          </Typography>
        </Stack>
      ) : null}

      {ipCountry ? (
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Match label="IP" value={ipCountry} ok={null} />
          {info.timezone_countries?.length ? <Match label="Timezone" value={info.timezone_countries[0]} ok={tzMatch} /> : null}
          {info.region ? <Match label="Region" value={info.region.toUpperCase()} ok={same(info.region)} /> : null}
          {langRegion ? <Match label="Language" value={info.languages[0]} ok={same(langRegion)} /> : null}
          {info.sim_country ? <Match label="SIM" value={info.sim_country} ok={same(info.sim_country)} /> : null}
        </Stack>
      ) : null}
    </Box>
  );
}
