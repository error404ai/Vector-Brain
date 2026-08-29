import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

export enum AiProvider {
  OPENAI = 'openai',
  GOOGLE = 'google',
  ANTHROPIC = 'anthropic',
  DEEPSEEK = 'deepseek',
  GROQ = 'groq',
  OPENROUTER = 'openrouter',
  CUSTOM = 'custom',
}

export enum AiConfigType {
  TEXT = 'text',
  VISION = 'vision',
}

@Entity('ai_configs')
@Index(['user_id', 'is_active'])
export class AiConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'enum', enum: AiProvider, default: AiProvider.OPENAI })
  provider: AiProvider;

  @Column({ type: 'varchar', length: 150 })
  model: string;

  /**
   * AES-256-GCM encrypted API key.
   */
  @Column({ type: 'text' })
  encrypted_api_key: string;

  /**
   * Optional custom Base URL (e.g. OpenRouter, custom proxy, local Ollama/vLLM)
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  base_url: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 150, nullable: true })
  label: string | null;

  @Column({ type: 'enum', enum: AiConfigType, default: AiConfigType.VISION })
  config_type: AiConfigType;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
