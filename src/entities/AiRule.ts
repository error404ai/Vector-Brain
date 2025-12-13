import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import Container from 'typedi';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { User } from './User';
import { Hydrate } from '../decorators/hydratable';

@Entity('ai_rules')
export class AiRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  rule: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Hydrate
  async vectorExist(): Promise<boolean> {
    const embeddingService = Container.get(AiEmbeddingService);
    await embeddingService.initialize();
    return embeddingService.vectorExists(this.id);
  }
}
