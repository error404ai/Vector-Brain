import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A file a phone sent to the server (companion 0.32 UploadFile): something from
 * its Download folder or a full-size screenshot. The bytes sit in
 * device_upload_chunks, a few MB per row (MySQL refuses one statement larger
 * than max_allowed_packet). Kept for a week.
 */
@Entity('device_uploads')
@Index('IDX_device_uploads_user', ['user_id', 'id'])
export class DeviceUpload {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** android_devices.id */
  @Column({ type: 'int' })
  device_id: number;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 150, default: 'application/octet-stream' })
  mime_type: string;

  @Column({ type: 'int' })
  size_bytes: number;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;
}
