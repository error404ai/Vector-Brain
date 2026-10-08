import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { AgentTask } from './AgentTask';
import { AndroidDevice } from './AndroidDevice';

export enum AndroidStepStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('android_task_logs')
export class AndroidTaskLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  agent_task_id: number;

  @Column({ type: 'int', nullable: true })
  device_id: number;

  @Column({ type: 'int' })
  step_index: number;

  @Column({ type: 'varchar', length: 50 })
  action_type: string;

  @Column({ type: 'json', nullable: true })
  action_payload: any;

  @Column({ type: 'longtext', nullable: true })
  thought_reasoning: string;

  @Column({ type: 'enum', enum: AndroidStepStatus, default: AndroidStepStatus.PENDING })
  status: AndroidStepStatus;

  @Column({ type: 'longtext', nullable: true })
  screenshot_base64: string;

  @Column({ type: 'json', nullable: true })
  ui_tree_snapshot: any;

  @Column({ type: 'int', default: 0 })
  duration_ms: number;

  @Column({ type: 'longtext', nullable: true })
  result_message: string;

  @Column({ type: 'longtext', nullable: true })
  error_message: string;

  // --- Run diagnostics (all optional; see RunDiagnosticsService) -------------

  /** The screen the step acted on. ui_tree_snapshot is the screen after it. */
  @Column({ type: 'longtext', nullable: true, select: false })
  ui_tree_before: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  package_before: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  package_after: string | null;

  /** Short structural fingerprints of the screen before/after (see screenFingerprint). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  screen_before: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  screen_after: string | null;

  /** Time the model took to choose this step (previous result -> this call). */
  @Column({ type: 'int', nullable: true })
  think_ms: number | null;

  /** Which model call (1-based within the run) produced this step. */
  @Column({ type: 'int', nullable: true })
  llm_call: number | null;

  /** Tokens of the model call that produced this step; set on its first step only. */
  @Column({ type: 'int', nullable: true })
  prompt_tokens: number | null;

  @Column({ type: 'int', nullable: true })
  completion_tokens: number | null;

  /** Of prompt_tokens: read from the prompt cache (billed at a fraction). */
  @Column({ type: 'int', nullable: true })
  cache_read_tokens: number | null;

  /** Written to the prompt cache; null when the provider does not report it (OpenRouter). */
  @Column({ type: 'int', nullable: true })
  cache_write_tokens: number | null;

  /** Of completion_tokens: hidden reasoning. */
  @Column({ type: 'int', nullable: true })
  reasoning_tokens: number | null;

  /** What the provider billed for the call, in USD; null when not reported. */
  @Column({ type: 'double', nullable: true })
  cost_usd: number | null;

  /** Who decided this step: 'ai', 'replay' or 'direct'. */
  @Column({ type: 'varchar', length: 12, default: 'ai' })
  source: string;

  /** Whether the AI saw this step's screen as an image: 'ai', 'helper' or 'none'. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  sight: string | null;

  /** Why no image reached the AI on this step (screenSight.ts WHY_TEXT). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  sight_why: string | null;

  /** Why the step was wasted, when it was (set when the run ends). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  waste: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @ManyToOne(() => AgentTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_task_id' })
  agentTask: Relation<AgentTask>;

  @ManyToOne(() => AndroidDevice, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'device_id' })
  device: Relation<AndroidDevice>;
}
