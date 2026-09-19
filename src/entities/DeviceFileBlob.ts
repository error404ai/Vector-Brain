import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One copy of a file's bytes, keyed by its SHA-256.
 *
 * The reason this table exists: a file queued for the whole fleet used to store
 * a separate longblob per device — a 40 MB APK across 22 phones was ~880 MB of
 * identical bytes in the database. Here the bytes live once, and every
 * {@link DeviceFileTransfer} row for that file just carries the same sha256 and
 * points at this row. Delivery reads the blob by sha256; a receipt never
 * deletes it (that would pull the file out from under the phones still pending).
 * A blob is swept only once no transfer references it any more.
 *
 * Bytes stay in MySQL rather than on disk on purpose: Coolify wipes non-volume
 * paths on every deploy, and an S3 client would be a new npm dependency the
 * frozen lockfile forbids.
 */
@Entity('device_file_blobs')
export class DeviceFileBlob {
  /** Lowercase hex SHA-256 of the content. Natural key — same bytes, same row. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'int' })
  size_bytes: number;

  /**
   * Never selected by default — a listing must not drag tens of megabytes into
   * memory. The content endpoint asks for it explicitly.
   */
  @Column({ type: 'longblob', select: false })
  content: Buffer;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;
}
