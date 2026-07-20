import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('browserworker_errors')
@Index('UQ_browserworker_errors_fingerprint', ['fingerprint'], { unique: true })
export class BrowserWorkerError {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 100 })
  error_code: string;

  @Column({ type: 'varchar', length: 80 })
  phase: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'longtext', nullable: true })
  stack: string | null;

  @Column({ type: 'varchar', length: 32 })
  extension_version: string;

  @Column({ type: 'varchar', length: 20 })
  browser: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  browser_version: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  tool: string | null;

  @Column({ type: 'int', nullable: true })
  step: number | null;

  @Column({ type: 'int', nullable: true })
  task_duration_ms: number | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  occurrence_count: number;

  @Column({ type: 'datetime', precision: 6 })
  first_seen_at: Date;

  @Column({ type: 'datetime', precision: 6 })
  last_seen_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
