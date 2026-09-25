import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { AndroidDevice } from './AndroidDevice';
import { User } from './User';

/**
 * A task waiting for its proxy lane to free up.
 *
 * Kept in the database rather than in memory because the server redeploys
 * often: an in-memory queue would drop every waiting task on restart, silently,
 * and the user would never learn their fleet stopped halfway.
 *
 * Only devices that sit behind a proxy are ever queued. Everything else starts
 * straight away, exactly as before.
 */
@Entity('queued_tasks')
export class QueuedTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  device_id: number;

  /** The lane this is waiting on, copied so the queue can be read per proxy. */
  @Column({ type: 'int' })
  proxy_id: number;

  @Column({ type: 'text' })
  prompt: string;

  /** Pinned provider, when the caller chose one. */
  @Column({ type: 'int', nullable: true })
  ai_config_id: number | null;

  @Column({ type: 'int', default: 500 })
  max_steps: number;

  /** A timed run's length, applied when the lane lets it start. */
  @Column({ type: 'int', nullable: true })
  run_seconds: number | null;

  /**
   * STARTING marks an entry the runner has picked but not yet launched, so two
   * runners cannot take the same one.
   */
  @Column({ type: 'varchar', length: 16, default: 'QUEUED' })
  status: string;

  /**
   * When the runner moved this entry to STARTING. The stale-STARTING sweep is
   * measured from here, not from created_at — an entry that waited a long time
   * in the queue before its turn must not be reclaimed the instant it starts.
   */
  @Column({ type: 'datetime', nullable: true })
  starting_at: Date | null;

  /** Why it was dropped, when it never ran. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  last_error: string | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => AndroidDevice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Relation<AndroidDevice>;
}
