import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Where a phone fact came from: read off the phone by a run, or typed by the user. */
export type DeviceFactSource = 'ai' | 'user';

/**
 * Something worth remembering about one phone — for now the email accounts
 * signed in on it.
 *
 * Kept as one row per phone and key, not as task history: history scrolls away
 * after a few runs, and "which email is on lane3" must still have an answer a
 * month later. A run that reads the phone fills it; the user can correct it,
 * and a user-entered value is never silently replaced — a differing read is
 * parked in `suggested` for the user to accept or dismiss.
 */
@Entity('device_facts')
@Index('UQ_device_fact_key', ['device_id', 'fact_key'], { unique: true })
@Index('IDX_device_fact_user', ['user_id'])
export class DeviceFact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  device_id: number;

  /** e.g. "email". */
  @Column({ type: 'varchar', length: 40 })
  fact_key: string;

  /** JSON array of strings. */
  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', length: 8, default: 'ai' })
  source: DeviceFactSource;

  /** The mission whose run last read it (source ai). */
  @Column({ type: 'int', nullable: true })
  mission_id: number | null;

  /** A newer read that disagrees with a user-entered value (JSON array), awaiting the user. */
  @Column({ type: 'text', nullable: true })
  suggested: string | null;

  @Column({ type: 'int', nullable: true })
  suggested_mission_id: number | null;

  @UpdateDateColumn()
  updated_at: Date;
}
