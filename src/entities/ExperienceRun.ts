import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** What one run took from experience memory and what it added, for the Experience page. */
@Entity('experience_runs')
@Index('IDX_experience_runs_user', ['user_id', 'created_at'])
export class ExperienceRun {
  /** agent_tasks.id */
  @PrimaryColumn({ type: 'int' })
  task_id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'boolean', default: false })
  succeeded: boolean;

  @Column({ type: 'json', nullable: true })
  used: number[] | null;

  @Column({ type: 'json', nullable: true })
  learned: number[] | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;
}
