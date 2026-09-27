import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum Role {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, select: false })
  password: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string;

  /**
   * Google account subject id, set when the user signs in with Google.
   *
   * Kept alongside the email rather than instead of it: the email on a Google
   * account can change, this id cannot, so it is what a returning user is
   * matched on.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  google_id: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar_url: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Agent engine for this account's runs: 'eko' | 'vector'; null = server default (AGENT_ENGINE). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  agent_engine: string | null;

  /** Vector engine only: make one planning call before acting. */
  @Column({ type: 'boolean', default: false })
  agent_planner: boolean;

  /** A vision model (one of this account's AI configs) that reads screens for a text-only agent model. */
  @Column({ type: 'int', nullable: true })
  agent_vision_config_id: number | null;

  /** Used when the main model is rate-limited or out of quota (one of this account's AI configs). */
  @Column({ type: 'int', nullable: true })
  agent_fallback_config_id: number | null;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date;
}
