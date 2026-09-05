import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

/** One recorded device action, replayed exactly as it was captured. */
export interface FlowStep {
  action_type: string;
  action_payload: Record<string, unknown> | null;
  /** What the agent was doing here, shown while the flow replays. */
  label: string;
}

/**
 * A finished run saved as a repeatable sequence.
 *
 * Replaying sends the recorded actions straight to the device, so a flow costs
 * nothing to run and finishes in a fraction of the original time — the model is
 * only needed to work the route out the first time.
 */
@Entity('saved_flows')
export class SavedFlow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** The instruction that produced this flow, kept for context. */
  @Column({ type: 'text', nullable: true })
  source_prompt: string | null;

  /** The task this was recorded from, if it still exists. */
  @Column({ type: 'int', nullable: true })
  source_task_id: number | null;

  @Column({ type: 'longtext' })
  steps_json: string;

  @Column({ type: 'int', default: 0 })
  step_count: number;

  /**
   * Taps are recorded as screen coordinates, so a flow with many of them only
   * replays correctly while the layout stays put. Counting them lets the UI warn
   * before someone relies on it.
   */
  @Column({ type: 'int', default: 0 })
  coordinate_step_count: number;

  @Column({ type: 'int', default: 0 })
  run_count: number;

  @Column({ type: 'datetime', nullable: true })
  last_run_at: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
