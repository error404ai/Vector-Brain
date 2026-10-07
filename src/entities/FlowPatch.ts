import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Steps the AI took to get past a broken flow step, kept as a candidate fix.
 *
 * A candidate is reused only on the phone it came from, or (when the account
 * shares fixes) tried on its other phones before the AI is asked. It joins the
 * flow itself after it worked 3 times on at least 2 phone models, so one wrong
 * fix does not spread (docs/RELIABILITY.md → Learning over time).
 */
@Entity('flow_patches')
export class FlowPatch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  flow_id: number;

  /** The flow version whose step this fixes; a new version starts without candidates. */
  @Column({ type: 'int' })
  flow_version: number;

  /** The step that broke (0-based). */
  @Column({ type: 'int' })
  step_index: number;

  /** Where the flow continues after the fix. */
  @Column({ type: 'int' })
  resume_index: number;

  @Column({ type: 'longtext' })
  steps_json: string;

  @Column({ type: 'int', nullable: true })
  device_id: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  device_model: string | null;

  /** candidate | promoted | rejected */
  @Column({ type: 'varchar', length: 12, default: 'candidate' })
  status: string;

  @Column({ type: 'int', default: 0 })
  successes: number;

  @Column({ type: 'int', default: 0 })
  failures: number;

  /** Phone models it worked on. */
  @Column({ type: 'json', nullable: true })
  models: string[] | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
