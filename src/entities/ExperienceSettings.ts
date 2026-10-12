import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The account's experience memory switches. No row: both on. */
@Entity('experience_settings')
export class ExperienceSettings {
  @PrimaryColumn({ type: 'int' })
  user_id: number;

  /** Lessons are shown to the agent. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Finished runs add lessons. */
  @Column({ type: 'boolean', default: true })
  learn: boolean;
}
