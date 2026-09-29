import ct from 'countries-and-timezones';
import ip3country from 'ip3country';

/**
 * A phone's network and locale, as the phone read them and the server saw it.
 * Built from what the companion reports (DeviceInfo.kt) plus the address its
 * report arrived from. Everything here is read, never guessed: a field the
 * phone could not read stays null.
 */
export interface DeviceNetworkInfo {
  /** The address the report reached the server from: the phone's proxy exit when a proxy is set. */
  public_ip: string | null;
  public_country: string | null;
  /** The same server asked with the proxy switched off: the phone's own connection. */
  direct_ip: string | null;
  direct_country: string | null;
  /** What a STUN server saw over UDP — the address WebRTC exposes. */
  webrtc_ip: string | null;
  webrtc_country: string | null;
  local_ips: string[];
  /** The HTTP proxy configured on the phone's network, host:port. */
  proxy: string | null;
  network_type: string | null;
  dns: string[];
  private_dns: string | null;
  languages: string[];
  region: string | null;
  sim_country: string | null;
  network_country: string | null;
  timezone: string | null;
  utc_offset_minutes: number | null;
  auto_time: boolean | null;
  auto_timezone: boolean | null;
  /** Countries that use the phone's timezone (Europe/London → GB, GG, IM, JE). */
  timezone_countries?: string[];
  /** The timezone at the public IP: the country's own, or its main one when it has several. */
  ip_timezone?: string | null;
  /** How many timezones the IP's country has: above 1, ip_timezone is the country's main one, not the exact place. */
  ip_timezone_count?: number;
  /** Phone clock minus server clock, in seconds, when the report was received. */
  clock_skew_s: number | null;
  checked_at: string;
  reason: string;
  /** Newest first; a new entry only when the public IP changed. */
  ip_history: { ip: string; country: string | null; at: string; reason: string }[];
  /** Plain-language things worth checking, computed from the above. */
  attention: string[];
}

const IP_HISTORY = 20;

/** The main timezone of countries that span several, where the alphabetical first would mislead. */
const MAIN_TIMEZONE: Record<string, string> = {
  US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', BR: 'America/Sao_Paulo', RU: 'Europe/Moscow',
  MX: 'America/Mexico_City', ID: 'Asia/Jakarta', CN: 'Asia/Shanghai', KZ: 'Asia/Almaty', AR: 'America/Argentina/Buenos_Aires',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', DE: 'Europe/Berlin', NZ: 'Pacific/Auckland', CL: 'America/Santiago',
  UA: 'Europe/Kyiv', MN: 'Asia/Ulaanbaatar', CD: 'Africa/Kinshasa', EC: 'America/Guayaquil', MY: 'Asia/Kuala_Lumpur',
};

/** Countries whose clocks follow this timezone, aliases resolved (Asia/Calcutta → IN). */
export function timezoneCountries(tz: string | null | undefined): string[] {
  if (!tz) return [];
  const zone = ct.getTimezone(tz);
  if (!zone) return [];
  if (zone.countries.length) return [...zone.countries];
  return zone.aliasOf ? ct.getTimezone(zone.aliasOf)?.countries ?? [] : [];
}

/** The timezone at an IP's country: the phone's own when it is one of the country's, else the main one. */
export function ipTimezone(country: string | null | undefined, phoneTz: string | null | undefined): { zone: string | null; count: number } {
  if (!country) return { zone: null, count: 0 };
  const zones = ct.getCountry(country)?.timezones ?? [];
  if (!zones.length) return { zone: null, count: 0 };
  if (phoneTz && timezoneCountries(phoneTz).includes(country)) return { zone: phoneTz, count: zones.length };
  return { zone: MAIN_TIMEZONE[country] ?? zones[0], count: zones.length };
}

/** Minutes east of UTC for a timezone at a moment, from the runtime's own tz data. */
export function offsetMinutes(tz: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return name === 'GMT' ? 0 : null;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return null;
  }
}

/** "4 h 30 min", "45 min", "2 h". */
export function durationText(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** The region part of a language tag: en-GB → GB, es-419 → null, en → null. */
function languageRegion(tag: string | undefined): string | null {
  const part = tag?.split(/[-_]/).find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p));
  return part ? part.toUpperCase() : null;
}
const CLOCK_TOLERANCE_S = 60;

