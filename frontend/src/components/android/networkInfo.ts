import type { DeviceNetworkInfo } from '@/RTKService/androidService/androidService';

/** "2 min ago", "3 h ago", for when a phone last reported. */
export function checkedAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The city part of a timezone ("Europe/London" → "London"). */
export function tzCity(tz: string | null | undefined): string {
  if (!tz) return '';
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

/** "+2 s", "−4 min": the phone clock against the server's. */
export function clockText(skew: number | null | undefined): string {
  if (skew === null || skew === undefined) return '—';
  const abs = Math.abs(skew);
  const sign = skew > 0 ? '+' : skew < 0 ? '−' : '±';
  return abs >= 90 ? `${sign}${Math.round(abs / 60)} min` : `${sign}${abs} s`;
}

export function clockOk(skew: number | null | undefined): boolean {
  return skew === null || skew === undefined || Math.abs(skew) <= 60;
}

export function ipWithCountry(ip: string | null | undefined, country: string | null | undefined): string {
  if (!ip) return '—';
  return country ? `${ip} · ${country}` : ip;
}

/** One-line summary for the fleet card. */
export function summaryLine(info: DeviceNetworkInfo): string {
  return [info.public_country, info.languages[0], tzCity(info.timezone)].filter(Boolean).join(' · ');
}

/** Rows for CSV export, one per phone. */
export function csvRow(name: string, lane: string, info: DeviceNetworkInfo | null | undefined): string[] {
  const i = info;
  return [
    name,
    lane,
    i?.public_ip ?? '',
    i?.public_country ?? '',
    i?.direct_ip ?? '',
    i?.direct_country ?? '',
    i?.webrtc_ip ?? '',
    i?.proxy ?? '',
    (i?.dns ?? []).join(' '),
    i?.private_dns ?? '',
    (i?.languages ?? []).join(' '),
    i?.region ?? '',
    i?.sim_country ?? '',
    i?.timezone ?? '',
    i?.auto_time === null || i?.auto_time === undefined ? '' : i.auto_time ? 'on' : 'off',
    i?.auto_timezone === null || i?.auto_timezone === undefined ? '' : i.auto_timezone ? 'on' : 'off',
    i?.clock_skew_s === null || i?.clock_skew_s === undefined ? '' : String(i.clock_skew_s),
    i?.checked_at ?? '',
    (i?.attention ?? []).join(' | '),
  ];
}

export const CSV_HEADER = [
  'Phone', 'Lane', 'Public IP', 'Public country', 'Direct IP', 'Direct country', 'WebRTC IP', 'Proxy', 'DNS', 'Private DNS',
  'Languages', 'Region', 'SIM country', 'Timezone', 'Auto time', 'Auto timezone', 'Clock vs server (s)', 'Checked at', 'Needs a look',
];

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
