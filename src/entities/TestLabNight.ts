import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { LabJob, LabReport } from '@/services/android/testlab/testLab';

export type TestLabNightStatus = 'RUNNING' | 'DONE' | 'STOPPED';

/** One Test Lab run: its jobs (task × model × phone) and, once done, the triaged report. */
@Entity('test_lab_nights')
@Index('IDX_test_lab_nights_user', ['user_id', 'id'])
export class TestLabNight {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 12, default: 'RUNNING' })
  status: TestLabNightStatus;

  /** The night's date in India time ("2026-10-12"), so a night is started once per day. */
  @Column({ type: 'varchar', length: 10 })
  day: string;

  /** Started by the Run now button rather than the nightly schedule. */
  @Column({ type: 'boolean', default: false })
  manual: boolean;

  @Column({ type: 'json' })
  jobs: LabJob[];

  @Column({ type: 'json', nullable: true })
  report: LabReport | null;

  @CreateDateColumn({ type: 'datetime' })
  started_at: Date;

  @Column({ type: 'datetime', nullable: true })
  finished_at: Date | null;
}
