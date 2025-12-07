import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';

@Entity('agent_tasks')
export class AgentTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'text', nullable: true })
  logs: string;

  @Column({ type: 'text', nullable: true })
  steps: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string;

  @Column({ type: 'boolean', default: false })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'int', default: 0 })
  total_steps: number;

  @Column({ type: 'float', default: 0 })
  total_duration_seconds: number;

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

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
