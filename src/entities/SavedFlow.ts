import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

/** One recorded device action, replayed exactly as it was captured. */
export interface FlowStep {
  action_type: string;
  action_payload: Record<string, unknown> | null;
  /** What the agent was doing here, shown while the flow replays. */
  label: string;
}

/** How a flow has done, per run (FlowLibraryService.recordOutcome). */
export interface FlowStats {
  runs: number;
  /** Done by the flow alone, no AI call. */
  replay_only: number;
  /** Done after the AI (or a saved fix) repaired a step. */
  repaired: number;
  /** The AI finished the task after the flow broke. */
  fell_back: number;
  failed: number;
  /** Per phone model: runs and successes. */
  models: Record<string, { runs: number; ok: number }>;
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

  /** 1: raw recorded actions (pixel taps); 2: checkable steps (flowSteps.ts). */
  @Column({ type: 'int', default: 1 })
  format: number;

  /** Off: never used automatically or by a mission (it can still be run by hand). */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Bumped when a step fix is promoted into the flow or rolled back. */
  @Column({ type: 'int', default: 1 })
  version: number;

  /** The task wording, case and spacing aside, for flows without parameters. */
  @Column({ type: 'varchar', length: 191, nullable: true })
  prompt_key: string | null;

  /** The wording with typed values as {{p1}}… (flowSteps.promptTemplate). */
  @Column({ type: 'text', nullable: true })
  template: string | null;

  @Column({ type: 'text', nullable: true })
  params_json: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  package_name: string | null;

  /** Saved automatically after a successful run (not by "Save as flow"). */
  @Column({ type: 'boolean', default: false })
  auto: boolean;

  /** Recorded from a run the system checked on the phone (not only the agent's word). */
  @Column({ type: 'boolean', default: false })
  checked: boolean;

  /** Steps the AI still does on every run (typed text that is not in the task's wording). */
  @Column({ type: 'int', default: 0 })
  ai_steps: number;

  @Column({ type: 'json', nullable: true })
  stats: FlowStats | null;

  /** The last run that replayed it and passed every check. */
  @Column({ type: 'datetime', nullable: true })
  last_verified_at: Date | null;

  /** The steps before the last promoted fix, so a bad fix can be rolled back. */
  @Column({ type: 'longtext', nullable: true })
  previous_steps_json: string | null;

  /** Runs in a row that failed since the last promoted fix. */
  @Column({ type: 'int', default: 0 })
  fail_streak: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source_device_model: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
