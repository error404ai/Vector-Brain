import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { LandingShot } from '@/entities/LandingShot';
import { Mission } from '@/entities/Mission';
import { MissionItem } from '@/entities/MissionItem';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { In } from 'typeorm';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';

/** Slots the landing page reads. `fleet` and `app` hold many shots; the rest hold one. */
export const LANDING_SLOTS = [
  'hero-1', 'hero-2', 'hero-3', 'hero-4', 'hero-5',
  'step-1', 'step-2', 'step-3',
  'run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6',
  'fleet', 'app',
] as const;
export type LandingSlot = (typeof LANDING_SLOTS)[number];
const MULTI_SLOTS = new Set<string>(['fleet', 'app']);

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PHONES_PER_CAPTURE = 60;
/** Phones captured at once; each holds its own socket, so a few in parallel is fine. */
const CAPTURE_CONCURRENCY = 6;
const CAPTURE_TIMEOUT_MS = 20_000;

export interface CaptureResult {
  device_id: number;
  label: string;
  shot_id?: number;
  error?: string;
}

/** Reads the MIME type and pixel size from a PNG or JPEG header. */
export function sniffImage(buf: Buffer): { mime: string; width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return { mime: 'image/jpeg', width: 0, height: 0 };
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0–SOF15 (except DHT/JPG/DAC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', width: 0, height: 0 };
  }
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', width: 0, height: 0 };
  }
  return null;
}

/** Accepts raw base64 or a data: URL and returns the bytes. */
function decodeImage(data: string): Buffer {
  const comma = data.startsWith('data:') ? data.indexOf(',') : -1;
  return Buffer.from(comma >= 0 ? data.slice(comma + 1) : data, 'base64');
}

const view = (s: LandingShot) => ({
  id: s.id,
  kind: s.kind,
  source: s.source,
  device_id: s.device_id,
  label: s.label,
  device_model: s.device_model,
  mission_id: s.mission_id,
  mime: s.mime,
  width: s.width,
  height: s.height,
  size_bytes: s.size_bytes,
  slot: s.slot,
  approved: s.approved,
  created_at: s.created_at,
});

/**
 * Screenshots for the public landing page. Admins capture full-resolution
 * phone screens (or import a mission's final screens, or upload a capture of
 * an app page), assign each a slot and approve it. The public endpoints serve
 * approved shots only.
 */
@Service()
export class LandingShotService {
  private shotRepo = AppDataSource.getRepository(LandingShot);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private missionRepo = AppDataSource.getRepository(Mission);
  private itemRepo = AppDataSource.getRepository(MissionItem);

  constructor(private gatewayService: AndroidGatewayService) {}

  async list(): Promise<ApiResponse> {
    const shots = await this.shotRepo.find({ order: { created_at: 'DESC' }, take: 500 });
    return { message: 'Landing shots', data: { shots: shots.map(view), slots: LANDING_SLOTS } };
  }

  /**
   * Captures the screen of each given phone (the caller's own) at full
   * resolution. A phone that is running a task is skipped rather than
   * interrupted: its socket is busy with the agent, and a capture now would
   * slow the run down.
   */
  async capturePhones(userId: number, deviceIds: number[]): Promise<ApiResponse> {
    const ids = [...new Set(deviceIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_PHONES_PER_CAPTURE);
    if (!ids.length) throw new AppError('Pick at least one phone', 400);
    const devices = await this.deviceRepo.find({ where: { id: In(ids), user_id: userId } });
    const running = await this.taskRepo.find({ where: { device_id: In(devices.map((d) => d.id)), status: 'RUNNING' }, select: ['id', 'device_id'] });
    const busy = new Set(running.map((t) => t.device_id));

    const results: CaptureResult[] = [];
    const queue = [...devices];
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) results.push(await this.captureOne(userId, d, busy.has(d.id)));
    };
    await Promise.all(Array.from({ length: Math.min(CAPTURE_CONCURRENCY, queue.length) }, worker));
    for (const id of ids) if (!devices.some((d) => d.id === id)) results.push({ device_id: id, label: `#${id}`, error: 'Not one of your phones' });

