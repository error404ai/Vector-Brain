import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One thing the fleet learned about a site or app (experience memory). Shared by
 * all of a user's phones and models; never across users.
 */
@Entity('experience_lessons')
@Index('IDX_experience_user_scope', ['user_id', 'scope'])
export class ExperienceLesson {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** A domain (blogger.com) or an app package (com.instagram.android). */
  @Column({ type: 'varchar', length: 150 })
  scope: string;

  /** path | avoid | widget | behave | limit | field */
  @Column({ type: 'varchar', length: 12 })
  kind: string;

  @Column({ type: 'varchar', length: 300 })
  text: string;

  /** candidate | trusted | off */
  @Column({ type: 'varchar', length: 12, default: 'candidate' })
  status: string;

  /** auto (learned from runs) | user (taught) */
  @Column({ type: 'varchar', length: 8, default: 'auto' })
  source: string;

  /** For an "avoid" lesson: the address the agent is not allowed to open. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  avoid_url: string | null;

  @Column({ type: 'int', default: 0 })
  helped: number;

  @Column({ type: 'int', default: 0 })
  hurt: number;

  /** Runs it was shown to. */
  @Column({ type: 'int', default: 0 })
  uses: number;

  /** Runs it was learned from or confirmed by (newest last, at most 12). */
  @Column({ type: 'json', nullable: true })
  evidence: number[] | null;

  /** Why it was switched off by itself, when it was. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  off_reason: string | null;

  @Column({ type: 'datetime', nullable: true })
  last_used_at: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;
}
