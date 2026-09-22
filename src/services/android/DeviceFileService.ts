import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceFileBlob } from '@/entities/DeviceFileBlob';
import { DeviceFileStatus, DeviceFileTransfer } from '@/entities/DeviceFileTransfer';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import crypto from 'crypto';
import { In, LessThan } from 'typeorm';
import { Service } from 'typedi';

/**
 * Largest single file the dashboard accepts.
 *
 * Raised from 10 MB so an APK pushed for auto-update fits — release builds land
 * around 30-50 MB. The old single-JSON-body upload could not carry this (base64
 * inflates it ~1.34x and express.json caps at 50 MB), which is why files above
 * ~37 MB were rejected; large files now come in as raw binary chunks through the
 * init/chunk/finish flow below, so nothing is base64-encoded on the wire.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Small-file base64 path still uses the old limit — it rides inside a JSON body. */
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

/** Largest single chunk of a chunked upload. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/** How long a queued file stays available before it is swept. */
const RETENTION_DAYS = 7;

/** Devices one upload may be queued for at a time. */
const MAX_DEVICES_PER_QUEUE = 100;

/** How long an unfinished chunked upload lingers before it is dropped. */
const UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * The companion app reads the "id" field of each listed file and pastes it
 * straight into the download URL. Sending it as a JSON string is the safer
 * default: kotlinx.serialization is far more forgiving about a quoted number
 * than about an unquoted one landing in a String field.
 */
const SERIALIZE_ID_AS_STRING = true;

/** An in-flight chunked upload, held in memory until finished or expired. */
interface UploadSession {
  userId: number;
  deviceIds: number[];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  chunks: (Buffer | undefined)[];
  totalChunks: number;
  receivedBytes: number;
  createdAt: number;
}

@Service()
export class DeviceFileService {
  private fileRepo = AppDataSource.getRepository(DeviceFileTransfer);
  private blobRepo = AppDataSource.getRepository(DeviceFileBlob);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  private uploads = new Map<string, UploadSession>();

  // ---------------------------------------------------------------------------
  // Small-file path (base64 in a JSON body) - unchanged interface, blob-backed.
  // ---------------------------------------------------------------------------

  async queueFile(
    userId: number,
    deviceIds: number[],
    fileName: string,
    mimeType: string,
    contentBase64: string,
  ): Promise<ApiResponse> {
    const devices = await this.resolveOwnedDevices(userId, deviceIds);

    let content: Buffer;
    try {
      content = Buffer.from(contentBase64, 'base64');
    } catch {
      throw new AppError('File content could not be decoded', 400);
    }
    if (content.length === 0) throw new AppError('File is empty', 400);
    if (content.length > MAX_INLINE_BYTES) {
      throw new AppError(
        `That file is ${Math.round(content.length / (1024 * 1024))} MB. Files above ${Math.floor(
          MAX_INLINE_BYTES / (1024 * 1024),
        )} MB must be uploaded in chunks.`,
        400,
      );
    }

    return this.storeForDevices(userId, devices, fileName, mimeType, content);
  }

  // ---------------------------------------------------------------------------
  // Large-file path (raw binary chunks) - init / appendChunk / finishUpload.
  // ---------------------------------------------------------------------------

