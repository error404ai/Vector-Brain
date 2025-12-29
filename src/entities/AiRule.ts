import { AiEmbeddingService } from '@/services/AiEmbeddingService';
import Container from 'typedi';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from 'typeorm';
import { Hydrate } from '../decorators/hydratable';
import { User } from './User';

@Entity('ai_rules')
export class AiRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  rule: string;

  @Column({ type: 'text', nullable: true })
  intent: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User | null>;

  @Hydrate
  async vectorExist(): Promise<boolean> {
    const embeddingService = Container.get(AiEmbeddingService);
    await embeddingService.initialize();
    return embeddingService.vectorExists(this.id);
  }
}
