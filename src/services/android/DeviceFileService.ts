import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceFileStatus, DeviceFileTransfer } from '@/entities/DeviceFileTransfer';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import crypto from 'crypto';
import { In, LessThan } from 'typeorm';
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

/** Devices one upload may be queued for at a time. */
const MAX_DEVICES_PER_QUEUE = 100;

/**
 * Ceiling on the bytes a single upload may add to the table.
 *
 * Each device gets its own row holding its own copy, because a row drops its
 * bytes the moment that phone confirms receipt — sharing one blob between rows
 * would mean the first device to finish deletes the file out from under the
 * rest. The copies are therefore temporary, but 10 MB across a hundred phones
 * is still a gigabyte arriving at once, so the total is capped.
 */
const MAX_TOTAL_QUEUED_BYTES = 300 * 1024 * 1024;

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
    deviceIds: number[],
    fileName: string,
    mimeType: string,
    contentBase64: string,
  ): Promise<ApiResponse> {
    const wantedIds = Array.from(new Set(deviceIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (wantedIds.length === 0) {
      throw new AppError('Pick at least one device', 400);
    }
    if (wantedIds.length > MAX_DEVICES_PER_QUEUE) {
      throw new AppError(`You can send a file to at most ${MAX_DEVICES_PER_QUEUE} devices at once.`, 400);
    }

    // Loaded in one query and checked against what was asked for, so a device
    // belonging to somebody else is refused rather than quietly skipped.
    const devices = await this.deviceRepo.find({ where: { id: In(wantedIds), user_id: userId } });
    if (devices.length !== wantedIds.length) {
      throw new AppError('One or more devices were not found', 404);
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

    if (content.length * devices.length > MAX_TOTAL_QUEUED_BYTES) {
      const allowed = Math.max(1, Math.floor(MAX_TOTAL_QUEUED_BYTES / content.length));
      throw new AppError(`That file is too large for ${devices.length} devices. Send it to at most ${allowed} at a time.`, 400);
    }

    const safeName = this.sanitiseFileName(fileName);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const records = devices.map((device) =>
      this.fileRepo.create({
        user_id: userId,
        device_id: device.id,
        file_name: safeName,
        mime_type: mimeType || 'application/octet-stream',
        size_bytes: content.length,
        sha256,
        content,
        status: DeviceFileStatus.PENDING,
        expires_at: expiresAt,
      }),
    );

    // Chunked so a large fleet does not build one enormous INSERT: at 10 MB a
    // copy, a single statement for a hundred rows would sail past max_allowed_packet.
    for (let start = 0; start < records.length; start += 5) {
      await this.fileRepo.save(records.slice(start, start + 5));
    }

    return {
      message:
        devices.length === 1
          ? 'File queued for the device'
          : `File queued for ${devices.length} devices`,
      data: {
        id: records[0].id,
        file_name: safeName,
        size_bytes: content.length,
        status: DeviceFileStatus.PENDING,
        expires_at: expiresAt.toISOString(),
        device_count: devices.length,
        queued: records.map((record) => ({ id: record.id, device_id: record.device_id })),
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
   * Shape is dictated by the app, not by us: `data` must be the array of files
   * itself. Wrapping it in an object made the phone report
   * "JsonObject is not a JsonArray". A duplicate `files` key rides along because
   * it costs nothing and covers a build that reads the other spelling.
   */
  async listPendingForDevice(deviceIdString: string): Promise<{ success: boolean; data: any[]; files: any[] }> {
    await this.sweepExpired();

    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) {
      return { success: true, data: [], files: [] };
    }

    const files = await this.fileRepo.find({
      where: { device_id: device.id, status: DeviceFileStatus.PENDING },
      order: { created_at: 'ASC' },
      take: 20,
    });

    const payload = files.map((file) => ({
      id: SERIALIZE_ID_AS_STRING ? String(file.id) : file.id,
      name: file.file_name,
      size: file.size_bytes,
      sha256: file.sha256,
      status: file.status,
      mime_type: file.mime_type,
    }));

    return { success: true, data: payload, files: payload };
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
