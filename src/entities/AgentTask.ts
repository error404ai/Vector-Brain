import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import type { RunSight } from '../services/android/screenSight';
import type { RunDiagnostics } from '@/services/android/runDiagnostics';
import type { VerificationOutcome } from '@/services/android/agent/AgentEngine';
import { User } from './User';

export type AgentTaskStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

@Entity('agent_tasks')
export class AgentTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'int', nullable: true })
  device_id: number;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'longtext', nullable: true })
  logs: string;

  @Column({ type: 'longtext', nullable: true })
  steps: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string;

  @Column({ type: 'boolean', default: false })
  success: boolean;

  /** The phone's last screen when the task finished (base64 JPEG); one per task. */
  @Column({ type: 'mediumtext', nullable: true })
  final_screenshot: string | null;

  /**
   * Lifecycle state, stored so it survives a restart. `success` is kept for old
   * readers, but it defaults to false, which made running, stuck and killed runs
   * all look like failures. `status` says what actually happened.
   */
  @Column({ type: 'varchar', length: 20, default: 'FAILED' })
  status: AgentTaskStatus;

  /** Machine-readable cause for a non-successful end, e.g. NO_ACTION, SERVER_RESTART. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  reason_code: string | null;

  /** True when this run needs no exit IP, so it neither waits for a proxy lane nor holds one. */
  @Column({ type: 'boolean', default: false })
  lane_exempt: boolean;

  @Column({ type: 'datetime', nullable: true })
  started_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  finished_at: Date | null;

  /**
   * A running task renews this every few seconds. If the process running it
   * dies (deploy, crash), renewals stop, the lease expires, and the sweeper marks
   * the task INTERRUPTED instead of it staying "running" forever.
   */
  @Column({ type: 'datetime', nullable: true })
  lease_until: Date | null;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'int', default: 0 })
  total_steps: number;

  @Column({ type: 'float', default: 0 })
  total_duration_seconds: number;

  /** Random token that makes this run readable without logging in; null = private. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  share_token: string | null;

  @Column({ type: 'datetime', nullable: true })
  shared_at: Date | null;

  @Column({ type: 'text', nullable: true })
  urls_visited: string;

  @Column({ type: 'text', nullable: true })
  model_actions: string;

  @Column({ type: 'text', nullable: true })
  errors: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  /** Which engine drove the model: 'eko', 'vector' or 'lite' (null for runs before engines existed). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  engine: string | null;

  /** The system's check of a run the agent reported as done (Vector engine). */
  @Column({ type: 'json', nullable: true })
  verification: VerificationOutcome | null;

  /**
   * How the run ended, for the reliability KPIs (docs/RELIABILITY.md):
   * first_try | recovered | human_assisted | failed | cancelled. Null while running.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome: string | null;

  /** The saved flow this run replayed, if any. */
  @Column({ type: 'int', nullable: true })
  flow_id: number | null;

  /** How the flow went: 'replay' (no AI), 'repaired' (a step fixed), 'fallback' (AI finished it). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  flow_mode: string | null;

  /** Where the run's steps and time went; written when the run ends (RunDiagnosticsService). */
  @Column({ type: 'json', nullable: true })
  diagnostics: RunDiagnostics | null;

  /** Whether the AI saw the phone's screen as images in this run (screenSight.ts). */
  @Column({ type: 'json', nullable: true })
  sight: RunSight | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
