import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** One chat thread in Mission Control. Its messages live in chat_messages. */
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  /** Auto-set from the first message; shown in the sidebar. */
  @Column({ type: 'varchar', length: 120, default: 'New chat' })
  title: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  last_message_at: Date;
}