let countryReady = false;
/** ISO country of an IPv4 address from the bundled IP2Location LITE table, or null. */
export function countryOf(ip: string | null | undefined): string | null {
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  try {
    if (!countryReady) {
      ip3country.init();
      countryReady = true;
    }
    return ip3country.lookupStr(ip) || null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const strList = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter((x): x is string => Boolean(x)).slice(0, max) : []);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The address a request came from: Cloudflare's header, else the entry our own proxy appended, else the socket. */
export function requestIp(headers: Record<string, unknown>, socketAddress?: string | null): string | null {
  const cf = str(headers['cf-connecting-ip']);
  if (cf) return cf;
  const forwarded = String(headers['x-forwarded-for'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const ip = forwarded[forwarded.length - 1] ?? socketAddress ?? null;
  return ip ? ip.replace(/^::ffff:/, '') : null;
}

/** Turns a phone's report into the stored record, carrying the IP history forward. */
export function buildNetworkInfo(report: Record<string, unknown>, seenFrom: string | null, previous: DeviceNetworkInfo | null, now = new Date()): DeviceNetworkInfo {
  const deviceTime = num(report.device_time_ms);
  const publicIp = seenFrom;
  const directIp = str(report.direct_ip, 64);
  const webrtcIp = str(report.webrtc_ip, 64);
  const reason = str(report.reason, 40) ?? 'check';
  const at = now.toISOString();

  const history = [...(previous?.ip_history ?? [])];
  if (publicIp && history[0]?.ip !== publicIp) history.unshift({ ip: publicIp, country: countryOf(publicIp), at, reason });

  const info: DeviceNetworkInfo = {
    public_ip: publicIp,
    public_country: countryOf(publicIp),
    direct_ip: directIp,
    direct_country: countryOf(directIp),
    webrtc_ip: webrtcIp,
    webrtc_country: countryOf(webrtcIp),
    local_ips: strList(report.local_ips),
    proxy: str(report.proxy, 120),
    network_type: str(report.network_type, 20),
    dns: strList(report.dns),
    private_dns: str(report.private_dns, 120),
    languages: strList(report.languages),
    region: str(report.region, 8),
    sim_country: str(report.sim_country, 8)?.toUpperCase() ?? null,
    network_country: str(report.network_country, 8)?.toUpperCase() ?? null,
    timezone: str(report.timezone, 64),
    utc_offset_minutes: num(report.utc_offset_minutes),
    auto_time: bool(report.auto_time),
    auto_timezone: bool(report.auto_timezone),
    timezone_countries: [],
    ip_timezone: null,
    ip_timezone_count: 0,
    clock_skew_s: deviceTime === null ? null : Math.round((deviceTime - now.getTime()) / 1000),
    checked_at: at,
    reason,
    ip_history: history.slice(0, IP_HISTORY),
    attention: [],
  };
  info.timezone_countries = timezoneCountries(info.timezone);
  const atIp = ipTimezone(info.public_country, info.timezone);
  info.ip_timezone = atIp.zone;
  info.ip_timezone_count = atIp.count;
  info.attention = attentionFor(info, now);
  return info;
}

/** Things a person would want to know, each one line. Never a verdict on what the settings should be. */
export function attentionFor(info: DeviceNetworkInfo, now = new Date()): string[] {
  const notes: string[] = [];
  const ipCountry = info.public_country;
  const tzCountries = info.timezone_countries ?? timezoneCountries(info.timezone);
  if (ipCountry && info.timezone && tzCountries.length && !tzCountries.includes(ipCountry)) {
    const ipZone = info.ip_timezone ?? ipTimezone(ipCountry, info.timezone).zone;
    const phoneOffset = offsetMinutes(info.timezone, now);
    const ipOffset = ipZone ? offsetMinutes(ipZone, now) : null;
    const gap = phoneOffset !== null && ipOffset !== null ? ipOffset - phoneOffset : null;
    const when = gap === null ? '' : gap === 0 ? ', though the clock time is the same' : `: the phone shows ${durationText(gap)} ${gap > 0 ? 'behind' : 'ahead of'} local time at the IP (${ipZone})`;
    notes.push(`Timezone ${info.timezone} (${tzCountries[0]}) does not match the IP’s country (${ipCountry})${when}.`);
  }
  if (ipCountry) {
    const locale: string[] = [];
    if (info.region && info.region.toUpperCase() !== ipCountry) locale.push(`region ${info.region.toUpperCase()}`);
    const langRegion = languageRegion(info.languages[0]);
    if (langRegion && langRegion !== ipCountry) locale.push(`language ${info.languages[0]}`);
    if (locale.length) notes.push(`Phone ${locale.join(' and ')} ${locale.length > 1 ? 'do' : 'does'} not match the IP’s country (${ipCountry}).`);
    if (info.sim_country && info.sim_country !== ipCountry) notes.push(`SIM is from ${info.sim_country}, the IP is in ${ipCountry}.`);
  }
  if (info.proxy && info.public_ip && info.direct_ip && info.public_ip === info.direct_ip) {
    notes.push('A proxy is set, but traffic reaches the internet from the phone’s own address: the proxy is not being used.');
  }
  if (info.webrtc_ip && info.public_ip && info.webrtc_ip !== info.public_ip) {
    notes.push('WebRTC (UDP) leaves from a different address than web traffic: the proxy only carries HTTP/HTTPS.');
  }
  if (info.clock_skew_s !== null && Math.abs(info.clock_skew_s) > CLOCK_TOLERANCE_S) {
    const minutes = Math.round(Math.abs(info.clock_skew_s) / 60);
    notes.push(`Phone clock is ${minutes >= 1 ? `${minutes} min` : `${Math.abs(info.clock_skew_s)} s`} ${info.clock_skew_s > 0 ? 'ahead' : 'behind'}: sign-ins and one-time codes can fail.`);
  }
  return notes;
}

/**
 * A stored record with the location checks filled in: records saved before
 * those checks existed get them on read, without waiting for the next report.
 */
export function withLocationChecks(info: DeviceNetworkInfo | null | undefined, now = new Date()): DeviceNetworkInfo | null {
  if (!info) return null;
  if (info.timezone_countries !== undefined) return info;
  const atIp = ipTimezone(info.public_country, info.timezone);
  const filled = { ...info, timezone_countries: timezoneCountries(info.timezone), ip_timezone: atIp.zone, ip_timezone_count: atIp.count };
  return { ...filled, attention: attentionFor(filled, now) };
}

/** A compact form for the AI chats: what they need to answer "which IP / language / timezone is on X". */
export function networkForChat(stored: DeviceNetworkInfo | null | undefined): Record<string, unknown> | null {
  const info = withLocationChecks(stored);
  if (!info) return null;
  return {
    public_ip: info.public_ip,
    public_country: info.public_country,
    direct_ip: info.direct_ip,
    webrtc_ip: info.webrtc_ip,
    proxy: info.proxy,
    dns: info.dns,
    private_dns: info.private_dns,
    languages: info.languages,
    region: info.region,
    sim_country: info.sim_country,
    timezone: info.timezone,
    timezone_countries: info.timezone_countries ?? [],
    timezone_at_ip: info.ip_timezone ?? null,
    auto_time: info.auto_time,
    auto_timezone: info.auto_timezone,
    clock_skew_s: info.clock_skew_s,
    checked_at: info.checked_at,
    ...(info.attention.length ? { attention: info.attention } : {}),
  };
}

/** The agent's view: first line when it was read, then one fact per line. Null when the phone never reported. */
export function deviceFactsText(stored: DeviceNetworkInfo | null | undefined): string | undefined {
  const info = withLocationChecks(stored);
  if (!info) return undefined;
  const line = (label: string, value: unknown) => (value === null || value === undefined || (Array.isArray(value) && !value.length) ? null : `- ${label}: ${Array.isArray(value) ? value.join(', ') : value}`);
  const rows = [
    line('public IP', info.public_ip ? `${info.public_ip}${info.public_country ? ` (${info.public_country})` : ''}` : null),
    line('direct IP (proxy off)', info.direct_ip),
    line('WebRTC IP', info.webrtc_ip),
    line('proxy', info.proxy),
    line('DNS', info.dns),
    line('private DNS', info.private_dns),
    line('languages', info.languages),
    line('region', info.region),
    line('SIM country', info.sim_country),
    line('timezone', info.timezone),
    line('timezone at the IP', info.ip_timezone && info.ip_timezone !== info.timezone ? info.ip_timezone : null),
    line('automatic time / timezone', info.auto_time === null ? null : `${info.auto_time ? 'on' : 'off'} / ${info.auto_timezone ? 'on' : 'off'}`),
    line('clock vs server', info.clock_skew_s === null ? null : `${info.clock_skew_s} s`),
  ].filter(Boolean);
  return [`at ${info.checked_at}`, ...rows].join('\n');
}