  /**
   * Opens a chunked upload and returns its id.
   *
   * Bytes are never base64-encoded here - the chunk endpoint takes raw
   * application/octet-stream - so a 50 MB APK travels as 50 MB, not 67 MB, and
   * never touches the 50 MB express.json ceiling.
   */
  async initUpload(
    userId: number,
    deviceIds: number[],
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    sha256: string,
    totalChunks: number,
  ): Promise<ApiResponse> {
    const devices = await this.resolveOwnedDevices(userId, deviceIds);

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
      throw new AppError(`File is too large. The limit is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`, 400);
    }
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new AppError('A valid sha256 is required', 400);
    }
    if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > 10_000) {
      throw new AppError('Invalid chunk count', 400);
    }

    this.sweepUploadSessions();

    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, {
      userId,
      deviceIds: devices.map((d) => d.id),
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes,
      sha256: sha256.toLowerCase(),
      chunks: new Array(totalChunks),
      totalChunks,
      receivedBytes: 0,
      createdAt: Date.now(),
    });

    return { message: 'Upload started', data: { upload_id: uploadId, chunk_size: MAX_CHUNK_BYTES } };
  }

  /** Stores one raw chunk at its index. */
  async appendChunk(userId: number, uploadId: string, index: number, chunk: Buffer): Promise<ApiResponse> {
    const session = this.uploads.get(uploadId);
    if (!session || session.userId !== userId) throw new AppError('Upload not found', 404);
    if (!Number.isFinite(index) || index < 0 || index >= session.totalChunks) {
      throw new AppError('Chunk index out of range', 400);
    }
    if (!chunk || chunk.length === 0) throw new AppError('Empty chunk', 400);
    if (chunk.length > MAX_CHUNK_BYTES) throw new AppError('Chunk too large', 400);

    if (session.chunks[index] === undefined) {
      session.receivedBytes += chunk.length;
      if (session.receivedBytes > session.sizeBytes) {
        this.uploads.delete(uploadId);
        throw new AppError('Uploaded data exceeded the declared size', 400);
      }
    }
    session.chunks[index] = chunk;

    return { message: 'Chunk received', data: { index, received_bytes: session.receivedBytes } };
  }

  /**
   * Assembles the chunks, verifies the SHA-256, stores the blob once and queues
   * a transfer row per device.
   */
  async finishUpload(userId: number, uploadId: string): Promise<ApiResponse> {
    const session = this.uploads.get(uploadId);
    if (!session || session.userId !== userId) throw new AppError('Upload not found', 404);

    for (let i = 0; i < session.totalChunks; i += 1) {
      if (session.chunks[i] === undefined) {
        throw new AppError(`Chunk ${i} is missing`, 400);
      }
    }

    const content = Buffer.concat(session.chunks as Buffer[]);
    if (content.length !== session.sizeBytes) {
      this.uploads.delete(uploadId);
      throw new AppError('Assembled size does not match the declared size', 400);
    }
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (digest !== session.sha256) {
      this.uploads.delete(uploadId);
      throw new AppError('The upload failed its integrity check', 400);
    }

    // Devices are re-checked at finish time in case one was unpaired mid-upload.
    const devices = await this.resolveOwnedDevices(userId, session.deviceIds);
    this.uploads.delete(uploadId);

    return this.storeForDevices(userId, devices, session.fileName, session.mimeType, content, digest);
  }

  // ---------------------------------------------------------------------------
  // Shared storage - one blob, many transfer rows.
  // ---------------------------------------------------------------------------

  private async storeForDevices(
    userId: number,
    devices: AndroidDevice[],
    fileName: string,
    mimeType: string,
    content: Buffer,
    knownSha256?: string,
  ): Promise<ApiResponse> {
    if (content.length > MAX_FILE_BYTES) {
      throw new AppError(`File is too large. The limit is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`, 400);
    }

    const safeName = this.sanitiseFileName(fileName);
    const sha256 = knownSha256 ?? crypto.createHash('sha256').update(content).digest('hex');
    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // The bytes go in exactly once. If this file (or an identical one) is already
    // stored, the insert is a no-op - that is the whole point of keying on sha256.
    const existing = await this.blobRepo.findOne({ where: { sha256 } });
    if (!existing) await this.writeBlobInSlices(sha256, content);

    const records = devices.map((device) =>
      this.fileRepo.create({
        user_id: userId,
        device_id: device.id,
        file_name: safeName,
        mime_type: mimeType || 'application/octet-stream',
        size_bytes: content.length,
        sha256,
        content: null, // bytes live in the blob now, not per row
        status: DeviceFileStatus.PENDING,
        expires_at: expiresAt,
      }),
    );

    // Chunked so a large fleet does not build one enormous INSERT.
    for (let start = 0; start < records.length; start += 20) {
      await this.fileRepo.save(records.slice(start, start + 20));
    }

    return {
      message:
        devices.length === 1 ? 'File queued for the device' : `File queued for ${devices.length} devices`,
      data: {
        id: records[0].id,
        file_name: safeName,
        size_bytes: content.length,
        sha256,
        status: DeviceFileStatus.PENDING,
        expires_at: expiresAt.toISOString(),
        device_count: devices.length,
        queued: records.map((record) => ({ id: record.id, device_id: record.device_id })),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Listing / delivery / receipt.
  // ---------------------------------------------------------------------------

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
    if (!file) throw new AppError('File not found', 404);
    await this.fileRepo.remove(file);
    await this.sweepOrphanBlobs();
    return { message: 'File removed', data: { id: fileId } };
  }

  async listPendingForDevice(deviceIdString: string): Promise<{ success: boolean; data: any[]; files: any[] }> {
    await this.sweepExpired();

    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) return { success: true, data: [], files: [] };

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
   * Loads one pending file's metadata and its bytes for the content endpoint.
   *
   * New rows carry no inline content, so the bytes come from the shared blob by
   * sha256; a legacy row with its own content still works.
   */
  /**
   * Streams a stored file to a phone in slices.
   *
   * Delivery used to read the whole file into memory before sending it, which
   * is fine once and expensive twenty-two times: a 24 MB APK being collected by
   * a whole fleet is half a gigabyte of buffers on a box that is already tight
   * on RAM. SUBSTRING pulls a few megabytes at a time straight out of the row,
   * so the cost per phone stays flat.
   */
  async *streamForDelivery(deviceIdString: string, fileId: number, chunkBytes = 4 * 1024 * 1024) {
    const meta = await this.describeForDelivery(deviceIdString, fileId);

    if (meta.source === 'chunks') {
      const rows: { chunk_index: number }[] = await this.blobRepo.query(
        'SELECT chunk_index FROM device_file_blob_chunks WHERE sha256 = ? ORDER BY chunk_index ASC',
        [meta.sha256],
      );
      for (const row of rows) {
        const [chunk] = await this.blobRepo.query(
          'SELECT content FROM device_file_blob_chunks WHERE sha256 = ? AND chunk_index = ? LIMIT 1',
          [meta.sha256, row.chunk_index],
        );
        if (chunk?.content) yield chunk.content as Buffer;
      }
      return;
    }

    // Inline bytes on the transfer row, or a blob written before slices existed.
    const table = meta.source === 'blob' ? 'device_file_blobs' : 'device_file_transfers';
    const idColumn = meta.source === 'blob' ? 'sha256' : 'id';
    const idValue = meta.source === 'blob' ? meta.sha256 : fileId;

    for (let offset = 0; offset < meta.size_bytes; offset += chunkBytes) {
      // SUBSTRING is 1-based over the stored bytes.
      const [row] = await this.fileRepo.query(
        `SELECT SUBSTRING(content, ?, ?) AS part FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
        [offset + 1, chunkBytes, idValue],
      );
      const part: Buffer | null = row?.part ?? null;
      if (!part || part.length === 0) break;
      yield part;
    }
  }

  /**
   * Writes a blob a few megabytes at a time.
   *
   * MySQL refuses any single statement larger than max_allowed_packet, so a
   * 24 MB APK sent as one INSERT is rejected outright — and the transfer rows
   * were still queued afterwards, which is how a phone ended up being offered a
   * file whose bytes had never been stored and answering "download failed (410)".
   * The row is created empty and appended to, then checked: if the stored length
   * does not match, this throws and nothing is queued.
   */
  private async writeBlobInSlices(sha256: string, content: Buffer, sliceBytes = 4 * 1024 * 1024): Promise<void> {
    // The metadata row carries no bytes; the slices below do.
    await this.blobRepo.query(
      'INSERT IGNORE INTO device_file_blobs (sha256, size_bytes, content, created_at) VALUES (?, ?, NULL, NOW())',
      [sha256, content.length],
    );
    await this.blobRepo.query('DELETE FROM device_file_blob_chunks WHERE sha256 = ?', [sha256]);

    let index = 0;
    for (let offset = 0; offset < content.length; offset += sliceBytes) {
      const slice = content.subarray(offset, Math.min(offset + sliceBytes, content.length));
      await this.blobRepo.query(
        'INSERT INTO device_file_blob_chunks (sha256, chunk_index, content, size_bytes) VALUES (?, ?, ?, ?)',
        [sha256, index, slice, slice.length],
      );
      index += 1;
    }

    const [row] = await this.blobRepo.query(
      'SELECT COALESCE(SUM(size_bytes), 0) AS stored FROM device_file_blob_chunks WHERE sha256 = ?',
      [sha256],
    );
    const stored = Number(row?.stored ?? 0);
    if (stored !== content.length) {
      // Nothing is queued for a file whose bytes are not all there.
      await this.blobRepo.query('DELETE FROM device_file_blob_chunks WHERE sha256 = ?', [sha256]);
      await this.blobRepo.query('DELETE FROM device_file_blobs WHERE sha256 = ?', [sha256]);
      throw new AppError(`The file could not be stored (kept ${stored} of ${content.length} bytes). Please try again.`, 500);
    }
  }

  /** Delivery metadata without pulling the bytes. */
  async describeForDelivery(deviceIdString: string, fileId: number) {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) throw new AppError('Device not found', 404);

    const file = await this.fileRepo.findOne({ where: { id: fileId, device_id: device.id } });
    if (!file) throw new AppError('File not found', 404);
    if (new Date() > new Date(file.expires_at)) throw new AppError('This file has expired', 410);

    const [inline] = await this.fileRepo.query(
      'SELECT LENGTH(content) AS length FROM device_file_transfers WHERE id = ? LIMIT 1',
      [fileId],
    );
    let source: 'inline' | 'chunks' | 'blob' = 'inline';

    if (!Number(inline?.length ?? 0)) {
      const [chunks] = await this.blobRepo.query(
        'SELECT COALESCE(SUM(size_bytes), 0) AS stored FROM device_file_blob_chunks WHERE sha256 = ?',
        [file.sha256],
      );
      if (Number(chunks?.stored ?? 0) > 0) {
        source = 'chunks';
      } else {
        // Files stored before slices existed keep their bytes in one column.
        const [blob] = await this.blobRepo.query(
          'SELECT LENGTH(content) AS length FROM device_file_blobs WHERE sha256 = ? LIMIT 1',
          [file.sha256],
        );
        if (!Number(blob?.length ?? 0)) throw new AppError('File content is no longer available', 410);
        source = 'blob';
      }
    }

    return {
      file_name: file.file_name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
      source,
    };
  }

  async loadForDelivery(
    deviceIdString: string,
    fileId: number,
  ): Promise<{ file_name: string; mime_type: string; size_bytes: number; sha256: string; content: Buffer }> {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) throw new AppError('Device not found', 404);

    const file = await this.fileRepo
      .createQueryBuilder('file')
      .addSelect('file.content')
      .where('file.id = :fileId', { fileId })
      .andWhere('file.device_id = :deviceId', { deviceId: device.id })
      .getOne();

    if (!file) throw new AppError('File not found', 404);
    if (new Date() > new Date(file.expires_at)) throw new AppError('This file has expired', 410);

    let content = file.content;
    if (!content || content.length === 0) {
      const blob = await this.blobRepo
        .createQueryBuilder('blob')
        .addSelect('blob.content')
        .where('blob.sha256 = :sha256', { sha256: file.sha256 })
        .getOne();
      if (!blob) throw new AppError('File content is no longer available', 410);
      content = blob.content;
    }

    return {
      file_name: file.file_name,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
      content,
    };
  }

  /**
   * Marks a transfer delivered or failed.
   *
   * A success no longer wipes any bytes - the blob is shared, so deleting it
   * would break every other phone still waiting for the same file. The blob is
   * removed later by sweepOrphanBlobs once nothing references it.
   */
  async recordReceipt(
    deviceIdString: string,
    fileId: number,
    success: boolean,
    message?: string,
  ): Promise<{ success: boolean; message: string }> {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceIdString } });
    if (!device) throw new AppError('Device not found', 404);

    const file = await this.fileRepo.findOne({ where: { id: fileId, device_id: device.id } });
    if (!file) throw new AppError('File not found', 404);

    if (success) {
      await this.fileRepo.update(file.id, {
        status: DeviceFileStatus.DELIVERED,
        delivered_at: new Date(),
        failure_message: null,
        content: null,
      });
      await this.sweepOrphanBlobs();
    } else {
      await this.fileRepo.update(file.id, {
        status: DeviceFileStatus.FAILED,
        failure_message: (message || 'The device could not save the file').slice(0, 500),
      });
    }

    return { success: true, message: 'Receipt recorded' };
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

  private async resolveOwnedDevices(userId: number, deviceIds: number[]): Promise<AndroidDevice[]> {
    const wantedIds = Array.from(new Set(deviceIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (wantedIds.length === 0) throw new AppError('Pick at least one device', 400);
    if (wantedIds.length > MAX_DEVICES_PER_QUEUE) {
      throw new AppError(`You can send a file to at most ${MAX_DEVICES_PER_QUEUE} devices at once.`, 400);
    }
    const devices = await this.deviceRepo.find({ where: { id: In(wantedIds), user_id: userId } });
    if (devices.length !== wantedIds.length) {
      throw new AppError('One or more devices were not found', 404);
    }
    return devices;
  }

  private sweepUploadSessions(): void {
    const cutoff = Date.now() - UPLOAD_SESSION_TTL_MS;
    for (const [id, session] of this.uploads) {
      if (session.createdAt < cutoff) this.uploads.delete(id);
    }
  }

  private async sweepExpired(): Promise<void> {
    try {
      await this.fileRepo.delete({ expires_at: LessThan(new Date()) });
      await this.sweepOrphanBlobs();
    } catch {
      // Cleanup is best effort; never fail a listing because of it.
    }
  }

  /** Drops any blob no transfer row still points at. */
  private async sweepOrphanBlobs(): Promise<void> {
    try {
      await this.blobRepo.query(
        `DELETE b FROM device_file_blobs b
         LEFT JOIN device_file_transfers t ON t.sha256 = b.sha256
         WHERE t.id IS NULL`,
      );
      await this.blobRepo.query(
        `DELETE c FROM device_file_blob_chunks c
         LEFT JOIN device_file_transfers t ON t.sha256 = c.sha256
         WHERE t.id IS NULL`,
      );
    } catch {
      // Best effort.
    }
  }

  private sanitiseFileName(name: string): string {
    const base = (name || 'file').split(/[\\/]/).pop() || 'file';
    const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
    return (cleaned || 'file').slice(0, 200);
  }
}
