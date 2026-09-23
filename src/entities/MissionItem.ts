import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { Mission } from './Mission';

/**
 * PENDING: waiting to be (re)dispatched · QUEUED: behind a proxy lane ·
 * RUNNING: an agent task is live · SUCCEEDED / FAILED / CANCELLED: final.
 */
export type MissionItemStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

@Entity('mission_items')
export class MissionItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  mission_id: number;

  @Column({ type: 'int' })
  device_id: number;

  /** Set when this item took over from a phone that kept failing. */
  @Column({ type: 'int', nullable: true })
  replaces_item_id: number | null;

  @Column({ type: 'varchar', length: 12, default: 'PENDING' })
  status: MissionItemStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** When set, this item continues that earlier run from its current screen. */
  @Column({ type: 'int', nullable: true })
  continue_from_task_id: number | null;

  @Column({ type: 'int', nullable: true })
  agent_task_id: number | null;

  @Column({ type: 'int', nullable: true })
  queue_id: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  last_reason: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  last_message: string | null;

  @Column({ type: 'datetime', nullable: true })
  dispatched_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  next_attempt_at: Date | null;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Mission, (mission) => mission.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mission_id' })
  mission: Relation<Mission>;
}
