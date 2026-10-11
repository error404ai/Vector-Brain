import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { TestLabSettings } from '@/services/android/testlab/testLab';

/** One account's Test Lab settings (phones, models, nightly time). */
@Entity('test_lab_configs')
export class TestLabConfig {
  @PrimaryColumn({ type: 'int' })
  user_id: number;

  @Column({ type: 'json' })
  settings: TestLabSettings;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;
}
