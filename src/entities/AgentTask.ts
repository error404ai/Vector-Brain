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

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
