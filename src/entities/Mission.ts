import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { MissionItem } from './MissionItem';

export type MissionStatus = 'RUNNING' | 'DONE' | 'CANCELLED';
/** How the phones were chosen: named ids, a count of ready phones, every ready phone, or a tag. */
export type MissionTargetMode = 'ids' | 'count' | 'all' | 'tag';

@Entity('missions')
export class Mission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** What the user typed, verbatim. */
  @Column({ type: 'text' })
  request: string;

  /** The single-phone instruction every item runs. */
  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ids' })
  target_mode: MissionTargetMode;

  @Column({ type: 'int', nullable: true })
  requested_count: number | null;

  @Column({ type: 'boolean', default: false })
  no_internet: boolean;

  @Column({ type: 'int', default: 20 })
  max_steps: number;

  /** When set, each phone keeps working this long ("for 1 hour"). */
  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'int', nullable: true })
  ai_config_id: number | null;

  @Column({ type: 'varchar', length: 12, default: 'RUNNING' })
  status: MissionStatus;

  /** Anything the user should know up front — e.g. fewer phones were ready than asked for. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'datetime', nullable: true })
  finished_at: Date | null;

  @OneToMany(() => MissionItem, (item) => item.mission)
  items: Relation<MissionItem[]>;
}
