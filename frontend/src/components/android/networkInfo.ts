import { useEffect, useState } from 'react';
import type { DeviceNetworkInfo } from '@/RTKService/androidService/androidService';

/** The current time, ticking every second while mounted. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Minutes east of UTC for a timezone at a moment, or null for an unknown zone. */
export function offsetMinutes(tz: string | null | undefined, at: number): number | null {
  if (!tz) return null;
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return name === 'GMT' ? 0 : null;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return null;
  }
}

/** "UTC+05:30". */
export function offsetText(minutes: number | null): string {
  if (minutes === null) return '';
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** "4 h 30 min". */
export function durationText(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** Date and time as a clock in that timezone shows them: { date: "Tue, 29 Sep 2026", time: "00:32:15" }. */
export function inZone(at: number, tz: string | null | undefined): { date: string; time: string } {
  const opts = tz ? { timeZone: tz } : {};
  try {
    return {
      date: new Intl.DateTimeFormat('en-GB', { ...opts, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(at),
      time: new Intl.DateTimeFormat('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at),
    };
  } catch {
    return { date: '—', time: '—' };
  }
}

/** What the phone's clock reads now: real time plus its measured offset from the server. */
export function phoneNow(info: DeviceNetworkInfo, now: number): number {
  return now + (info.clock_skew_s ?? 0) * 1000;
}

/** Does the phone's timezone belong to the IP's country? null when either is unknown. */
export function timezoneMatchesIp(info: DeviceNetworkInfo): boolean | null {
  if (!info.public_country || !info.timezone_countries?.length) return null;
  return info.timezone_countries.includes(info.public_country);
}

/** The region in a language tag: en-GB → GB. */
export function languageRegion(tag: string | undefined): string | null {
  const part = tag?.split(/[-_]/).find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p));
  return part ? part.toUpperCase() : null;
}

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
    i?.ip_timezone ?? '',
    i?.timezone ? inZone(i.checked_at ? new Date(i.checked_at).getTime() + (i.clock_skew_s ?? 0) * 1000 : Date.now(), i.timezone).time : '',
    i?.auto_time === null || i?.auto_time === undefined ? '' : i.auto_time ? 'on' : 'off',
    i?.auto_timezone === null || i?.auto_timezone === undefined ? '' : i.auto_timezone ? 'on' : 'off',
    i?.clock_skew_s === null || i?.clock_skew_s === undefined ? '' : String(i.clock_skew_s),
    i?.checked_at ?? '',
    (i?.attention ?? []).join(' | '),
  ];
}

export const CSV_HEADER = [
  'Phone', 'Lane', 'Public IP', 'Public country', 'Direct IP', 'Direct country', 'WebRTC IP', 'Proxy', 'DNS', 'Private DNS',
  'Languages', 'Region', 'SIM country', 'Timezone', 'Timezone at IP', 'Phone time at check', 'Auto time', 'Auto timezone', 'Clock vs server (s)', 'Checked at', 'Needs a look',
];

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
