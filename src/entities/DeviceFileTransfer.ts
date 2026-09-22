import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { AndroidDevice } from './AndroidDevice';
import { User } from './User';

export enum DeviceFileStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

/**
 * A file queued from the dashboard for delivery to a paired Android device.
 *
 * The companion app polls GET /api/android/companion/files, downloads the bytes
 * from .../files/:id/content, verifies the SHA-256 itself and then posts back to
 * .../files/:id/receipt. Rows are kept only until they expire so the table does
 * not grow the way android_task_logs did.
 *
 * Bytes live in a LONGBLOB rather than on disk on purpose: Coolify wipes
 * non-volume paths on every deploy, and adding an S3 client would mean a new npm
 * package, which the frozen lockfile forbids.
 */
@Entity('device_file_transfers')
export class DeviceFileTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  device_id: number;

  /** Filename the device will use in Downloads/VectorAutomation. */
  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 150, default: 'application/octet-stream' })
  mime_type: string;

  @Column({ type: 'int' })
  size_bytes: number;

  /** Lowercase hex. The companion app recomputes this and rejects a mismatch. */
  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  /**
   * Legacy inline copy. Nullable and unused by new uploads, which store the
   * bytes once in device_file_blobs keyed by {@link sha256} and leave this null.
   * Kept so rows written by the old code path still deliver.
   */
  @Column({ type: 'longblob', select: false, nullable: true })
  content: Buffer | null;

  @Column({ type: 'enum', enum: DeviceFileStatus, default: DeviceFileStatus.PENDING })
  status: DeviceFileStatus;

  /** Downloads started for this row that never ended in a receipt. */
  @Column({ type: 'int', default: 0 })
  download_attempts: number;

  /** Set from the receipt the device posts back after a failed save. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  failure_message: string | null;

  @Column({ type: 'datetime', nullable: true })
  delivered_at: Date | null;

  @Column({ type: 'datetime' })
  expires_at: Date;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => AndroidDevice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Relation<AndroidDevice>;
}