    const saved = results.filter((r) => r.shot_id).length;
    return { message: `Captured ${saved} of ${ids.length}`, data: { results } };
  }

  private async captureOne(userId: number, device: AndroidDevice, busy: boolean): Promise<CaptureResult> {
    const label = device.device_name;
    if (busy) return { device_id: device.id, label, error: 'Running a task; capture it when the run ends' };
    if (device.status === AndroidDeviceStatus.OFFLINE) return { device_id: device.id, label, error: 'Offline' };
    try {
      const result = await this.gatewayService.executeAction(device.device_id, { type: 'CaptureScreen', preview: false, awaitStability: true }, CAPTURE_TIMEOUT_MS);
      const b64 = result.status === 'SUCCESS' ? result.screenCapture?.base64Data : undefined;
      if (!b64) return { device_id: device.id, label, error: result.status === 'FAILURE' ? result.message : 'The phone sent no image' };
      const shot = await this.store(userId, decodeImage(b64), {
        kind: 'phone', source: 'capture', device_id: device.id, label, device_model: device.device_model ?? null,
        width: result.status === 'SUCCESS' ? result.screenCapture?.width : undefined,
        height: result.status === 'SUCCESS' ? result.screenCapture?.height : undefined,
      });
      return { device_id: device.id, label, shot_id: shot.id };
    } catch (error) {
      Logger.warn(`[LandingShot] Capture failed for ${device.device_id}`, error);
      return { device_id: device.id, label, error: error instanceof Error ? error.message : 'Capture failed' };
    }
  }

  /**
   * Copies the final screen of every phone in a mission (the caller's latest
   * finished one when no id is given). The planner already saved these frames,
   * so nothing is asked of the phones.
   */
  async importMission(userId: number, missionId?: number): Promise<ApiResponse> {
    const mission = missionId
      ? await this.missionRepo.findOne({ where: { id: missionId, user_id: userId } })
      : await this.missionRepo.findOne({ where: { user_id: userId }, order: { id: 'DESC' } });
    if (!mission) throw new AppError('No mission found', 404);
    const items = await this.itemRepo.find({ where: { mission_id: mission.id } });
    const taskIds = items.map((i) => i.agent_task_id).filter((n): n is number => !!n);
    if (!taskIds.length) return { message: 'That mission has no finished phones yet', data: { mission_id: mission.id, imported: 0 } };
    const tasks = await this.taskRepo.find({ where: { id: In(taskIds) }, select: ['id', 'device_id', 'final_screenshot'] });
    const devices = await this.deviceRepo.find({ where: { id: In(items.map((i) => i.device_id)), user_id: userId } });
    const byId = new Map(devices.map((d) => [d.id, d]));
    const already = await this.shotRepo.find({ where: { mission_id: mission.id }, select: ['id', 'device_id'] });
    const have = new Set(already.map((s) => s.device_id));

    let imported = 0;
    for (const t of tasks) {
      if (!t.final_screenshot || have.has(t.device_id)) continue;
      const d = byId.get(t.device_id);
      try {
        await this.store(userId, decodeImage(t.final_screenshot), {
          kind: 'phone', source: 'mission', device_id: t.device_id, label: d?.device_name ?? `Phone ${t.device_id}`,
          device_model: d?.device_model ?? null, mission_id: mission.id,
        });
        imported++;
      } catch (error) {
        Logger.warn(`[LandingShot] Could not import final screen of task ${t.id}`, error);
      }
    }
    return { message: `Imported ${imported} final screens`, data: { mission_id: mission.id, imported } };
  }

  /** Stores a capture of one of the app's pages, sent by the browser. */
  async uploadPage(userId: number, image: string, label: string): Promise<ApiResponse> {
    if (typeof image !== 'string' || !image) throw new AppError('No image', 400);
    const shot = await this.store(userId, decodeImage(image), { kind: 'page', source: 'page', label: (label || 'App page').slice(0, 150) });
    return { message: 'Page captured', data: view(shot) };
  }

  private async store(
    userId: number,
    buf: Buffer,
    meta: { kind: LandingShot['kind']; source: LandingShot['source']; label: string; device_id?: number | null; device_model?: string | null; mission_id?: number | null; width?: number; height?: number },
  ): Promise<LandingShot> {
    if (buf.length > MAX_IMAGE_BYTES) throw new AppError('Image is larger than 12 MB', 413);
    const info = sniffImage(buf);
    if (!info) throw new AppError('Not a PNG, JPEG or WebP image', 400);
    const shot = this.shotRepo.create({
      user_id: userId,
      kind: meta.kind,
      source: meta.source,
      device_id: meta.device_id ?? null,
      label: meta.label.slice(0, 150),
      device_model: meta.device_model?.slice(0, 100) ?? null,
      mission_id: meta.mission_id ?? null,
      mime: info.mime,
      width: info.width || meta.width || 0,
      height: info.height || meta.height || 0,
      size_bytes: buf.length,
      image: buf,
      slot: null,
      approved: false,
    });
    const saved = await this.shotRepo.save(shot);
    saved.image = undefined as unknown as Buffer; // never echo the bytes back
    return saved;
  }

  /**
   * Sets a shot's slot and/or approval. Single slots (hero-1, step-2…) hold one
   * shot, so giving a slot to this shot takes it away from whichever had it.
   */
  async update(id: number, patch: { slot?: string | null; approved?: boolean; label?: string }): Promise<ApiResponse> {
    const shot = await this.shotRepo.findOne({ where: { id } });
    if (!shot) throw new AppError('Not found', 404);
    if (patch.slot !== undefined) {
      const slot = patch.slot === null || patch.slot === '' ? null : String(patch.slot);
      if (slot && !(LANDING_SLOTS as readonly string[]).includes(slot)) throw new AppError('Unknown slot', 400);
      if (slot && !MULTI_SLOTS.has(slot)) await this.shotRepo.update({ slot }, { slot: null });
      shot.slot = slot;
    }
    if (patch.approved !== undefined) shot.approved = Boolean(patch.approved);
    if (typeof patch.label === 'string' && patch.label.trim()) shot.label = patch.label.trim().slice(0, 150);
    await this.shotRepo.update({ id }, { slot: shot.slot, approved: shot.approved, label: shot.label });
    return { message: 'Saved', data: view(shot) };
  }

  async remove(id: number): Promise<ApiResponse> {
    const res = await this.shotRepo.delete({ id });
    if (!res.affected) throw new AppError('Not found', 404);
    return { message: 'Deleted' };
  }

  /** Image bytes; `publicOnly` refuses anything not approved and placed in a slot. */
  async image(id: number, publicOnly: boolean): Promise<{ mime: string; bytes: Buffer }> {
    const shot = await this.shotRepo.findOne({ where: { id }, select: ['id', 'mime', 'image', 'approved', 'slot'] });
    if (!shot || (publicOnly && (!shot.approved || !shot.slot))) throw new AppError('Not found', 404);
    return { mime: shot.mime, bytes: shot.image };
  }

  /** What the landing page reads: approved shots that have a slot. */
  async publicList(): Promise<ApiResponse> {
    const shots = await this.shotRepo.find({ where: { approved: true }, order: { created_at: 'DESC' }, take: 200 });
    return {
      message: 'Landing shots',
      data: shots
        .filter((s) => s.slot)
        .map((s) => ({ id: s.id, kind: s.kind, slot: s.slot, label: s.label, device_model: s.device_model, width: s.width, height: s.height, path: `/public/landing-shots/${s.id}/image` })),
    };
  }
}
