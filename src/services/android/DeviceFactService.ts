import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceFact } from '@/entities/DeviceFact';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';

export const EMAIL_FACT = 'email';
const MAX_EMAILS = 10;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const FULL_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/**
 * Appended to a run's instruction when the chat asks phones for their email
 * accounts. The fixed "EMAILS:" line is what the server reads — never the
 * rest of the report — so a run that merely mentions an address ("sent a
 * mail to x@y.com") can't be mistaken for the phone's own account.
 */
export const EMAIL_REPORT_INSTRUCTION =
  'At the end, finish your report with one line exactly like "EMAILS: a@x.com, b@y.com" listing every email account signed in on this phone (write "EMAILS: none" if there is none).';

/** What a surface shows for one phone's emails. */
export interface EmailFactView {
  emails: string[];
  source: 'ai' | 'user';
  mission_id: number | null;
  updated_at: Date;
  /** A newer read that disagrees with what the user entered. */
  suggested: string[] | null;
  suggested_mission_id: number | null;
}

const parseList = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const normalize = (emails: string[]): string[] => [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_EMAILS);

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

/**
 * The emails a phone reported, from its "EMAILS:" line. null when the report
 * has no such line (the run wasn't asked, or didn't answer) — that must leave
 * the stored value alone, unlike "EMAILS: none", which is a real answer.
 */
export function emailsFromReport(report: string | null | undefined): string[] | null {
  if (!report) return null;
  const lines = report.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /\bEMAILS?\s*:\s*(.*)$/i.exec(lines[i]);
    if (!match) continue;
    const found = match[1].match(EMAIL_RE) ?? [];
    if (found.length) return normalize(found);
    if (/\b(none|no (email|account)s?|not signed|nahi|koi nahi)\b/i.test(match[1])) return [];
    return null;
  }
  return null;
}

@Service()
export class DeviceFactService {
  private factRepo = AppDataSource.getRepository(DeviceFact);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  /** Emails per phone id, for the fleet state and the chat. */
  async emailsByDevice(userId: number): Promise<Map<number, EmailFactView>> {
    const rows = await this.factRepo.find({ where: { user_id: userId, fact_key: EMAIL_FACT } });
    return new Map(rows.map((row) => [row.device_id, this.view(row)]));
  }

  /**
   * Stores what a finished run read off a phone. A run fills or refreshes an
   * AI value; a user-entered value is kept and a differing read is parked for
   * the user to decide.
   */
  async recordReport(userId: number, deviceId: number, report: string | null | undefined, missionId: number | null): Promise<void> {
    const emails = emailsFromReport(report);
    if (emails === null) return;
    try {
      const existing = await this.factRepo.findOne({ where: { device_id: deviceId, fact_key: EMAIL_FACT } });
      if (!existing) {
        await this.factRepo.save(
          this.factRepo.create({ user_id: userId, device_id: deviceId, fact_key: EMAIL_FACT, value: JSON.stringify(emails), source: 'ai', mission_id: missionId }),
        );
        return;
      }
      if (existing.user_id !== userId) return;
      const current = parseList(existing.value);
      if (existing.source === 'user') {
        if (sameSet(current, emails)) {
          existing.suggested = null;
          existing.suggested_mission_id = null;
        } else {
          existing.suggested = JSON.stringify(emails);
          existing.suggested_mission_id = missionId;
        }
      } else {
        existing.value = JSON.stringify(emails);
        existing.mission_id = missionId;
        existing.suggested = null;
        existing.suggested_mission_id = null;
      }
      await this.factRepo.save(existing);
    } catch (error) {
      // A lost fact must never break the run that produced it.
      Logger.warn(`[DeviceFact] could not store emails for device ${deviceId}: ${(error as Error).message}`);
    }
  }

  /** The user's own list for a phone. It wins over later reads until they reset it. */
  async setEmails(userId: number, deviceId: number, emails: string[]): Promise<ApiResponse> {
    await this.ownedDevice(userId, deviceId);
    const entries = emails.map((e) => String(e).trim()).filter(Boolean);
    const bad = entries.filter((e) => !FULL_EMAIL_RE.test(e));
    const clean = normalize(entries);
    if (bad.length) throw new AppError(`Not an email: ${bad.slice(0, 3).join(', ')}`, 400);
    const row =
      (await this.factRepo.findOne({ where: { device_id: deviceId, fact_key: EMAIL_FACT } })) ??
      this.factRepo.create({ user_id: userId, device_id: deviceId, fact_key: EMAIL_FACT });
    row.value = JSON.stringify(clean);
    row.source = 'user';
    row.mission_id = null;
    row.suggested = null;
    row.suggested_mission_id = null;
    const saved = await this.factRepo.save(row);
    return { message: 'Emails saved', data: this.view(saved) };
  }

  /** Take the parked read: it becomes the value, still the user's choice. */
  async acceptSuggestion(userId: number, deviceId: number): Promise<ApiResponse> {
    const row = await this.ownedFact(userId, deviceId);
    if (row.suggested === null) throw new AppError('Nothing to accept', 400);
    row.value = row.suggested;
    row.mission_id = row.suggested_mission_id;
    row.suggested = null;
    row.suggested_mission_id = null;
    const saved = await this.factRepo.save(row);
    return { message: 'Emails updated', data: this.view(saved) };
  }

  async dismissSuggestion(userId: number, deviceId: number): Promise<ApiResponse> {
    const row = await this.ownedFact(userId, deviceId);
    row.suggested = null;
    row.suggested_mission_id = null;
    const saved = await this.factRepo.save(row);
    return { message: 'Kept your emails', data: this.view(saved) };
  }

  /** Forget the phone's emails; the next run that reads them fills them again. */
  async clear(userId: number, deviceId: number): Promise<ApiResponse> {
    await this.ownedDevice(userId, deviceId);
    await this.factRepo.delete({ user_id: userId, device_id: deviceId, fact_key: EMAIL_FACT });
    return { message: 'Emails cleared' };
  }

  private view(row: DeviceFact): EmailFactView {
    return {
      emails: parseList(row.value),
      source: row.source,
      mission_id: row.mission_id,
      updated_at: row.updated_at,
      suggested: row.suggested === null ? null : parseList(row.suggested),
      suggested_mission_id: row.suggested_mission_id,
    };
  }

  private async ownedDevice(userId: number, deviceId: number) {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId, user_id: userId } });
    if (!device) throw new AppError('Phone not found', 404);
    return device;
  }

  private async ownedFact(userId: number, deviceId: number) {
    const row = await this.factRepo.findOne({ where: { user_id: userId, device_id: deviceId, fact_key: EMAIL_FACT } });
    if (!row) throw new AppError('No emails saved for this phone', 404);
    return row;
  }
}
