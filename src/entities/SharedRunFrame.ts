import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { AgentTask } from './AgentTask';

/**
 * A single screen frame kept for a publicly shared run.
 *
 * Frames are copied out of the step logs at share time so the public page keeps
 * working after logs are cleaned up, and so only the image and a caption are
 * ever exposed — never UI trees, device ids or account data.
 */
@Entity('shared_run_frames')
export class SharedRunFrame {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  agent_task_id: number;

  @Column({ type: 'int' })
  step_index: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption: string | null;

  /** Tool that produced this frame, e.g. tap_coordinate — drives the caption. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  action_type: string | null;

  /** Tap/swipe coordinates and typed text, used for the on-screen ripple. */
  @Column({ type: 'json', nullable: true })
  action_payload: any;

  @Column({ type: 'longtext' })
  image_base64: string;

  @ManyToOne(() => AgentTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_task_id' })
  task: Relation<AgentTask>;

  @CreateDateColumn()
  created_at: Date;
}
