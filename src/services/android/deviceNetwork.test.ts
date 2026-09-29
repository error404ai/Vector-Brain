import { attentionFor, buildNetworkInfo, countryOf, deviceFactsText, durationText, ipTimezone, networkForChat, offsetMinutes, requestIp, timezoneCountries } from './deviceNetwork';

const report = {
  reason: 'connect',
  direct_ip: '49.36.1.1',
  webrtc_ip: '81.2.69.160',
  local_ips: ['192.168.1.23'],
  proxy: 'proxy.example:8080',
  dns: ['192.168.1.1'],
  private_dns: 'automatic',
  languages: ['en-GB', 'en-US'],
  region: 'GB',
  sim_country: 'in',
  timezone: 'Europe/London',
  utc_offset_minutes: 60,
  auto_time: true,
  auto_timezone: false,
};

describe('device network info', () => {
  it('reads the address a request came from, trusting only our own proxy', () => {
    expect(requestIp({ 'x-forwarded-for': '1.2.3.4, 81.2.69.160' })).toBe('81.2.69.160');
    expect(requestIp({ 'cf-connecting-ip': '81.2.69.161', 'x-forwarded-for': '1.2.3.4' })).toBe('81.2.69.161');
    expect(requestIp({}, '::ffff:10.0.0.5')).toBe('10.0.0.5');
  });

  it('builds the record with countries, and keeps an IP history of changes only', () => {
    const now = new Date('2026-09-28T22:00:00Z');
    const first = buildNetworkInfo({ ...report, device_time_ms: now.getTime() + 2000 }, '81.2.69.160', null, now);
    expect(first.public_country).toBe('GB');
    expect(first.direct_country).toBe('IN');
    expect(first.sim_country).toBe('IN');
    expect(first.clock_skew_s).toBe(2);
    expect(first.ip_history).toHaveLength(1);
    const same = buildNetworkInfo(report, '81.2.69.160', first, new Date('2026-09-28T22:05:00Z'));
    expect(same.ip_history).toHaveLength(1);
    const rotated = buildNetworkInfo({ ...report, reason: 'proxy rotated' }, '81.2.69.170', same, new Date('2026-09-28T22:10:00Z'));
    expect(rotated.ip_history.map((h) => h.ip)).toEqual(['81.2.69.170', '81.2.69.160']);
    expect(rotated.ip_history[0].reason).toBe('proxy rotated');
  });

  it('says plainly when a proxy is not used, WebRTC leaves elsewhere, or the clock is off', () => {
    const now = new Date('2026-09-28T22:00:00Z');
    const unused = buildNetworkInfo({ ...report, direct_ip: '81.2.69.160', webrtc_ip: '81.2.69.160' }, '81.2.69.160', null, now);
    expect(unused.attention.join(' ')).toMatch(/proxy is not being used/);
    const leak = buildNetworkInfo({ ...report, webrtc_ip: '49.36.1.1', device_time_ms: now.getTime() - 240_000 }, '81.2.69.160', null, now);
    expect(leak.attention.join(' ')).toMatch(/WebRTC/);
    expect(leak.attention.join(' ')).toMatch(/4 min behind/);
    expect(attentionFor({ ...leak, webrtc_ip: leak.public_ip, clock_skew_s: 3, sim_country: 'GB' })).toEqual([]);
  });

  it('flags a timezone, region, language or SIM that does not match the IP country, with the time gap', () => {
    const now = new Date('2026-09-28T22:00:00Z'); // BST: London is UTC+1, India UTC+5:30
    const info = buildNetworkInfo({ ...report, device_time_ms: now.getTime(), sim_country: 'us' }, '49.36.1.1', null, now);
    expect(info.public_country).toBe('IN');
    expect(info.timezone_countries).toContain('GB');
    expect(info.ip_timezone).toBe('Asia/Kolkata');
    const text = info.attention.join(' | ');
    expect(text).toMatch(/Timezone Europe\/London \(GB\) does not match the IP’s country \(IN\): the phone shows 4 h 30 min behind local time at the IP \(Asia\/Kolkata\)/);
    expect(text).toMatch(/region GB and language en-GB do not match/);
    expect(text).toMatch(/SIM is from US, the IP is in IN/);
  });

  it('knows the timezone at the IP, keeping the phone’s own when it is one of the country’s', () => {
    expect(timezoneCountries('Asia/Calcutta')).toEqual(['IN']);
    expect(ipTimezone('US', 'America/Chicago')).toEqual({ zone: 'America/Chicago', count: expect.any(Number) });
    expect(ipTimezone('US', 'Europe/London').zone).toBe('America/New_York');
    expect(ipTimezone(null, 'Europe/London').zone).toBeNull();
    expect(offsetMinutes('Asia/Kolkata', new Date())).toBe(330);
    expect(durationText(-270)).toBe('4 h 30 min');
  });

  it('gives the chats and the agent the facts, and nothing for a phone that never reported', () => {
    const info = buildNetworkInfo(report, '81.2.69.160', null);
    expect(networkForChat(info)).toMatchObject({ public_ip: '81.2.69.160', timezone: 'Europe/London', languages: ['en-GB', 'en-US'] });
    expect(networkForChat(null)).toBeNull();
    expect(deviceFactsText(info)).toMatch(/- public IP: 81\.2\.69\.160 \(GB\)/);
    expect(deviceFactsText(undefined)).toBeUndefined();
    expect(countryOf('not an ip')).toBeNull();
  });
});
