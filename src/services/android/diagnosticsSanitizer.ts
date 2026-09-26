import { createHash, randomBytes } from 'crypto';

/**
 * Scrubs run data before it leaves the server (export download, GitHub sync).
 *
 * The aim is to keep what explains the agent's behaviour — actions, button
 * names, package names, timing, screen structure — and drop what identifies
 * people: emails, phone numbers, long numbers (OTPs, accounts), URL query
 * values, typed text and on-screen content. Screenshots are never read.
 */
export class DiagnosticsSanitizer {
  /** Random per export and never written out, so hashes are consistent but not reversible by guessing. */
  private readonly salt = randomBytes(16).toString('hex');

  hash(value: unknown): string {
    return createHash('sha256').update(this.salt).update(String(value)).digest('hex').slice(0, 12);
  }

  scrub(value: unknown, max = 400): string | null {
    if (value === null || value === undefined) return null;
    let text = String(value)
      .replace(BASE64_BLOB, '<blob>')
      .replace(URL_RE, (match) => scrubUrl(match))
      .replace(EMAIL, '<email>')
      .replace(PHONE, '<phone>')
      .replace(LONG_DIGITS, '<n>');
    if (text.length > max) text = `${text.slice(0, max)}…`;
    return text;
  }

  payload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload ?? null;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (key === 'url' || key === 'link') out[key] = typeof value === 'string' ? scrubUrl(value) : null;
      else if (key === 'text' || key === 'query' || key === 'message') {
        if (value === '[REDACTED]') out[key] = value;
        else if (typeof value === 'string') {
          // click_node text is a button name worth keeping; anything long or
          // digit-heavy is content and gets hashed.
          out[key] = value.length <= 40 && !/\d{4,}/.test(value) ? this.scrub(value, 40) : { h: this.hash(value), len: value.length };
        } else out[key] = null;
      } else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      else if (SAFE_STRING_KEYS.has(key) && typeof value === 'string') out[key] = this.scrub(value, 150);
      else out[key] = this.scrub(JSON.stringify(value), 80);
    }
    return out;
  }

  /**
   * The agent's formatted tree (`idx|type|label|flags|tap_at`) as rows.
   * Tappable labels up to 30 characters stay readable (they are button names);
   * every other label, and every editable field, is hashed.
   */
  tree(raw: unknown): TreeRow[] | null {
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (!text.includes('idx|type|label|flags|tap_at')) return null;
    const rows: TreeRow[] = [];
    for (const line of text.split('\n').slice(1)) {
      const parts = line.split('|');
      if (parts.length < 5) continue;
      const [idx, type] = parts;
      const flags = parts[parts.length - 2];
      const tapAt = parts[parts.length - 1];
      const label = parts.slice(2, parts.length - 2).join('|');
      const [x, y] = tapAt.split(',').map(Number);
      const row: TreeRow = { i: Number(idx), t: type, f: flags, x, y };
      if (label) {
        const tappable = flags.includes('t') && !flags.includes('e');
        if (tappable && label.length <= 30 && !/\d{4,}/.test(label)) row.l = this.scrub(label, 30) ?? undefined;
        else row.lh = this.hash(label);
        row.ll = label.length;
      }
      rows.push(row);
    }
    return rows;
  }
}

export interface TreeRow {
  i: number;
  t: string;
  f: string;
  x: number;
  y: number;
  /** Label, kept only for short tappable elements. */
  l?: string;
  /** Hash of any other label. */
  lh?: string;
  /** Label length. */
  ll?: number;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{5,}/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>)]+/gi;
const BASE64_BLOB = /[A-Za-z0-9+/=]{200,}/g;
const SAFE_STRING_KEYS = new Set(['direction', 'action', 'key', 'packageName', 'screen', 'nodePath', 'viewId']);

export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const keys = [...url.searchParams.keys()];
    const query = keys.length ? `?${keys.map((k) => `${k}=*`).join('&')}` : '';
    return `${url.protocol}//${url.host}${url.pathname.replace(LONG_DIGITS, '<n>')}${query}`;
  } catch {
    return '<url>';
  }
}
