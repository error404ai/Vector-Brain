import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceUpload } from '@/entities/DeviceUpload';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { createHash } from 'crypto';
import { Service } from 'typedi';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SLICE_BYTES = 4 * 1024 * 1024;
const KEEP_DAYS = 7;

/**
 * Files phones send up (companion 0.32 UploadFile). Stored in slices so no
 * single statement passes MySQL's packet limit; read back slice by slice for
 * the dashboard's download.
 */
@Service()
export class DeviceUploadService {
  private uploadRepo = AppDataSource.getRepository(DeviceUpload);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private lastSweep = 0;

  async store(deviceIdString: string, userId: number, rawName: string, mimeType: string, content: Buffer): Promise<DeviceUpload> {
    if (!content.length) throw new AppError('The file is empty', 400);
    if (content.length > MAX_UPLOAD_BYTES) throw new AppError('Up to 50 MB can be sent', 413);
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString, user_id: userId } });
    if (!device) throw new AppError('This device is no longer paired', 404);
    const upload = await this.uploadRepo.save(
      this.uploadRepo.create({
        user_id: userId,
        device_id: device.id,
        file_name: cleanName(rawName),
        mime_type: /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType.slice(0, 150) : 'application/octet-stream',
        size_bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      }),
    );
    try {
      for (let offset = 0, index = 0; offset < content.length; offset += SLICE_BYTES, index += 1) {
        await this.uploadRepo.query('INSERT INTO device_upload_chunks (upload_id, chunk_index, content) VALUES (?, ?, ?)', [upload.id, index, content.subarray(offset, offset + SLICE_BYTES)]);
      }
    } catch (error) {
      await this.remove(upload.id);
      throw error;
    }
    void this.sweep();
    return upload;
  }

  async list(userId: number, deviceId?: number): Promise<(DeviceUpload & { device_name: string | null })[]> {
    void this.sweep();
    const rows = await this.uploadRepo.find({ where: { user_id: userId, ...(deviceId ? { device_id: deviceId } : {}) }, order: { id: 'DESC' }, take: 100 });
    const devices = rows.length ? await this.deviceRepo.findByIds([...new Set(rows.map((r) => r.device_id))]) : [];
    const names = new Map(devices.map((d) => [d.id, d.device_name]));
    return rows.map((r) => ({ ...r, device_name: names.get(r.device_id) ?? null }));
  }

  async owned(userId: number, id: number): Promise<DeviceUpload> {
    const upload = await this.uploadRepo.findOne({ where: { id, user_id: userId } });
    if (!upload) throw new AppError('File not found', 404);
    return upload;
  }

  /** The bytes, slice by slice. */
  async *read(id: number): AsyncGenerator<Buffer> {
    for (let index = 0; ; index += 1) {
      const [row] = await this.uploadRepo.query('SELECT content FROM device_upload_chunks WHERE upload_id = ? AND chunk_index = ?', [id, index]);
      if (!row) return;
      yield Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    }
  }

  async delete(userId: number, id: number): Promise<void> {
    await this.owned(userId, id);
    await this.remove(id);
  }

  private async remove(id: number): Promise<void> {
    await this.uploadRepo.query('DELETE FROM device_upload_chunks WHERE upload_id = ?', [id]);
    await this.uploadRepo.delete({ id });
  }

  private async sweep(): Promise<void> {
    if (Date.now() - this.lastSweep < 3600_000) return;
    this.lastSweep = Date.now();
    try {
      const old = await this.uploadRepo.query(`SELECT id FROM device_uploads WHERE created_at < NOW() - INTERVAL ${KEEP_DAYS} DAY LIMIT 200`);
      for (const row of old as { id: number }[]) await this.remove(row.id);
    } catch {
      // Best effort.
    }
  }
}

function cleanName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    /* as sent */
  }
  const base = (decoded || 'file').split(/[\\/]/).pop() || 'file';
  return (base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim() || 'file').slice(0, 200);
}
