import type { DeviceNetworkInfo } from '@/RTKService/androidService/androidService';

export type AlertKind = 'ip' | 'lang' | 'tz' | 'clock' | 'rtc' | 'sim';
export type AlertLevel = 'high' | 'mid' | 'low';

export interface FleetAlert {
  key: string;
  phone: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  detail: string;
  /** A Vector command that fixes it, put in the composer (never sent by itself). */
  fix: string | null;
}

interface AlertDevice {
  id: number;
  name: string;
  proxy_id: number | null;
  network?: DeviceNetworkInfo | null;
}

const LEVEL: Record<AlertKind, AlertLevel> = { ip: 'high', lang: 'mid', tz: 'mid', rtc: 'mid', clock: 'low', sim: 'low' };
const TITLE: Record<AlertKind, string> = {
  ip: 'IP is not the lane’s IP',
  lang: 'Language differs',
  tz: 'Timezone doesn’t match the IP',
  rtc: 'WebRTC leaks another IP',
  clock: 'Clock is off',
  sim: 'SIM country differs',
};
/** Readings further apart than this are not compared (a rotation may sit between them). */
const SAME_WINDOW_MS = 30 * 60_000;

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Which kind a server "needs a look" line is about. */
function kindOf(line: string): AlertKind | null {
  if (/^Timezone/i.test(line)) return 'tz';
  if (/language|region/i.test(line)) return 'lang';
  if (/^SIM/i.test(line)) return 'sim';
  if (/WebRTC/i.test(line)) return 'rtc';
  if (/clock/i.test(line)) return 'clock';
  if (/proxy/i.test(line)) return 'ip';
  return null;
}

function mostCommon(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
}

/**
 * Everything worth a look across the fleet, most urgent first: the server's
 * own checks on each phone's reading (timezone / language / SIM against the
 * IP's country, an unused proxy, WebRTC, the clock), plus two that need the
 * whole lane: a phone whose public IP is not the one its lane-mates share
 * (its proxy is likely not applied), and a phone whose language differs from
 * the rest of its lane.
 */
export function fleetAlerts(devices: AlertDevice[]): FleetAlert[] {
  const out: FleetAlert[] = [];
  const seen = new Set<string>();
  const push = (d: AlertDevice, kind: AlertKind, detail: string, fix: string | null) => {
    const key = `${d.id}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, phone: d.name, kind, level: LEVEL[kind], title: TITLE[kind], detail, fix });
  };

  // Lane checks: compare each phone with its lane-mates' recent readings.
  const lanes = new Map<number, AlertDevice[]>();
  for (const d of devices) if (d.proxy_id && d.network) lanes.set(d.proxy_id, [...(lanes.get(d.proxy_id) ?? []), d]);
  for (const members of lanes.values()) {
    const newest = Math.max(...members.map((d) => new Date(d.network!.checked_at).getTime()));
    const fresh = members.filter((d) => newest - new Date(d.network!.checked_at).getTime() <= SAME_WINDOW_MS);
    if (fresh.length < 3) continue; // two phones cannot say which one is odd
    const ip = mostCommon(fresh.map((d) => d.network!.public_ip).filter(Boolean) as string[]);
    if (ip && ip.count >= 2 && ip.count > fresh.length / 2) {
      for (const d of fresh) {
        const mine = d.network!.public_ip;
        if (mine && mine !== ip.value) push(d, 'ip', `Goes out through ${mine}; the rest of its lane is on ${ip.value}. Its proxy may not be applied.`, `@${d.name} check the proxy settings`);
      }
    }
    const lang = mostCommon(fresh.map((d) => d.network!.languages[0]).filter(Boolean) as string[]);
    if (lang && lang.count >= 2 && lang.count > fresh.length / 2) {
      for (const d of fresh) {
        const mine = d.network!.languages[0];
        if (mine && mine !== lang.value) {
          push(d, 'lang', `Phone language ${mine}; the rest of its lane uses ${lang.value}.`, `@${d.name} set the phone language to ${languageName(lang.value)}`);
        }
      }
    }
  }

  // The server's own checks on each reading.
  for (const d of devices) {
    const n = d.network;
    if (!n) continue;
    for (const line of n.attention ?? []) {
      const kind = kindOf(line);
      if (!kind) continue;
      const fix =
        kind === 'tz' && n.ip_timezone
          ? `@${d.name} set the timezone to ${n.ip_timezone}`
          : kind === 'clock'
            ? `@${d.name} turn on automatic date and time`
            : kind === 'lang' && n.public_country
              ? `@${d.name} set the phone language and region to match ${n.public_country}`
              : kind === 'ip'
                ? `@${d.name} check the proxy settings`
                : null;
      push(d, kind, line, fix);
    }
  }

  const order: Record<AlertLevel, number> = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || a.phone.localeCompare(b.phone));
}
