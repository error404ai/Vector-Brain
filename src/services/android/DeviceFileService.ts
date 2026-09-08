import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceFileStatus, DeviceFileTransfer } from '@/entities/DeviceFileTransfer';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import crypto from 'crypto';
import { LessThan } from 'typeorm';
import { Service } from 'typedi';

/**
 * Largest file the dashboard will accept.
 *
 * Bytes are stored in MySQL and travel to the server base64-encoded inside a
 * JSON body, so the wire cost is about 1.34x this. express.json is configured
 * with a 50mb limit in src/app.ts, which leaves comfortable headroom.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How long a queued file stays available before it is swept. */
const RETENTION_DAYS = 7;

/**
 * The companion app reads the "id" field of each listed file and pastes it
 * straight into the download URL. Sending it as a JSON string is the safer
 * default: kotlinx.serialization is far more forgiving about a quoted number
 * than about an unquoted one landing in a String field. If the phone ever logs a
 * parse error on the list response, flip this to false and redeploy.
 */
const SERIALIZE_ID_AS_STRING = true;

@Service()
export class DeviceFileService {
  private fileRepo = AppDataSource.getRepository(DeviceFileTransfer);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  /**
   * Queues a file for a device the caller owns.
   *
   * The dashboard posts the bytes base64-encoded rather than as multipart: the
   * backend has no multipart parser and the Docker build runs with a frozen
   * lockfile, so multer cannot be added.
   */
  async queueFile(
    userId: number,
    deviceId: number,
    fileName: string,
    mimeType: string,
    contentBase64: string,
  ): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId, user_id: userId } });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    let content: Buffer;
    try {
      content = Buffer.from(contentBase64, 'base64');
    } catch {
      throw new AppError('File content could not be decoded', 400);
    }

    if (content.length === 0) {
      throw new AppError('File is empty', 400);
    }

    if (content.length > MAX_FILE_BYTES) {
      throw new AppError(`File is too large. The limit is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`, 400);
    }

    const safeName = this.sanitiseFileName(fileName);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    const record = this.fileRepo.create({
      user_id: userId,
      device_id: device.id,
      file_name: safeName,
      mime_type: mimeType || 'application/octet-stream',
      size_bytes: content.length,
      sha256,
      content,
      status: DeviceFileStatus.PENDING,
      expires_at: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });

    await this.fileRepo.save(record);

    return {
      message: 'File queued for the device',
      data: {
        id: record.id,
        file_name: record.file_name,
        size_bytes: record.size_bytes,
        status: record.status,
        expires_at: record.expires_at.toISOString(),
      },
    };
  }

  /** Files the dashboard shows for one device, newest first. Never includes bytes. */
  async listForDashboard(userId: number, deviceId: number): Promise<ApiResponse> {
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      throw new AppError('A device_id is required', 400);
    }

    await this.sweepExpired();

    const files = await this.fileRepo.find({
      where: { user_id: userId, device_id: deviceId },
      order: { created_at: 'DESC' },
      take: 50,
    });

    return {
      message: 'Device files retrieved successfully',
      data: files.map((file) => ({
        id: file.id,
        file_name: file.file_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        status: file.status,
        failure_message: file.failure_message,
        delivered_at: file.delivered_at,
        expires_at: file.expires_at,
        created_at: file.created_at,
      })),
    };
  }

  async deleteForDashboard(userId: number, fileId: number): Promise<ApiResponse> {
    const file = await this.fileRepo.findOne({ where: { id: fileId, user_id: userId } });
    if (!file) {
      throw new AppError('File not found', 404);
    }
    await this.fileRepo.remove(file);
    return { message: 'File removed', data: { id: fileId } };
  }

  /**
   * The list the companion app polls.
   *
   * Shape is dictated by the app, not by us: it expects success/data/files and
   * reads id, name, size, sha256 and status off each entry, keeping only the
   * PENDING ones.
   */
  async listPendingForDevice(deviceIdString: string): Promise<{ success: boolean; data: { files: any[] } }> {
    await this.sweepExpired();

    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) {
      return { success: true, data: { files: [] } };
    }

    const files = await this.fileRepo.find({
      where: { device_id: device.id, status: DeviceFileStatus.PENDING },
      order: { created_at: 'ASC' },
      take: 20,
    });

    return {
      success: true,
      data: {
        files: files.map((file) => ({
          id: SERIALIZE_ID_AS_STRING ? String(file.id) : file.id,
          name: file.file_name,
          size: file.size_bytes,
          sha256: file.sha256,
          status: file.status,
          mime_type: file.mime_type,
        })),
      },
    };
  }

  /**
   * Loads one pending file including its bytes, for the content endpoint.
   *
   * `content` is select:false on the entity, so it has to be asked for by name.
   */
  async loadForDelivery(deviceIdString: string, fileId: number): Promise<DeviceFileTransfer> {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    const file = await this.fileRepo
      .createQueryBuilder('file')
      .addSelect('file.content')
      .where('file.id = :fileId', { fileId })
      .andWhere('file.device_id = :deviceId', { deviceId: device.id })
      .getOne();

    if (!file) {
      throw new AppError('File not found', 404);
    }

    if (new Date() > new Date(file.expires_at)) {
      throw new AppError('This file has expired', 410);
    }

    return file;
  }

  /**
   * Marks a transfer done or failed once the device reports back.
   *
   * A successful receipt drops the bytes immediately — the phone has the file,
   * so holding a second copy only inflates the database.
   */
  async recordReceipt(deviceIdString: string, fileId: number, success: boolean, message?: string): Promise<{ success: boolean; message: string }> {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    const file = await this.fileRepo.findOne({ where: { id: fileId, device_id: device.id } });
    if (!file) {
      throw new AppError('File not found', 404);
    }

    // update() rather than save(): the entity was loaded without its content
    // column, and an explicit column list leaves no room for TypeORM to decide
    // it should write the blob back.
    if (success) {
      await this.fileRepo.update(file.id, {
        status: DeviceFileStatus.DELIVERED,
        delivered_at: new Date(),
        failure_message: null,
        content: Buffer.alloc(0),
      });
    } else {
      await this.fileRepo.update(file.id, {
        status: DeviceFileStatus.FAILED,
        failure_message: (message || 'The device could not save the file').slice(0, 500),
      });
    }

    return { success: true, message: 'Receipt recorded' };
  }

  /**
   * Drops expired rows.
   *
   * Deliberately run from the list endpoints rather than on a timer: the table
   * is small, both list paths are hit regularly, and android_task_logs already
   * showed what happens when nothing prunes.
   */
  private async sweepExpired(): Promise<void> {
    try {
      await this.fileRepo.delete({ expires_at: LessThan(new Date()) });
    } catch {
      // Cleanup is best effort; never fail a listing because of it.
    }
  }

  /** Strips path separators so the device cannot be told to write outside its own folder. */
  private sanitiseFileName(name: string): string {
    const base = (name || 'file').split(/[\\/]/).pop() || 'file';
    const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
    return (cleaned || 'file').slice(0, 200);
  }
}
