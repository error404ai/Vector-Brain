import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { AndroidDevice } from './AndroidDevice';
import { User } from './User';

@Entity('scheduled_tasks')
export class ScheduledTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int' })
  device_id: number;

  @Column({ type: 'varchar', length: 500 })
  prompt: string;

  /** Local wall-clock time to fire, stored as "HH:MM" in 24h form. */
  @Column({ type: 'varchar', length: 5 })
  run_at: string;

  /**
   * Days the schedule fires on, as a comma-separated list of JS day numbers
   * (0 = Sunday … 6 = Saturday). Empty string means every day.
   */
  @Column({ type: 'varchar', length: 20, default: '' })
  days_of_week: string;

  /** IANA zone the run_at time is interpreted in, e.g. "Asia/Kolkata". */
  @Column({ type: 'varchar', length: 64, default: 'Asia/Kolkata' })
  timezone: string;

  @Column({ type: 'int', default: 40 })
  max_steps: number;

  /** Optional pinned provider; null uses the user's active config. */
  @Column({ type: 'int', nullable: true })
  ai_config_id: number | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'datetime', nullable: true })
  last_run_at: Date | null;

  /** Why the most recent attempt did or did not start. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  last_result: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => AndroidDevice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Relation<AndroidDevice>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
