import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

/**
 * One proxy a user owns, with the link that gives it a fresh IP.
 *
 * A proxy is a lane, not a setting on a device: several phones can sit behind
 * the same proxy, and what matters is how many of them may use it at once.
 * Devices point at this row rather than carrying their own copy of the URL, so
 * rotating once serves every phone on that lane.
 */
@Entity('device_proxies')
export class DeviceProxy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** What the user calls it, e.g. "UK mobile 1". */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /**
   * Provider URL that hands out a new IP when it is called.
   *
   * Hidden from ordinary reads like the device token: these links normally
   * carry the account credentials in the query string.
   */
  @Column({ type: 'varchar', length: 500, select: false })
  rotation_url: string;

  /**
   * Phones allowed on this lane at the same time.
   *
   * One by default, because two devices sharing an IP at once is the thing
   * proxies are usually bought to avoid.
   */
  @Column({ type: 'int', default: 1 })
  concurrency: number;

  /**
   * Seconds to wait after rotating before the next task starts.
   *
   * Providers differ — a few seconds is typical — so this is per proxy rather
   * than a constant. Used by the queue in a later phase; rotation itself does
   * not block on it.
   */
  @Column({ type: 'int', default: 5 })
  settle_seconds: number;

  /** Rotate after every N finished tasks. 0 turns rotation off. */
  @Column({ type: 'int', default: 0 })
  rotate_every_tasks: number;

  /**
   * Shortest gap between two rotation calls, in seconds. Providers rate-limit
   * their rotation endpoint (ours allows one rotation per 60s and returns 429
   * if hit sooner), so even when tasks finish back-to-back we must not call it
   * again inside this window. Defaults to 60s to match the common provider cap.
   */
  @Column({ type: 'int', default: 60 })
  min_rotation_gap_seconds: number;

  /** Counts finished tasks towards rotate_every_tasks. */
  @Column({ type: 'int', default: 0 })
  tasks_since_rotation: number;

  /** Last outcome in plain words, so a quietly broken link is visible. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  last_rotation_status: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  last_ip: string | null;

  @Column({ type: 'datetime', nullable: true })
  last_rotated_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
